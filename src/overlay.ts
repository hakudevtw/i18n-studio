import type { HtmlRow } from "./html.js";
import type { Proposal, ProposalRow } from "./proposal.js";

type Label = "changed" | "pending" | "confirmed";

/**
 * Lay a pending import proposal over the report rows: changed cells show the old
 * value struck through and the proposed one below. Rows the repo already reflects
 * (after `apply`) are left alone.
 */
export const overlayProposal = (
  rows: HtmlRow[],
  proposal: Proposal,
  locales: string[]
): { rows: HtmlRow[]; summary: string } => {
  const byId = new Map(rows.map((r) => [`${r.group}.${r.key}`, r]));
  const overlaid = new Map<HtmlRow, HtmlRow>();
  const counts: Record<Label, number> = {
    changed: 0,
    pending: 0,
    confirmed: 0,
  };
  const entries: [ProposalRow, Label][] = [
    ...proposal.rows.map((r): [ProposalRow, Label] => [r, "changed"]),
    ...proposal.pending.map((r): [ProposalRow, Label] => [r, "pending"]),
    ...proposal.confirmed.map((r): [ProposalRow, Label] => [r, "confirmed"]),
  ];
  for (const [pr, label] of entries) {
    const base = byId.get(pr.id);
    if (!base) {
      continue;
    }
    let differs = false;
    const cells = base.cells.map((cell, i) => {
      const change = pr.changes[locales[i]];
      if (!change || change.new === cell.text) {
        return cell;
      }
      differs = true;
      return {
        ...cell,
        text: change.new,
        old: cell.text,
        changed: true,
        title: "proposed change",
      };
    });
    const alreadyDone = label === "confirmed" && base.status === "approved";
    if (!(differs || label === "confirmed") || alreadyDone) {
      continue;
    }
    counts[label] += 1;
    overlaid.set(base, {
      ...base,
      status: pr.reject ? "rejected" : label,
      cells,
    });
  }
  const extra: HtmlRow[] = (["ambiguous", "unmatched"] as const).flatMap(
    (kind) =>
      proposal[kind].map((e) => ({
        group: kind,
        key: `${e.key ?? e.source ?? e.where} ${e.candidates.join(" | ")}`.trim(),
        status: kind,
        cells: locales.map((l) => ({ text: e.values[l] ?? "" })),
      }))
  );
  const parts = [
    counts.changed && `${counts.changed} changed`,
    counts.pending && `${counts.pending} pending (partial)`,
    counts.confirmed && `${counts.confirmed} confirmed`,
    extra.length && `${extra.length} need manual resolution`,
  ].filter(Boolean);
  return {
    rows: [...rows.map((r) => overlaid.get(r) ?? r), ...extra],
    summary:
      parts.length === 0
        ? ""
        : `Import proposal pending: ${parts.join(", ")}. Old values are struck through; nothing is written until \`apply\`.`,
  };
};
