import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const path = "skills/i18n-studio/SKILL.md";
const text = readFileSync(path, "utf8");
const marker = /^i18n-studio-version:\s*\S+\s*$/m;
if (!marker.test(text)) {
  throw new Error(`${path} is missing its i18n-studio-version marker`);
}
writeFileSync(
  path,
  text.replace(marker, `i18n-studio-version: ${pkg.version}`)
);
