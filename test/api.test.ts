import { describe, expect, it, vi } from "vitest";
import { ApiError, fetchModel, readToken, saveBatch } from "../src/ui/api.js";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const payload = {
  edits: [{ id: "a.b", lang: "ko", expectedOld: "x", new: "y" }],
  statuses: [],
};

describe("ui api client", () => {
  it("reads the token from the meta tag", () => {
    const doc = {
      querySelector: (selector: string) =>
        selector === 'meta[name="studio-token"]'
          ? { getAttribute: () => "abc" }
          : null,
    };
    expect(readToken(doc as never)).toBe("abc");
    expect(readToken({ querySelector: () => null } as never)).toBe("");
  });

  it("sends the token on /api/model", async () => {
    const fetch = reply(200, { rows: [] });
    await fetchModel({ fetch, token: "tok" });
    expect(fetch).toHaveBeenCalledWith("/api/model", {
      headers: { "x-studio-token": "tok" },
    });
    await expect(
      fetchModel({ fetch: reply(403, {}), token: "bad" })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("posts a save with the token and JSON, and returns the result", async () => {
    const result = { ok: true, written: { files: 1, cells: 1 } };
    const fetch = reply(200, result);
    expect(await saveBatch(payload, { fetch, token: "tok" })).toEqual(result);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/save");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-studio-token": "tok",
    });
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("throws ApiError with the conflicts on 409 and the message on 400", async () => {
    const conflicts = [{ id: "a.b", lang: "ko", kind: "value", current: "z" }];
    const conflict = await saveBatch(payload, {
      fetch: reply(409, { ok: false, error: "conflict", conflicts }),
      token: "t",
    }).catch((e) => e);
    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict).toMatchObject({ status: 409, conflicts });
    await expect(
      saveBatch(payload, {
        fetch: reply(400, { error: "nothing to save" }),
        token: "t",
      })
    ).rejects.toMatchObject({ status: 400, message: "nothing to save" });
    await expect(
      saveBatch(payload, {
        fetch: vi.fn(async () => new Response("nope", { status: 403 })),
        token: "t",
      })
    ).rejects.toMatchObject({ status: 403, message: "HTTP 403" });
  });
});
