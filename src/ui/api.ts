import type { Model, SaveConflict, SavePayload, SaveResult } from "../model";

/** The per-start API token, delivered in a meta tag of the studio shell (never in a URL). */
export const readToken = (doc: Pick<Document, "querySelector"> = document) =>
  doc.querySelector('meta[name="studio-token"]')?.getAttribute("content") ?? "";

type Deps = { fetch?: typeof fetch; token?: string };

/** A failed API call: `status` is the HTTP status; `conflicts` is set for 409. */
export class ApiError extends Error {
  readonly status: number;
  readonly conflicts?: SaveConflict[];
  constructor(status: number, message: string, conflicts?: SaveConflict[]) {
    super(message);
    this.status = status;
    this.conflicts = conflicts;
  }
}

const parseJson = async (res: Response) => {
  try {
    return (await res.json()) as {
      error?: string;
      conflicts?: SaveConflict[];
    };
  } catch {
    return {};
  }
};

export const fetchModel = async (deps: Deps = {}): Promise<Model> => {
  const res = await (deps.fetch ?? fetch)("/api/model", {
    headers: { "x-studio-token": deps.token ?? readToken() },
  });
  if (!res.ok) {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }
  return (await res.json()) as Model;
};

/** `POST /api/save`. Resolves with the result (including the fresh model); throws ApiError otherwise. */
export const saveBatch = async (
  payload: SavePayload,
  deps: Deps = {}
): Promise<SaveResult> => {
  const res = await (deps.fetch ?? fetch)("/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-studio-token": deps.token ?? readToken(),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await parseJson(res);
    throw new ApiError(
      res.status,
      body.error ?? `HTTP ${res.status}`,
      body.conflicts
    );
  }
  return (await res.json()) as SaveResult;
};
