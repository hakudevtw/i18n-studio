import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../src/config.js";

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      })
    : [];

/** Every file under the messages and status dirs, with its content. */
export const snapshot = (cfg: Config) =>
  [...walk(cfg.i18nDir), ...walk(cfg.statusDir)]
    .sort()
    .map((p) => `${p}\n${readFileSync(p, "utf8")}`)
    .join("\n---\n");

export const tmpFiles = (cfg: Config) =>
  [...walk(cfg.i18nDir), ...walk(cfg.statusDir), ...walk(cfg.reportDir)].filter(
    (p) => p.endsWith(".tmp")
  );
