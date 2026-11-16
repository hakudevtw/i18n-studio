// Builds demo/index.html: a sample report with a mix of review states, for GitHub Pages.
// Run after `pnpm build`.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), "i18n-demo-"));
const dir = join(work, "messages");
const out = join(work, "report");
cpSync(join(root, "demo/messages"), dir, { recursive: true });

const cli = (...args) =>
  execFileSync(
    "node",
    [join(root, "dist/bin.js"), "--dir", dir, "--report-dir", out, ...args],
    { cwd: work, stdio: ["ignore", "pipe", "inherit"] }
  );

cli("init");
cli("draft", "nav.signIn", "checkout.coupon.apply");
cli("export", "--ns", "checkout");
cli("set", "ja", "nav.pricing", "価格");
cli("report");

mkdirSync(join(root, "demo/dist"), { recursive: true });
cpSync(join(out, "report.html"), join(root, "demo/dist/index.html"));
rmSync(work, { recursive: true, force: true });
console.log("wrote demo/dist/index.html");
