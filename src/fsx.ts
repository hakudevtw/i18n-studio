import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type WriteFile = { path: string; content: string };
export type FsHooks = { rename?: (from: string, to: string) => void };

const tempName = (path: string) =>
  `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

const remove = (path: string) => {
  try {
    rmSync(path, { force: true });
  } catch {
    // best effort
  }
};

/** Put `content` at `path` the same way the real write does (temp + rename), ignoring failures. */
const restore = (path: string, content: string | undefined) => {
  if (content === undefined) {
    remove(path);
    return;
  }
  const tmp = tempName(path);
  try {
    writeFileSync(tmp, content, { flag: "wx" });
    renameSync(tmp, path);
  } catch {
    remove(tmp);
  }
};

/**
 * The one write path for everything the tool writes. Every file is first written to an
 * unpredictably named temp file in its own directory, then all of them are renamed into
 * place. Each rename is atomic; the batch as a whole is best effort: if a rename fails,
 * leftover temps are removed and files already renamed are restored from memory. A crash
 * between renames can still leave a mix of old and new files.
 */
export const atomicWriteAll = (files: WriteFile[], hooks: FsHooks = {}) => {
  const rename = hooks.rename ?? renameSync;
  const temps: string[] = [];
  const originals = new Map<string, string | undefined>();
  const renamed: string[] = [];
  try {
    for (const { path, content } of files) {
      mkdirSync(dirname(path), { recursive: true });
      originals.set(
        path,
        existsSync(path) ? readFileSync(path, "utf8") : undefined
      );
      const tmp = tempName(path);
      temps.push(tmp);
      writeFileSync(tmp, content, { flag: "wx" });
      if (existsSync(path)) {
        chmodSync(
          tmp,
          Number.parseInt(statSync(path).mode.toString(8).slice(-3), 8)
        );
      }
    }
    for (const [i, { path }] of files.entries()) {
      rename(temps[i], path);
      renamed.push(path);
    }
  } catch (e) {
    for (const tmp of temps) {
      remove(tmp);
    }
    for (const path of renamed) {
      restore(path, originals.get(path));
    }
    throw e;
  }
};
