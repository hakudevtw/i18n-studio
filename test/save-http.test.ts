import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { call, getShellToken, save, saveHeaders, start } from "./http.js";
import { snapshot, tmpFiles } from "./snapshot.js";

const FAQ = {
  id: "navigation.link.faq",
  lang: "ko",
  expectedOld: "자주 묻는 질문",
  new: "자주 묻는 질문 (FAQ)",
};
const edit = { edits: [FAQ] };
const MIB = 1024 * 1024;

type Started = Awaited<ReturnType<typeof start>>;

/** Runs an attempt against a fresh studio; reports its status and whether anything changed on disk. */
const guarded = async (
  attempt: (ctx: Started) => Promise<{ status: number }>
) => {
  const ctx = await start();
  const before = snapshot(ctx.cfg);
  const { status } = await attempt(ctx);
  return {
    status,
    unchanged: snapshot(ctx.cfg) === before,
    tmp: tmpFiles(ctx.cfg),
  };
};
const without = (headers: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => k !== key));
const refused = (status: number) => ({ status, unchanged: true, tmp: [] });

describe("POST /api/save: success", () => {
  it("writes the file, returns the result and a fresh model (200)", async () => {
    const { cfg, port, token } = await start();
    const res = await save(port, token, edit);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      ok: true,
      written: { files: 1, cells: 1 },
      staleRows: 0,
      warnings: [],
    });
    expect(
      body.model.rows.find((r: { key: string }) => r.key === "link.faq").status
    ).toBe("edited");
    expect(
      JSON.parse(
        readFileSync(join(cfg.i18nDir, "ko", "navigation.json"), "utf8")
      ).link.faq
    ).toBe(FAQ.new);
    expect(tmpFiles(cfg)).toEqual([]);
    expect(res.body).not.toContain(token);
  });

  it("accepts the other loopback origins and Sec-Fetch-Site: same-origin", async () => {
    const { port, token } = await start();
    const res = await save(port, token, edit, {
      origin: `http://localhost:${port}`,
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
    const v6 = await save(
      port,
      token,
      {
        statuses: [{ id: FAQ.id, state: "in-review", expectedState: "edited" }],
      },
      { origin: `http://[::1]:${port}` }
    );
    expect(v6.status).toBe(200);
    const charset = await save(
      port,
      token,
      { edits: [{ ...FAQ, expectedOld: FAQ.new, new: "again" }] },
      { "content-type": "application/json; charset=utf-8" }
    );
    expect(charset.status).toBe(200);
  });

  it("answers 409 on replay (the expected old value is now stale)", async () => {
    const { cfg, port, token } = await start();
    expect((await save(port, token, edit)).status).toBe(200);
    const after = snapshot(cfg);
    const replay = await save(port, token, edit);
    expect(replay.status).toBe(409);
    expect(JSON.parse(replay.body)).toMatchObject({
      ok: false,
      error: "conflict",
      conflicts: [{ id: FAQ.id, lang: "ko", kind: "value", current: FAQ.new }],
    });
    expect(snapshot(cfg)).toBe(after);
  });
});

describe("POST /api/save: token, origin, host (403)", () => {
  it("rejects a missing, wrong or empty token", async () => {
    for (const token of [undefined, "", "wrong"]) {
      expect(
        await guarded(({ port }) =>
          call(port, {
            method: "POST",
            path: "/api/save",
            headers:
              token === undefined
                ? without(saveHeaders(port, "x"), "x-studio-token")
                : { ...saveHeaders(port, "x"), "x-studio-token": token },
            body: JSON.stringify(edit),
          })
        )
      ).toEqual(refused(403));
    }
  });

  it("rejects a token from another start", async () => {
    const other = await start();
    expect(await guarded(({ port }) => save(port, other.token, edit))).toEqual(
      refused(403)
    );
  });

  it("rejects missing, foreign, wildcard, other-port and other-scheme origins", async () => {
    const origins: (string | undefined)[] = [
      undefined,
      "null",
      "",
      "http://evil.example",
      "http://evil.example:{port}",
      "http://127.0.0.1",
      "http://127.0.0.1:{other}",
      "http://127.0.0.1:*",
      "http://*:{port}",
      "https://127.0.0.1:{port}",
      "http://127.0.0.1:{port}/",
      "http://127.0.0.1.evil.example:{port}",
      "http://localhost.evil.example:{port}",
    ];
    for (const origin of origins) {
      expect(
        await guarded(({ port, token }) => {
          const base = saveHeaders(port, token);
          const headers =
            origin === undefined
              ? without(base, "origin")
              : {
                  ...base,
                  origin: origin
                    .replaceAll("{port}", String(port))
                    .replaceAll("{other}", String(port + 1)),
                };
          return call(port, {
            method: "POST",
            path: "/api/save",
            headers,
            body: JSON.stringify(edit),
          });
        })
      ).toEqual(refused(403));
    }
  });

  it("rejects Sec-Fetch-Site other than same-origin", async () => {
    for (const site of ["cross-site", "same-site", "none", "bogus"]) {
      expect(
        await guarded(({ port, token }) =>
          save(port, token, edit, { "sec-fetch-site": site })
        )
      ).toEqual(refused(403));
    }
  });

  it("rejects a foreign Host header, even with a valid token and origin", async () => {
    expect(
      await guarded(
        async ({ port, token }) =>
          await call(port, {
            method: "POST",
            path: "/api/save",
            host: "evil.example",
            headers: saveHeaders(port, token),
            body: JSON.stringify(edit),
          })
      )
    ).toEqual(refused(403));
  });

  it("applies the same checks to GET /api/model", async () => {
    const { port } = await start();
    expect((await call(port, { path: "/api/model" })).status).toBe(403);
    expect(
      (await call(port, { path: "/api/model", host: "evil.example" })).status
    ).toBe(403);
  });
});

describe("POST /api/save: content type (415), size (413), body (400)", () => {
  it("accepts only application/json", async () => {
    for (const type of [
      "text/plain",
      "multipart/form-data; boundary=x",
      "application/x-www-form-urlencoded",
      "application/json-patch+json",
      "application/jsonx",
      "application/json; charset=latin1",
      "",
    ]) {
      expect(
        await guarded(({ port, token }) =>
          save(port, token, edit, { "content-type": type })
        )
      ).toEqual(refused(415));
    }
  });

  it("answers 413 above 1 MiB, with a Content-Length or chunked", async () => {
    expect(
      await guarded(({ port, token }) =>
        call(port, {
          method: "POST",
          path: "/api/save",
          headers: saveHeaders(port, token),
          body: `{"edits":[],"pad":"${"x".repeat(MIB)}"}`,
        })
      )
    ).toEqual(refused(413));
    expect(
      await guarded(({ port, token }) => {
        const piece = "x".repeat(64 * 1024);
        return call(port, {
          method: "POST",
          path: "/api/save",
          headers: saveHeaders(port, token),
          chunks: ['{"edits":[],"pad":"', ...new Array(20).fill(piece), '"}'],
        });
      })
    ).toEqual(refused(413));
  });

  it("answers 400 for malformed JSON and bad schemas, without echoing input", async () => {
    const bodies = [
      "{not json",
      "",
      "[]",
      "null",
      '"x"',
      '{"edits":[],"statuses":[]}',
      '{"edits":[{"id":"SECRET-MARKER","lang":"ko","expectedOld":"a","new":"b"}]}',
      '{"edits":[{"id":"navigation.link.faq"}]}',
      '{"edits":[],"SECRET-KEY":1}',
    ];
    for (const body of bodies) {
      const ctx = await start();
      const before = snapshot(ctx.cfg);
      const res = await call(ctx.port, {
        method: "POST",
        path: "/api/save",
        headers: saveHeaders(ctx.port, ctx.token),
        body,
      });
      expect(res.status, body).toBe(400);
      expect(res.body).not.toContain("SECRET");
      expect(res.body).not.toContain(ctx.token);
      expect(snapshot(ctx.cfg)).toBe(before);
    }
  });

  it("answers 409 with the conflicts and leaves files unchanged", async () => {
    expect(
      await guarded(({ port, token }) =>
        save(port, token, {
          edits: [{ ...FAQ, expectedOld: "outdated" }],
          statuses: [
            { id: FAQ.id, state: "approved", expectedState: "edited" },
          ],
        })
      )
    ).toEqual(refused(409));
  });
});

describe("--read-only", () => {
  it("blocks writes with 403, reports readOnly in the model, keeps reads working", async () => {
    const { cfg, port, token } = await start({ readOnly: true });
    const before = snapshot(cfg);
    const res = await save(port, token, edit);
    expect(res.status).toBe(403);
    expect(snapshot(cfg)).toBe(before);
    const model = await call(port, {
      path: "/api/model",
      headers: { "x-studio-token": token },
    });
    expect(JSON.parse(model.body).readOnly).toBe(true);
  });
});

describe("shell token round trip", () => {
  it("the token from the shell works against the API", async () => {
    const { port } = await start();
    const token = await getShellToken(port);
    expect((await save(port, token, edit)).status).toBe(200);
  });
});
