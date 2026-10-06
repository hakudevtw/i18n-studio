import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildModel } from "./commands.js";
import type { Config } from "./config.js";
import { renderHtml } from "./html.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4321;
const PORT_TRIES = 10;
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const hostsFor = (port: number) =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

/**
 * Read-only local server for the report page. Loopback only, GET/HEAD only, Host
 * header checked (DNS rebinding), no CORS. Each request re-reads the files, so a
 * refresh always shows the current state.
 */
export const startStudio = async (
  config: Config,
  opts: { port?: number } = {}
) => {
  let allowed = new Set<string>();
  const server = createServer((req, res) => {
    const send = (status: number, body: string, type = "text/plain") => {
      res.writeHead(status, {
        "content-type": `${type}; charset=utf-8`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": CSP,
      });
      res.end(body);
    };
    if (!allowed.has(req.headers.host ?? "")) {
      return send(403, "forbidden host");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return send(405, "read-only");
    }
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/") {
      return send(404, "not found");
    }
    try {
      send(200, renderHtml(buildModel(config)), "text/html");
    } catch (e) {
      send(500, `error: ${(e as Error).message}`);
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
  allowed = hostsFor(port);
  return { server, port, url: `http://${HOST}:${port}/` };
};
