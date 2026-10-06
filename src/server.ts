import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { ASSETS, readAsset } from "./assets.js";
import { buildModel } from "./commands.js";
import type { Config } from "./config.js";
import { renderShell } from "./html.js";
import { SaveError, saveBatch } from "./save.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4321;
const PORT_TRIES = 10;
const MAX_BODY = 1024 * 1024;
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

const hostsFor = (port: number) =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
const originsFor = (port: number) =>
  new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);

/** Constant-time, length-safe comparison (both sides are hashed to equal length first). */
const sameToken = (given: string | undefined, expected: string) => {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given ?? ""), digest(expected));
};

type Reply = { status: number; body: string; type?: string };
const text = (status: number, body: string): Reply => ({ status, body });
const json = (status: number, value: unknown): Reply => ({
  status,
  body: JSON.stringify(value),
  type: "application/json",
});

/** Reads the body up to MAX_BODY; further bytes are drained, never buffered. */
const readBody = (req: IncomingMessage) =>
  new Promise<string | "too-large">((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      resolve(tooLarge ? "too-large" : Buffer.concat(chunks).toString("utf8"))
    );
    req.on("error", reject);
  });

const saveReply = async (
  config: Config,
  req: IncomingMessage
): Promise<Reply> => {
  if (!JSON_TYPE.test(req.headers["content-type"] ?? "")) {
    req.resume();
    return text(415, "content-type must be application/json");
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
    req.resume();
    return text(413, "body too large");
  }
  const body = await readBody(req);
  if (body === "too-large") {
    return text(413, "body too large");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { ok: false, error: "body is not valid JSON" });
  }
  try {
    return json(200, saveBatch(config, payload));
  } catch (e) {
    if (e instanceof SaveError) {
      return json(e.status, {
        ok: false,
        error: e.message,
        ...(e.conflicts && { conflicts: e.conflicts }),
      });
    }
    return text(500, "save failed");
  }
};

type Ctx = {
  config: Config;
  token: string;
  hosts: Set<string>;
  origins: Set<string>;
};

/** `POST /api/save`: every guard must pass before the body is even read. */
const saveRoute = async (ctx: Ctx, req: IncomingMessage): Promise<Reply> => {
  if (req.method !== "POST") {
    return text(405, "use POST");
  }
  const site = req.headers["sec-fetch-site"];
  const tokenOk = sameToken(
    req.headers["x-studio-token"] as string | undefined,
    ctx.token
  );
  const sameSite = site === undefined || site === "same-origin";
  if (!(ctx.origins.has(req.headers.origin ?? "") && sameSite && tokenOk)) {
    req.resume();
    return text(403, "forbidden");
  }
  if (ctx.config.readOnly) {
    req.resume();
    return text(403, "read-only");
  }
  return await saveReply(ctx.config, req);
};

/** GET/HEAD routes. The request only selects a key; it is never turned into a file path. */
const readRoute = (ctx: Ctx, req: IncomingMessage, path: string): Reply => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return text(405, "method not allowed");
  }
  if (path === "/") {
    return { status: 200, body: renderShell(ctx.token), type: "text/html" };
  }
  if (path === "/api/model") {
    const tokenOk = sameToken(
      req.headers["x-studio-token"] as string | undefined,
      ctx.token
    );
    return tokenOk ? json(200, buildModel(ctx.config)) : text(403, "forbidden");
  }
  if (Object.hasOwn(ASSETS, path)) {
    const asset = ASSETS[path as keyof typeof ASSETS];
    return { status: 200, body: readAsset(asset.file), type: asset.type };
  }
  return text(404, "not found");
};

const handle = async (ctx: Ctx, req: IncomingMessage): Promise<Reply> => {
  if (!ctx.hosts.has(req.headers.host ?? "")) {
    return text(403, "forbidden host");
  }
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  return path === "/api/save"
    ? await saveRoute(ctx, req)
    : readRoute(ctx, req, path);
};

/**
 * Local server for the studio page. Loopback only, Host header checked (DNS
 * rebinding), no CORS. GET serves the page, assets and `/api/model` (token required);
 * the only write is `POST /api/save`, guarded by Host + Origin + Sec-Fetch-Site +
 * a per-start token + a JSON content type + a 1 MiB body limit, unless `readOnly`.
 */
export const startStudio = async (
  config: Config,
  opts: { port?: number } = {}
) => {
  const token = randomBytes(32).toString("base64url");
  const ctx: Ctx = { config, token, hosts: new Set(), origins: new Set() };

  const server = createServer(async (req, res) => {
    const send = ({ status, body, type = "text/plain" }: Reply) => {
      res.writeHead(status, {
        "content-type": `${type}; charset=utf-8`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": CSP,
        "x-frame-options": "DENY",
        ...(status === 413 && { connection: "close" }),
      });
      res.end(body);
    };
    try {
      send(await handle(ctx, req));
    } catch (e) {
      send(text(500, `error: ${(e as Error).message}`));
    }
  });

  const listen = (at: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(at, HOST, () => {
        server.off("error", reject);
        resolve();
      });
    });

  // An explicit port is used as given; the default walks up if it is taken.
  const requested = opts.port ?? config.port;
  const tries = requested === undefined ? PORT_TRIES : 1;
  const first = requested ?? DEFAULT_PORT;
  for (let i = 0; i < tries; i += 1) {
    try {
      await listen(first + i);
      break;
    } catch (e) {
      const busy = (e as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || i === tries - 1) {
        throw e;
      }
    }
  }
  const { port } = server.address() as AddressInfo;
  ctx.hosts = hostsFor(port);
  ctx.origins = originsFor(port);
  return { server, port, token, url: `http://${HOST}:${port}/` };
};
