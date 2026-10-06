import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The only files the server may ever serve; request paths are never turned into file paths. */
export const ASSETS = {
  "/app.js": { file: "app.js", type: "text/javascript" },
  "/app.css": { file: "app.css", type: "text/css" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
} as const;

/** dist/ui next to the compiled code, or ../dist/ui when running from src (tests). */
const uiDir = () => {
  const candidates = [
    join(import.meta.dirname, "ui"),
    join(import.meta.dirname, "../dist/ui"),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, "app.js")));
  if (!found) {
    throw new Error(
      "UI assets not built; run `yarn build` (or `yarn build:ui`)"
    );
  }
  return found;
};

export const readAsset = (name: (typeof ASSETS)[keyof typeof ASSETS]["file"]) =>
  readFileSync(join(uiDir(), name), "utf8");
