// Renders an audit as the same kind of scorecard a run produces, so the free
// front door and the paid one read alike.

import type { AuditResult } from "./audit.js";

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const padL = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function table(headers: string[], rows: string[][], align: ("l" | "r")[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    "| " + cells.map((c, i) => (align[i] === "r" ? padL(c, widths[i]!) : pad(c, widths[i]!))).join(" | ") + " |";
  const sep =
    "|" + widths.map((w, i) => (align[i] === "r" ? "-".repeat(w + 1) + ":" : ":" + "-".repeat(w + 1))).join("|") + "|";
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "—");

export function renderAudit(result: AuditResult, startedAt: Date): string {
  const out: string[] = [];
  const total = result.pages.length;
  const stale = result.pages.filter((p) => p.stale).length;
  const empty = result.pages.filter((p) => p.empty).length;
  const owned = result.pages.filter((p) => p.owner).length;
  const reviewed = result.pages.filter((p) => p.reviewDate).length;
  const dups = result.duplicates.filter((d) => d.kind === "duplicate").length;
  const confirmed = result.findings.filter((f) => f.confirms).length;
  const fresh = result.findings.length - confirmed;

  out.push(`# Context audit — ${result.spaces.map((s) => s.space).join(", ")}`);
  out.push("");
  out.push(`${startedAt.toISOString().slice(0, 16).replace("T", " ")} · ${total} pages · no agent calls`);
  out.push("");
  out.push(
    `**tl;dr** — ${pct(owned, total)} of pages have an owner and ${pct(reviewed, total)} carry a review date. ${stale} are past their freshness window, ${empty} are empty, and ${dups} pair(s) duplicate each other. ${result.findings.length} findings` +
      (result.reconciledAgainst
        ? `, of which ${confirmed} confirm ones the hygiene loop already tracks and ${fresh} are new.`
        : "."),
  );
  out.push("");

  out.push("## By space");
  out.push("");
  out.push(
    table(
      ["space", "pages", "skipped", "median age", "p90 age", "stale", "owned", "reviewed", "drafts", "empty", "broken links"],
      result.spaces.map((s) => [
        s.space,
        String(s.pages),
        String(s.excluded),
        `${s.medianAgeDays}d`,
        `${s.p90AgeDays}d`,
        String(s.stale),
        pct(s.owned, s.pages),
        pct(s.reviewed, s.pages),
        String(s.drafts),
        String(s.empty),
        String(s.brokenLinks),
      ]),
      ["l", "r", "r", "r", "r", "r", "r", "r", "r", "r", "r"],
    ),
  );
  out.push("");
  out.push(
    "_`skipped` counts agent run records under `agents/` and `runs/`, which are bookkeeping rather than context. `stale` means past the page's half-life plus grace for its content class._",
  );
  out.push("");

  out.push("## Findings");
  out.push("");
  if (!result.findings.length) {
    out.push("_None._");
  } else {
    out.push(
      table(
        ["id", "kind", "finding", "pages", "smallest fix", "state"],
        result.findings.slice(0, 40).map((f) => [
          f.id,
          f.kind,
          f.finding,
          f.pages.slice(0, 2).join(", ") + (f.pages.length > 2 ? `, +${f.pages.length - 2}` : "") || "—",
          f.smallestFix,
          f.confirms ? `confirms ${f.confirms}` : "new",
        ]),
      ),
    );
    if (result.findings.length > 40) out.push(`\n_…and ${result.findings.length - 40} more._`);
  }
  out.push("");
  out.push(
    "_Same table shape as `loops/context-hygiene-report`, so one triage handles both. Ids are content-addressed: the same problem keeps the same id on every re-run._",
  );
  out.push("");

  const keys = Object.entries(result.reviewKeys).sort((a, b) => b[1] - a[1]);
  if (keys.length > 1 || result.typeMixes.length) {
    out.push("## Metadata hygiene");
    out.push("");
    if (keys.length > 1) {
      out.push(`Review dates arrive under **${keys.length}** different keys: ${keys.map(([k, n]) => `\`${k}\` ×${n}`).join(", ")}.`);
      out.push("");
    }
    if (result.typeMixes.length) {
      out.push(
        table(
          ["key", "types seen", "pages"],
          result.typeMixes.map((m) => [`\`${m.key}\``, m.types.join(", "), String(m.pages)]),
          ["l", "l", "r"],
        ),
      );
      out.push("");
    }
    out.push(
      "_A scorer that reads raw frontmatter silently mis-scores every page affected by either of these. The eval normalizes them; the fix is to stop needing to._",
    );
    out.push("");
  }

  return out.join("\n");
}
