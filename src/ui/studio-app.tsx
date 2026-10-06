import type { VNode } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Banner, Model, ModelRow } from "../model";
import { fetchModel } from "./api";
import { makeT, resolveLocale, type Translator } from "./i18n";
import { tsvText } from "./tsv";

const COPY_RESET_MS = 1500;

/** Static report: the model is embedded. Studio: fetch it fresh from the server. */
const loadModel = async (): Promise<Model> => {
  const embedded = document.getElementById("data")?.textContent;
  return embedded ? (JSON.parse(embedded) as Model) : await fetchModel();
};

const localeFor = (setting?: Model["uiLocale"]) =>
  resolveLocale({
    query: new URLSearchParams(location.search).get("lang"),
    setting,
    languages: navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
  });

const bannerText = (b: Banner, { t }: Translator) => {
  if (b.kind === "noRecords") {
    return t("banner.noRecords");
  }
  const parts = (
    [
      ["banner.changed", b.changed],
      ["banner.pending", b.pending],
      ["banner.confirmed", b.confirmed],
      ["banner.manual", b.manual],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([key, n]) => t(key, { n }));
  return t("banner.proposal", { parts: parts.join(", ") });
};

/** Clipboard API, with the legacy textarea path for viewers that block it. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  const ta = document.createElement("textarea");
  ta.className = "offscreen";
  ta.value = text;
  ta.readOnly = true;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    // blocked
  }
  ta.remove();
  return ok;
};

const groupFromHash = (groups: string[]) => {
  const wanted = decodeURIComponent(location.hash.slice(1));
  return groups.includes(wanted) ? wanted : "";
};

const matches = (r: ModelRow, q: string, cols: number[]) =>
  !q ||
  r.key.toLowerCase().includes(q) ||
  cols.some((i) => {
    const c = r.cells[i];
    return c && `${c.text}${c.old ?? ""}`.toLowerCase().includes(q);
  });

type CopyState = "copy" | "copied" | "copyBlocked";

const Report = ({ model, tr }: { model: Model; tr: Translator }) => {
  const { t, has } = tr;
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [lang, setLang] = useState("");
  const groups = useMemo(
    () => [...new Set(model.rows.map((r) => r.group))],
    [model]
  );
  const statuses = useMemo(
    () => [...new Set(model.rows.map((r) => r.status))],
    [model]
  );
  const [group, setGroup] = useState(() => groupFromHash(groups));
  const [copyState, setCopyState] = useState<CopyState>("copy");
  const [manual, setManual] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);

  const statusLabel = (s: string) =>
    has(`status.${s}`) ? t(`status.${s}`) : s;
  const groupLabel = (g: string) =>
    has(`groupName.${g}`) ? t(`groupName.${g}`) : g;

  const cols = model.columns
    .map((_, i) => i)
    .filter((i) => lang === "" || String(i) === lang);
  const needle = q.toLowerCase();
  const base = model.rows.filter(
    (r) => (!status || r.status === status) && matches(r, needle, cols)
  );
  const visible = base.filter((r) => !group || r.group === group);

  useEffect(() => {
    if (manual !== null) {
      dialogRef.current?.showModal();
      manualRef.current?.select();
    }
  }, [manual]);

  const pick = (g: string) => {
    setGroup(g);
    history.replaceState(
      null,
      "",
      g ? `#${encodeURIComponent(g)}` : location.pathname
    );
    scrollRef.current?.scrollTo(0, 0);
  };

  const copy = async () => {
    const text = tsvText(visible, model.columns, cols, model.copyHeader);
    const ok = await copyText(text);
    if (!ok) {
      setManual(text);
    }
    setCopyState(ok ? "copied" : "copyBlocked");
    setTimeout(() => setCopyState("copy"), COPY_RESET_MS);
  };

  const banner = model.banners.map((b) => bannerText(b, tr)).join(" ");
  let current: string | null = null;

  return (
    <>
      <aside>
        <h1>{t("title")}</h1>
        <ul id="side">
          {["", ...groups].map((g) => {
            const n = base.filter((r) => !g || r.group === g).length;
            return (
              <li key={g}>
                <button
                  aria-current={g === group}
                  class={n === 0 ? "zero" : ""}
                  onClick={() => pick(g)}
                  type="button"
                >
                  <span>{g ? groupLabel(g) : t("sidebar.all")}</span>
                  <span class="n">{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <main>
        <div class="bar">
          <h2>{group ? groupLabel(group) : t("sidebar.all")}</h2>
          <span id="count">
            {group
              ? t("rows", { n: visible.length })
              : t("rowsInGroups", { n: visible.length, g: groups.length })}
          </span>
        </div>
        {banner && <div id="banner">{banner}</div>}
        <div class="filters">
          <input
            aria-label={t("search.placeholder")}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            placeholder={t("search.placeholder")}
            type="search"
            value={q}
          />
          <select
            aria-label={t("filter.status")}
            onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}
            value={status}
          >
            <option value="">{t("filter.statusAll")}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filter.lang")}
            onChange={(e) => setLang((e.target as HTMLSelectElement).value)}
            value={lang}
          >
            <option value="">{t("filter.langAll")}</option>
            {model.columns.map((c, i) => (
              <option key={c} value={String(i)}>
                {c}
              </option>
            ))}
          </select>
          <button class="act" onClick={copy} type="button">
            {t(copyState)}
          </button>
        </div>
        <div class="scroll" ref={scrollRef}>
          {visible.length === 0 ? (
            <div class="empty">{t("empty")}</div>
          ) : (
            <table style={{ "--cols": cols.length }}>
              <colgroup>
                <col class="c-status" />
                <col class="c-key" />
                {cols.map((i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th class="status">{t("col.status")}</th>
                  <th class="key">{t("col.key")}</th>
                  {cols.map((i) => (
                    <th key={i}>{model.columns[i]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.flatMap((r) => {
                  const out: VNode[] = [];
                  if (!group && r.group !== current) {
                    current = r.group;
                    out.push(
                      <tr class="group" key={`g:${r.group}`}>
                        <td class="label" colSpan={2}>
                          {groupLabel(r.group)}
                        </td>
                        <td colSpan={Math.max(1, cols.length)} />
                      </tr>
                    );
                  }
                  out.push(
                    <tr key={`${r.group}.${r.key}`}>
                      <td class="status">
                        <span class={`badge b-${r.status}`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td class="key">{r.key}</td>
                      {cols.map((i) => {
                        const c = r.cells[i];
                        return (
                          <td
                            class={c?.changed ? "text changed" : "text"}
                            key={i}
                            title={
                              c?.changed
                                ? t(
                                    c.mark === "proposed"
                                      ? "cell.proposed"
                                      : "cell.changed"
                                  )
                                : undefined
                            }
                          >
                            {c?.old !== undefined && <del>{c.old}</del>}
                            {c?.text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                  return out;
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>
      {manual !== null && (
        <dialog onClose={() => setManual(null)} ref={dialogRef}>
          <p>{t("dialog.text")}</p>
          <textarea readOnly ref={manualRef} value={manual} />
          <div class="row">
            <button
              class="act"
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              {t("dialog.close")}
            </button>
          </div>
        </dialog>
      )}
    </>
  );
};

export const App = () => {
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadModel().then(setModel, (e: Error) => setError(e.message));
  }, []);
  const tr = useMemo(() => makeT(localeFor(model?.uiLocale)), [model]);

  useEffect(() => {
    const locale = localeFor(model?.uiLocale);
    document.documentElement.lang = locale;
    document.title = tr.t("title");
  }, [model, tr]);

  if (error) {
    return <div class="empty">{tr.t("loadError", { error })}</div>;
  }
  return model ? (
    <Report model={model} tr={tr} />
  ) : (
    <div class="empty">{tr.t("loading")}</div>
  );
};
