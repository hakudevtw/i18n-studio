import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAsset } from "../src/assets.js";
import { startStudio } from "../src/server.js";
import { syntheticConfig } from "./helpers.js";
import { call, getShellToken, start } from "./http.js";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ROUTES = ["/", "/app.js", "/app.css", "/api/model", "/api/save", "/nope"];

describe("studio server: GET behaviour (regression of the read-only phase)", () => {
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
  });

  it("serves only the allowlisted assets, without needing the token", async () => {
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

describe("studio server: the API token", () => {
  it("/api/model needs the token (missing and wrong are 403)", async () => {
    const { port, token } = await start();
    expect((await call(port, { path: "/api/model" })).status).toBe(403);
    expect(
      (
        await call(port, {
          path: "/api/model",
          headers: { "x-studio-token": "wrong" },
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(port, {
          path: "/api/model",
          headers: { "x-studio-token": `${token}x` },
        })
      ).status
    ).toBe(403);
    const ok = await call(port, {
      path: "/api/model",
      headers: { "x-studio-token": token },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(ok.body)).toMatchObject({
      copyHeader: true,
      uiLocale: "auto",
      readOnly: false,
      banners: [],
      columns: ["en", "es", "ko"],
    });
  });

  it("is random per start and appears only in the shell", async () => {
    const a = await start();
    const b = await start();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(await getShellToken(a.port)).toBe(a.token);
    for (const [path, headers] of [
      ["/app.js", {}],
      ["/app.css", {}],
      ["/api/model", { "x-studio-token": a.token }],
      ["/nope", {}],
      ["/api/save", {}],
    ] as const) {
      const res = await call(a.port, { path, headers });
      expect(res.body).not.toContain(a.token);
      expect(JSON.stringify(res.headers)).not.toContain(a.token);
    }
    const denied = await call(a.port, {
      path: "/api/model",
      host: "evil.example",
    });
    expect(denied.body).not.toContain(a.token);
  });

  it("re-reads the files on every model request", async () => {
    const { cfg, port, token } = await start();
    const headers = { "x-studio-token": token };
    const first = await call(port, { path: "/api/model", headers });
    expect(first.body).not.toContain("studio-freshness-marker");
    const file = join(cfg.i18nDir, "ko", "navigation.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.link.faq = "studio-freshness-marker";
    writeFileSync(file, JSON.stringify(data, null, 2));
    expect((await call(port, { path: "/api/model", headers })).body).toContain(
      "studio-freshness-marker"
    );
  });

  it("puts config into the model (copyHeader, uiLocale, readOnly, noRecords banner)", async () => {
    const { port, token } = await start(
      { copyHeader: false, uiLocale: "ja", readOnly: true },
      false
    );
    const model = JSON.parse(
      (
        await call(port, {
          path: "/api/model",
          headers: { "x-studio-token": token },
        })
      ).body
    );
    expect(model).toMatchObject({
      copyHeader: false,
      uiLocale: "ja",
      readOnly: true,
      banners: [{ kind: "noRecords" }],
    });
  });
});

describe("studio server: methods, hosts and CORS", () => {
  it("rejects foreign Host headers on every route, for GET and POST", async () => {
    const { port } = await start();
    for (const path of ROUTES) {
      for (const method of ["GET", "POST"]) {
        for (const host of ["evil.example", `evil.example:${port}`]) {
          expect((await call(port, { path, method, host })).status).toBe(403);
        }
      }
    }
  });

  it("answers 405 for OPTIONS and every other method, and POST outside /api/save", async () => {
    const { port } = await start();
    for (const path of ROUTES) {
      for (const method of ["OPTIONS", "PUT", "DELETE", "PATCH"]) {
        expect((await call(port, { path, method })).status).toBe(405);
      }
    }
    for (const path of ROUTES.filter((p) => p !== "/api/save")) {
      expect((await call(port, { path, method: "POST" })).status).toBe(405);
    }
    expect((await call(port, { path: "/api/save" })).status).toBe(405);
    expect((await call(port, { path: "/nope" })).status).toBe(404);
  });

  it("never sends CORS headers, on success or on errors", async () => {
    const { port, token } = await start();
    const origin = `http://127.0.0.1:${port}`;
    const replies = [
      await call(port),
      await call(port, { path: "/app.js" }),
      await call(port, { path: "/api/model" }),
      await call(port, {
        path: "/api/model",
        headers: { "x-studio-token": token },
      }),
      await call(port, { path: "/nope" }),
      await call(port, {
        method: "OPTIONS",
        path: "/api/save",
        headers: { origin, "access-control-request-method": "POST" },
      }),
      await call(port, {
        method: "POST",
        path: "/api/save",
        headers: { origin: "http://evil.example" },
      }),
      await call(port, { host: "evil.example" }),
    ];
    for (const res of replies) {
      expect(
        Object.keys(res.headers).filter((h) => h.startsWith("access-control-"))
      ).toEqual([]);
    }
  });

  it("serves a catalog that has no records yet", async () => {
    const studio = await startStudio(syntheticConfig(), { port: 0 });
    try {
      expect((await call(studio.port)).status).toBe(200);
    } finally {
      studio.server.close();
    }
  });
});
