import { request } from "node:http";
import { afterEach } from "vitest";
import { init } from "../src/commands.js";
import type { Config } from "../src/config.js";
import { startStudio } from "../src/server.js";
import { copyFixture } from "./helpers.js";

const TOKEN_META = /name="studio-token" content="([^"]+)"/;

export type Reply = {
  status: number;
  headers: Record<string, unknown>;
  body: string;
};

export const call = (
  port: number,
  opts: {
    method?: string;
    path?: string;
    host?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Send the body in chunks (no Content-Length). */
    chunks?: string[];
  } = {}
) =>
  new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path ?? "/",
        headers: { host: opts.host ?? `localhost:${port}`, ...opts.headers },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        );
      }
    );
    // The server may answer (and close) before a large upload is finished.
    req.on("error", (e) => {
      if ((e as NodeJS.ErrnoException).code !== "EPIPE") {
        reject(e);
      }
    });
    if (opts.chunks) {
      for (const chunk of opts.chunks) {
        req.write(chunk);
      }
      req.end();
    } else {
      req.end(opts.body);
    }
  });

const open: { close: () => void }[] = [];
afterEach(() => {
  for (const s of open.splice(0)) {
    s.close();
  }
});

/** A studio on a free port over a temp copy of the fixture (baselined unless `baseline` is false). */
export const start = async (
  overrides: Partial<Config> = {},
  baseline = true
) => {
  const cfg = copyFixture(["en", "ko", "es"], overrides);
  if (baseline) {
    init(cfg, { force: false });
  }
  const studio = await startStudio(cfg, { port: 0 });
  open.push(studio.server);
  return { cfg, ...studio };
};

export const getShellToken = async (port: number) => {
  const shell = await call(port);
  return TOKEN_META.exec(shell.body)?.[1] ?? "";
};

/** Headers a legitimate same-origin page would send. */
export const saveHeaders = (port: number, token: string) => ({
  origin: `http://127.0.0.1:${port}`,
  "content-type": "application/json",
  "x-studio-token": token,
});

export const save = (
  port: number,
  token: string,
  payload: unknown,
  headers: Record<string, string> = {}
) =>
  call(port, {
    method: "POST",
    path: "/api/save",
    headers: { ...saveHeaders(port, token), ...headers },
    body: JSON.stringify(payload),
  });
