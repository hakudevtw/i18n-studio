import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAsset } from "../src/assets.js";
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

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

describe("studio server", () => {
  it("serves a static shell on loopback with hardened headers", async () => {
    const { server, port } = await start();
    expect((server.address() as { address: string }).address).toBe("127.0.0.1");
    const res = await call(port);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.body).toContain('<script src="/app.js"></script>');
    expect(res.body).toContain('href="/app.css"');
    expect(res.body).not.toContain("<style");
    expect(res.body).not.toContain('id="data"');
    expect(res.headers["content-security-policy"]).toBe(CSP);
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves only the allowlisted assets, with content types", async () => {
    const { port } = await start();
    const js = await call(port, { path: "/app.js" });
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.body).toBe(readAsset("app.js"));
    const css = await call(port, { path: "/app.css" });
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(css.headers["content-security-policy"]).toBe(CSP);
    for (const path of [
      "/app.js.map",
      "/App.js",
      "/ui/app.js",
      "/../package.json",
      "/%2e%2e/package.json",
      "/app.js/",
      "/constructor",
      "/__proto__",
      "/toString",
      "/etc/passwd",
    ]) {
      expect((await call(port, { path })).status).toBe(404);
    }
  });

  it("serves the model as JSON, re-read from disk on every request", async () => {
    const { cfg, port } = await start();
    const first = await call(port, { path: "/api/model" });
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toBe(
      "application/json; charset=utf-8"
    );
    const model = JSON.parse(first.body);
    expect(model).toMatchObject({
      copyHeader: true,
      uiLocale: "auto",
      banners: [],
      columns: ["en", "es", "ko"],
    });
    expect(first.body).not.toContain("studio-freshness-marker");
    const file = join(cfg.i18nDir, "ko", "navigation.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.link.faq = "studio-freshness-marker";
    writeFileSync(file, JSON.stringify(data, null, 2));
    expect((await call(port, { path: "/api/model" })).body).toContain(
      "studio-freshness-marker"
    );
  });

  it("puts config into the model (copyHeader, uiLocale, noRecords banner)", async () => {
    const cfg = copyFixture(["en", "ko", "es"], {
      copyHeader: false,
      uiLocale: "ja",
    });
    const studio = await startStudio(cfg, { port: 0 });
    open.push(studio.server);
    const model = JSON.parse(
      (await call(studio.port, { path: "/api/model" })).body
    );
    expect(model).toMatchObject({
      copyHeader: false,
      uiLocale: "ja",
      banners: [{ kind: "noRecords" }],
    });
  });

  it("rejects foreign Host headers and writes, on every route", async () => {
    const { port } = await start();
    for (const path of ["/", "/app.js", "/app.css", "/api/model", "/nope"]) {
      expect((await call(port, { path, host: "evil.example" })).status).toBe(
        403
      );
      expect(
        (await call(port, { path, host: `evil.example:${port}` })).status
      ).toBe(403);
      expect((await call(port, { path, method: "POST" })).status).toBe(405);
      expect((await call(port, { path, method: "PUT" })).status).toBe(405);
      expect((await call(port, { path, method: "DELETE" })).status).toBe(405);
    }
    expect((await call(port, { path: "/nope" })).status).toBe(404);
  });

  it("answers HEAD without a body", async () => {
    const { port } = await start();
    const res = await call(port, { method: "HEAD", path: "/app.css" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  it("refuses an explicitly requested port that is taken", async () => {
    const { cfg, port } = await start();
    await expect(startStudio(cfg, { port })).rejects.toThrow();
  });
});
