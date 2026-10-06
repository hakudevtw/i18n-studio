import { readAsset } from "./assets.js";
import type { Model } from "./model.js";

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const HEAD =
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';

/** Studio shell: no inline script or style; the page loads /app.js and /app.css. */
export const renderShell = (title = "Translation status") =>
  `<!doctype html>
<html lang="en"><head>${HEAD}<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/app.css"></head><body>
<div id="root"></div>
<script src="/app.js"></script></body></html>
`;

/** Keep an inlined script/style from closing or opening anything in the HTML parser. */
const inlineSafe = (code: string, tag: "script" | "style") =>
  code.replaceAll(`</${tag}`, `<\\/${tag}`).replaceAll("<!--", "<\\!--");

/**
 * One self-contained file for sharing: built JS/CSS inlined, model embedded as JSON.
 * No network access. `<` is escaped in the JSON so values can never close the script.
 */
export const renderReport = (model: Model): string => {
  const data = JSON.stringify(model).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head>${HEAD}<title>${escapeHtml(model.title)}</title>
<style>${inlineSafe(readAsset("app.css"), "style")}</style></head><body>
<div id="root"></div>
<script type="application/json" id="data">${data}</script>
<script>${inlineSafe(readAsset("app.js"), "script")}</script></body></html>
`;
};
