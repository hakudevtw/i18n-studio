import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { init } from "../src/commands.js";
import { startStudio } from "../src/server.js";
import { copyFixture } from "./helpers.js";

type Reply = { status: number; headers: Record<string, unknown>; body: string };

const call = (
  port: number,
  opts: { method?: string; path?: string; host?: string } = {}
) =>
  new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "GET",
        path: opts.path ?? "/",
        headers: { host: opts.host ?? `localhost:${port}` },
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
    req.on("error", reject);
    req.end();
  });

const open: { close: () => void }[] = [];
afterEach(() => {
  for (const s of open.splice(0)) {
    s.close();
  }
});

const start = async () => {
  const cfg = copyFixture();
  init(cfg, { force: false });
  const studio = await startStudio(cfg, { port: 0 });
  open.push(studio.server);
  return { cfg, ...studio };
};

describe("studio server", () => {
  it("serves the report page on loopback with hardened headers", async () => {
    const { server, port } = await start();
    expect((server.address() as { address: string }).address).toBe("127.0.0.1");
    const res = await call(port);
    expect(res.status).toBe(200);
    expect(res.body).toContain('id="data"');
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'none'"
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects foreign Host headers, writes and unknown paths", async () => {
    const { port } = await start();
    expect((await call(port, { host: "evil.example" })).status).toBe(403);
    expect((await call(port, { host: `evil.example:${port}` })).status).toBe(
      403
    );
    expect((await call(port, { method: "POST" })).status).toBe(405);
    expect((await call(port, { method: "PUT" })).status).toBe(405);
    expect((await call(port, { path: "/etc/passwd" })).status).toBe(404);
  });

  it("re-reads the files on every request", async () => {
    const { cfg, port } = await start();
    const before = await call(port);
    expect(before.body).not.toContain("studio-freshness-marker");
    const file = join(cfg.i18nDir, "ko", "navigation.json");
    const data = JSON.parse(
      (await import("node:fs")).readFileSync(file, "utf8")
    );
    data.link.faq = "studio-freshness-marker";
    writeFileSync(file, JSON.stringify(data, null, 2));
    expect((await call(port)).body).toContain("studio-freshness-marker");
  });

  it("refuses an explicitly requested port that is taken", async () => {
    const { cfg, port } = await start();
    await expect(startStudio(cfg, { port })).rejects.toThrow();
  });
});
