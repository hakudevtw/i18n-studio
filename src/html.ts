export type HtmlCell = {
  text: string;
  /** Previous value; rendered struck through before `text` (proposal diffs). */
  old?: string;
  /** Highlight (value changed since the recorded state). */
  changed?: boolean;
  title?: string;
};
export type HtmlRow = {
  /** Sidebar group, normally the namespace. */
  group: string;
  key: string;
  /** One badge per row. */
  status: string;
  cells: HtmlCell[];
};
export type HtmlModel = {
  title: string;
  banner?: string;
  /** Headers for `cells` (locales). */
  columns: string[];
  rows: HtmlRow[];
  /** Studio "Copy as TSV" starts with a header row unless this is false. Set by the server. */
  copyHeader?: boolean;
};

const CSS = `
:root{color-scheme:light dark;--bar-h:56px;--bg:light-dark(#ffffff,#0b0d12);--fg:light-dark(#0f172a,#e6e8ee);--muted:light-dark(#64748b,#8b93a7);--line:light-dark(#e5e7eb,#232834);--panel:light-dark(#f8fafc,#11141b);--hover:light-dark(#f1f5f9,#181c26);--sel:light-dark(#eef2ff,#1e2142);--accent:light-dark(#4f46e5,#818cf8);--hl:light-dark(rgba(245,158,11,.16),rgba(251,191,36,.14));--banner:light-dark(#fffbeb,#2a2208)}
*{box-sizing:border-box}
body{font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;color:var(--fg);background:var(--bg);height:100vh;display:grid;grid-template-columns:248px 1fr;overflow:hidden;-webkit-font-smoothing:antialiased}
aside{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0}
aside h1{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0;padding:0 16px;height:var(--bar-h);display:flex;align-items:center;border-bottom:1px solid var(--line)}
#side{list-style:none;margin:0;padding:8px;overflow-y:auto;flex:1}
#side button{all:unset;box-sizing:border-box;width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--fg)}
#side button:hover{background:var(--hover)}
#side button[aria-current=true]{background:var(--sel);color:var(--accent);font-weight:600}
#side button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
#side .n{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
#side button[aria-current=true] .n{color:var(--accent)}
#side .zero{opacity:.4}
main{display:flex;flex-direction:column;min-width:0;min-height:0}
.bar{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:0 16px;height:var(--bar-h);border-bottom:1px solid var(--line)}
.bar h2{font-size:15px;font-weight:700;letter-spacing:-.01em;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#count{color:var(--muted);font-size:13px;white-space:nowrap}
#banner{background:var(--banner);padding:8px 16px;border-bottom:1px solid var(--line);font-size:13px}
.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line)}
input,select,button.act{font:inherit;font-size:13px;height:34px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
input:focus-visible,select:focus-visible,button.act:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
input[type=search]{flex:1 1 180px;max-width:320px}
button.act{cursor:pointer;background:var(--panel);font-weight:500}
button.act:hover{background:var(--hover)}
.scroll{flex:1;overflow:auto;min-height:0}
table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%}
th,td{padding:10px 14px;vertical-align:top;text-align:left;border-bottom:1px solid var(--line);border-right:1px solid var(--line)}
th{position:sticky;top:0;z-index:2;background:var(--panel);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
td.text{white-space:pre-wrap;overflow-wrap:anywhere}
td.status,td.key,th.status,th.key{position:sticky;background:var(--panel);z-index:1}
th.status,th.key{z-index:3}
.status{left:0}
.key{left:var(--status-w)}
td.key{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow-wrap:anywhere}
tr:hover td{background:var(--hover)}
tr:hover td.status,tr:hover td.key{background:var(--hover)}
tr:hover td.changed{background:var(--hl)}
td.changed{background:var(--hl)}
del{display:block;color:var(--muted)}
tr.group td{background:var(--panel);font-weight:600;font-size:12px;color:var(--accent);padding:8px 14px}
tr.group td.label{position:sticky;left:0;z-index:1}
tr.group:hover td{background:var(--panel)}
.badge{--c:#64748b;display:inline-block;border-radius:999px;padding:0 8px;font-size:11px;line-height:18px;font-weight:600;white-space:nowrap;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.b-missing,.b-unmatched{--c:light-dark(#e11d48,#fb7185)}
.b-stale,.b-ambiguous,.b-pending{--c:light-dark(#b45309,#fbbf24)}
.b-edited,.b-changed{--c:light-dark(#0369a1,#38bdf8)}
.b-new{--c:light-dark(#7c3aed,#a78bfa)}
.b-ai-draft{--c:light-dark(#c026d3,#e879f9)}
.b-in-review{--c:light-dark(#0f766e,#2dd4bf)}
.b-approved,.b-confirmed,.b-unchanged{--c:light-dark(#047857,#34d399)}
.empty{padding:48px;text-align:center;color:var(--muted)}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--fg);padding:16px;width:min(720px,90vw)}
dialog::backdrop{background:rgba(0,0,0,.4)}
dialog p{margin:0 0 8px;font-size:13px;color:var(--muted)}
dialog textarea{width:100%;height:260px;font:12px/1.5 ui-monospace,Menlo,monospace;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg);padding:8px}
dialog .row{display:flex;justify-content:flex-end;margin-top:12px}
`;

// String.raw keeps the backslashes below literal. No template literals inside.
const SCRIPT = String.raw`
const model = JSON.parse(document.getElementById("data").textContent);
const $ = (id) => document.getElementById(id);
const STATUS_W = 120, KEY_W = 260, COL_W = 280;
document.documentElement.style.setProperty("--status-w", STATUS_W + "px");
for (const s of new Set(model.rows.map((r) => r.status))) $("status").add(new Option(s, s));
model.columns.forEach((c, i) => $("lang").add(new Option(c, String(i))));
if (model.banner) { $("banner").textContent = model.banner; } else { $("banner").hidden = true; }
const groups = [...new Set(model.rows.map((r) => r.group))];
let group = decodeURIComponent(location.hash.slice(1));
if (!groups.includes(group)) group = "";
let visible = [], cols = [];
const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
function render() {
  const q = $("q").value.toLowerCase(), st = $("status").value, lang = $("lang").value;
  cols = model.columns.map((_, i) => i).filter((i) => lang === "" || String(i) === lang);
  const base = model.rows.filter((r) => (!st || r.status === st) &&
    (!q || r.key.toLowerCase().includes(q) || cols.some((i) => r.cells[i] && (r.cells[i].text + (r.cells[i].old || "")).toLowerCase().includes(q))));
  visible = base.filter((r) => !group || r.group === group);
  renderSide(base);
  renderTable();
  $("heading").textContent = group || "All";
  $("count").textContent = visible.length + " rows" + (group ? "" : " in " + groups.length + " groups");
}
function renderSide(base) {
  const side = $("side"); side.replaceChildren();
  for (const g of ["", ...groups]) {
    const n = base.filter((r) => !g || r.group === g).length;
    const b = el("button", { type: "button", className: n === 0 ? "zero" : "" },
      el("span", { textContent: g || "All" }), el("span", { className: "n", textContent: String(n) }));
    b.setAttribute("aria-current", String(g === group));
    b.onclick = () => { group = g; history.replaceState(null, "", g ? "#" + encodeURIComponent(g) : location.pathname); render(); $("scroll").scrollTo(0, 0); };
    side.appendChild(el("li", {}, b));
  }
}
function renderTable() {
  const table = $("table"); table.replaceChildren();
  $("empty").hidden = visible.length > 0; table.hidden = visible.length === 0;
  if (visible.length === 0) return;
  table.style.minWidth = STATUS_W + KEY_W + cols.length * COL_W + "px";
  const colgroup = el("colgroup", {});
  colgroup.append(el("col", { style: "width:" + STATUS_W + "px" }), el("col", { style: "width:" + KEY_W + "px" }));
  for (const _ of cols) colgroup.appendChild(el("col", {}));
  table.appendChild(colgroup);
  const head = table.insertRow();
  head.append(el("th", { className: "status", textContent: "status" }), el("th", { className: "key", textContent: "key" }));
  for (const i of cols) head.appendChild(el("th", { textContent: model.columns[i] }));
  let current = null;
  for (const r of visible) {
    if (!group && r.group !== current) {
      current = r.group;
      const g = table.insertRow(); g.className = "group";
      // Two cells: a label as wide as status+key (so it can stick at left:0) and a filler.
      const label = g.insertCell(); label.colSpan = 2; label.className = "label"; label.textContent = current;
      g.insertCell().colSpan = Math.max(1, cols.length);
    }
    const tr = table.insertRow();
    const s = tr.insertCell(); s.className = "status";
    s.appendChild(el("span", { className: "badge b-" + r.status, textContent: r.status }));
    const k = tr.insertCell(); k.className = "key"; k.textContent = r.key;
    for (const i of cols) {
      const c = r.cells[i], td = tr.insertCell(); td.className = "text";
      if (!c) continue;
      if (c.changed) { td.classList.add("changed"); td.title = c.title || "changed since approved"; }
      if (c.old !== undefined) td.appendChild(el("del", { textContent: c.old }));
      td.appendChild(document.createTextNode(c.text));
    }
  }
}
function quote(s) { return s.includes('"') || s.includes("\t") || s.includes("\n") ? '"' + s.split('"').join('""') + '"' : s; }
async function copyText(text) {
  try {
    if (navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through to the legacy path */ }
  const ta = el("textarea", { value: text, readOnly: true });
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { /* blocked */ }
  ta.remove();
  return ok;
}
function tsvText() {
  const multiNs = new Set(visible.map((r) => r.group)).size > 1;
  const lines = [];
  if (model.copyHeader !== false) lines.push(["status", ...(multiNs ? ["namespace"] : []), "key", ...cols.map((i) => model.columns[i])].map(quote).join("\t"));
  for (const r of visible) lines.push([r.status, ...(multiNs ? [r.group] : []), r.key, ...cols.map((i) => (r.cells[i] ? r.cells[i].text : ""))].map(quote).join("\t"));
  return lines.join("\n");
}
$("copy").onclick = async () => {
  const text = tsvText();
  const ok = await copyText(text);
  if (!ok) { $("manualText").value = text; $("manual").showModal(); $("manualText").select(); }
  $("copy").textContent = ok ? "Copied!" : "Copy blocked";
  setTimeout(() => { $("copy").textContent = "Copy as TSV"; }, 1500);
};
$("manualClose").onclick = () => $("manual").close();
for (const id of ["q", "status", "lang"]) $(id).oninput = render;
render();
`;

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Self-contained, read-only page (inline CSS/JS, no network). */
export const renderHtml = (model: HtmlModel): string => {
  const data = JSON.stringify(model).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.title)}</title>
<style>${CSS}</style></head><body>
<aside><h1>${escapeHtml(model.title)}</h1><ul id="side"></ul></aside>
<main>
<div class="bar"><h2 id="heading"></h2><span id="count"></span></div>
<div id="banner"></div>
<div class="filters"><input id="q" type="search" placeholder="Search key or text">
<select id="status" aria-label="Status"><option value="">All statuses</option></select>
<select id="lang" aria-label="Language"><option value="">All languages</option></select>
<button class="act" id="copy" type="button">Copy as TSV</button></div>
<div class="scroll" id="scroll"><table id="table"></table><div class="empty" id="empty" hidden>No rows match the current filters.</div></div>
</main>
<dialog id="manual"><p>This viewer blocks clipboard access. Select all, then copy (Cmd/Ctrl+C) and paste into Google Sheets.</p><textarea id="manualText" readonly></textarea><div class="row"><button class="act" id="manualClose" type="button">Close</button></div></dialog>
<script type="application/json" id="data">${data}</script>
<script>${SCRIPT}</script></body></html>
`;
};
