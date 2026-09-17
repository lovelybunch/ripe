// Phase 1 scorecard: the arm comparison, the source registry, and the exact
// command lines. Judged dimensions arrive in Phase 3; everything here is
// mechanical, so nothing in this report depends on a model's opinion.

import { NEVER_QUOTE } from "./config.js";
import { CANARY_QUESTION_ID } from "./assert.js";
import type { Cell, Role, SourceRecord } from "./types.js";
import type { RunResult } from "./runner.js";
import type { Evaluation } from "./evaluate.js";
import { renderAgentTask } from "./automate.js";
import { DIMENSIONS } from "./config.js";

const pad = (s: string, n: number) => s.length >= n ? s : s + " ".repeat(n - s.length);
const padL = (s: string, n: number) => s.length >= n ? s : " ".repeat(n - s.length) + s;

function table(headers: string[], rows: string[][], align: ("l" | "r")[] = []): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    "| " +
    cells
      .map((c, i) => (align[i] === "r" ? padL(c, widths[i]!) : pad(c, widths[i]!)))
      .join(" | ") +
    " |";
  const sep = "|" + widths.map((w, i) => (align[i] === "r" ? "-".repeat(w + 1) + ":" : ":" + "-".repeat(w + 1))).join("|") + "|";
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

/**
 * One path vocabulary for the whole report. A Coconut page is `space/page`;
 * the files arm sees the same page as an absolute path into the export folder.
 * Without stripping that prefix the two arms' rows cannot be read side by
 * side, which is the entire purpose of the table.
 */
const shortPath = (p: string): string =>
  (/(?:^|\/)corpora\/[^/]+\/(.+?)(?:\.md)?$/.exec(p)?.[1] ?? p).replace(/\.md$/, "");

const money = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sources the answer actually leaned on: opened, and not merely listed. */
function grounded(cell: Cell): SourceRecord[] {
  return cell.sources.filter((s) => s.access === "read" && !s.isError);
}

interface ArmSummary {
  armId: string;
  cells: Cell[];
  answered: number;
  total: number;
  groundedMedian: number;
  uncited: number;
  costPerAnswer: number;
  medianMs: number;
  failures: number;
  violations: number;
}

function summarize(cells: Cell[], armId: string): ArmSummary {
  const mine = cells.filter((c) => c.armId === armId && c.questionId !== CANARY_QUESTION_ID);
  const ok = mine.filter((c) => c.status === "ok");
  return {
    armId,
    cells: mine,
    answered: ok.filter((c) => grounded(c).length > 0).length,
    total: mine.length,
    groundedMedian: median(ok.map((c) => grounded(c).length)),
    uncited: mine.reduce((n, c) => n + c.sources.filter((s) => s.claimedOnly).length, 0),
    costPerAnswer: ok.length ? mine.reduce((n, c) => n + c.usage.costUsd, 0) / ok.length : 0,
    medianMs: median(ok.map((c) => c.usage.durationMs)),
    failures: mine.filter((c) => c.status !== "ok").length,
    violations: mine.reduce((n, c) => n + c.violations.length, 0),
  };
}

function flags(row: SourceRecord): string {
  const out: string[] = [];
  if (row.agentWrittenOnly) out.push("agent-only");
  else if (row.humanStale) out.push("human-stale");
  if (row.status && /draft|placeholder|wip|stub/i.test(row.status)) out.push("draft");
  if (!row.owner && row.hydration === "hydrated") out.push("no-owner");
  if (row.claimedOnly) out.push("uncited");
  if (row.hydration === "unavailable") out.push("unreadable");
  return out.join(" ") || "—";
}

/** `read` outranks `search`/`list`: what matters is whether content was opened. */
const ACCESS_RANK = { read: 3, meta: 2, search: 1, list: 0 } as const;

/** One row per distinct source across the whole run, worst-first. */
function registryTable(cells: Cell[]): string {
  const merged = new Map<string, SourceRecord & { uses: number }>();
  for (const cell of cells) {
    for (const row of cell.sources) {
      const existing = merged.get(row.uri);
      if (existing) {
        existing.uses += 1;
        existing.reads += row.reads;
        existing.claimedOnly = existing.claimedOnly || row.claimedOnly;
        existing.contributed = existing.contributed || row.contributed;
        // Take the strongest access the source ever received. Without this, a
        // page globbed in one cell and read in another shows as merely listed.
        if (ACCESS_RANK[row.access] > ACCESS_RANK[existing.access]) existing.access = row.access;
      } else {
        merged.set(row.uri, { ...row, uses: 1 });
      }
    }
  }

  const rows = [...merged.values()]
    .filter((r) => r.access === "read")
    // The top of the table should be the sources that mattered most and are
    // least fresh — that is the work queue, and it needs no filtering to find.
    .sort((a, b) => b.uses - a.uses || (a.freshness ?? 1) - (b.freshness ?? 1))
    .slice(0, 30)
    .map((r) => {
      const path = shortPath(r.path);
      return [
      path.length > 44 ? "…" + path.slice(-43) : path,
      r.connector,
      r.version != null ? `v${r.version}` : "—",
      r.ageDays != null ? `${Math.round(r.ageDays)}d` : "—",
      r.owner ?? "—",
      r.lastHumanEdit ? r.lastHumanEdit.slice(0, 10) : r.editorType === "agent" ? "never" : "—",
      r.editorType ?? "—",
      r.freshness != null ? r.freshness.toFixed(2) : "—",
      String(r.uses),
      flags(r),
    ];
    });

  if (!rows.length) return "_No sources were opened by any arm._";
  return table(
    ["source", "via", "ver", "age", "owner", "last human edit", "by", "fresh", "used", "flags"],
    rows,
    ["l", "l", "r", "r", "l", "l", "l", "r", "r", "l"],
  );
}

/**
 * Section 1 of Act, and the reason the tool exists. The count going up over
 * successive runs is the product outcome — more so than the composite score.
 */
function automationSection(role: Role, evaluation: Evaluation, armIds: string[]): string[] {
  const out: string[] = ["## 1 · What you can automate today", ""];

  // Report against the best arm: the question is what is possible with the
  // context you have, not what is possible with none of it.
  const best = [...evaluation.arms].sort((a, b) => b.composite - a.composite)[0];
  if (!best) return [...out, "_Nothing was scored._", ""];

  const summary = evaluation.automation.get(best.armId);
  if (!summary) return [...out, "_Nothing was scored._", ""];

  out.push(`With **${best.armId}** connected: **${summary.ratio}** jobs clear the bar.`);
  out.push("");

  const label = { automate: "✅", with_review: "⚠️", not_yet: "❌" } as const;
  const rows = evaluation.calls
    .filter((c) => c.armId === best.armId)
    .map((c) => [
      `${label[c.verdict]} ${c.questionId}`,
      c.verdict === "automate" ? "ready" : c.verdict === "with_review" ? "needs a human" : "blocked",
      c.reasons[0] ?? "",
    ]);
  out.push(table(["job", "verdict", "why"], rows));
  out.push("");

  if (summary.automate.length) {
    out.push("Ready-to-run agent tasks, with the checked sources pinned:");
    out.push("");
    for (const call of summary.automate) {
      const question = role.questions.find((q) => q.id === call.questionId);
      if (!question) continue;
      out.push("```yaml");
      out.push(renderAgentTask(role.id, question, call));
      out.push("```");
      out.push("");
    }
  } else {
    out.push(
      "_Nothing clears the bar yet. The findings below are ordered by how much each one would move that._",
    );
    out.push("");
  }
  return out;
}


/** Section 2: ranked by measured cost, each naming the page and the fix. */
function findingsSection(evaluation: Evaluation): string[] {
  const out: string[] = ["## 2 · What's blocking the rest", ""];
  if (!evaluation.findings.length) {
    out.push("_No blocking findings._");
    out.push("");
    return out;
  }

  const rows = evaluation.findings.slice(0, 20).map((f) => [
    f.id,
    f.kind,
    f.finding,
    f.pages.map(shortPath).slice(0, 2).join(", ") || "—",
    f.smallestFix,
    f.unblocks.length ? f.unblocks.join(", ") : "—",
  ]);
  out.push(table(["id", "kind", "finding", "pages", "smallest fix", "unblocks"], rows));
  out.push("");
  out.push(
    "_Ordered by measured impact — how much each page dragged the questions it was actually used for, not by how bad it looks. Ids are content-addressed, so the same problem keeps the same id across re-runs and progress stays visible._",
  );
  out.push("");
  out.push(
    "_Where the content comes from, cheapest honest source first: **scrape** (it is already written) → **extract** (it is in a tool) → **interview** (it is in someone's head) → **decide** (it needs an owner's call). A `resolve` finding is always a decision; the tool names it and does not make it._",
  );
  out.push("");
  return out;
}

/** Section 3: the score, the arms, and the cost-and-speed case. */
function standingSection(evaluation: Evaluation, summaries: ArmSummary[]): string[] {
  const out: string[] = ["## 3 · Where you stand", ""];

  const rows = evaluation.arms.map((arm) => {
    const usage = summaries.find((s) => s.armId === arm.armId);
    const automatable = evaluation.automation.get(arm.armId)?.ratio ?? "—";
    return [
      arm.armId,
      arm.composite.toFixed(2),
      ...DIMENSIONS.map((d) => (arm.dimensions[d] == null ? "n/a" : arm.dimensions[d]!.toFixed(1))),
      `${arm.readiness} ${arm.tier}`,
      automatable,
      usage ? money(usage.costPerAnswer) : "—",
      usage ? secs(usage.medianMs) : "—",
    ];
  });

  out.push(
    table(
      ["arm", "composite", ...DIMENSIONS, "readiness", "automatable", "cost/answer", "median time"],
      rows,
      ["l", "r", ...DIMENSIONS.map(() => "r" as const), "l", "r", "r", "r"],
    ),
  );
  out.push("");
  out.push("Failures, reported beside the mean rather than inside it:");
  out.push("");
  out.push(
    table(
      ["arm", "invented claims", "contradictions", "refusals", "worst question"],
      evaluation.arms.map((arm) => [
        arm.armId,
        String(arm.inventedTotal),
        String(arm.contradictionTotal),
        `${Math.round(arm.refusalRate * 100)}%`,
        arm.worst ? `${arm.worst.questionId} at ${arm.worst.composite.toFixed(1)}/4` : "—",
      ]),
      ["l", "r", "r", "r", "l"],
    ),
  );
  out.push("");
  const caps = evaluation.arms.flatMap((a) => a.caps.map((c) => `\`${a.armId}\` — ${c}`));
  if (caps.length) {
    out.push(`_Score caps applied: ${caps.join("; ")}. A capped composite is not the sum of its dimensions._`);
    out.push("");
  }
  out.push(
    "_As context improves the agent stops flailing — fewer searches, fewer reads, fewer turns — so the same answer gets cheaper and faster and more accurate at once. That compounding is the return, and every number above comes straight out of the run._",
  );
  out.push("");
  return out;
}

function firstToolError(cell: Cell): string {
  return cell.sources.find((s) => s.isError)?.path ?? "(see transcript)";
}

export function renderScorecard(
  role: Role,
  result: RunResult,
  meta: { model: string; reps: number; startedAt: Date },
  evaluation?: Evaluation,
): string {
  const armIds = [...new Set(result.cells.map((c) => c.armId))];
  const summaries = armIds.map((id) => summarize(result.cells, id));
  const control = summaries.find((s) => s.armId === "none") ?? summaries[0];
  const best = [...summaries].sort((a, b) => b.answered - a.answered)[0];

  const out: string[] = [];
  out.push(`# Context evaluation — ${role.title}`);
  out.push("");
  out.push(
    `${meta.startedAt.toISOString().slice(0, 16).replace("T", " ")} · ${role.questions.length} questions · ${armIds.length} source configurations · n=${meta.reps} · answering model \`${meta.model}\``,
  );
  out.push("");

  // --- tl;dr
  if (best && control && best.armId !== control.armId) {
    out.push(
      `**tl;dr** — with **${best.armId}** connected, ${best.answered}/${best.total} questions were answered from sources the agent actually opened, against ${control.answered}/${control.total} with no sources at all. Cost per answered question: ${money(best.costPerAnswer)} vs ${money(control.costPerAnswer)}.`,
    );
  } else {
    out.push(`**tl;dr** — ${best?.answered ?? 0}/${best?.total ?? 0} questions answered from opened sources.`);
  }
  out.push("");

  if (evaluation) {
    out.push(...automationSection(role, evaluation, armIds));
    out.push(...findingsSection(evaluation));
    out.push(...standingSection(evaluation, summaries));
  }

  // --- arm comparison
  out.push(evaluation ? "## Retrieval detail" : "## Source configurations");
  out.push("");
  out.push(
    table(
      ["arm", "answered from sources", "sources/answer", "uncited claims", "cost/answer", "median time", "failed", "leaks"],
      summaries.map((s) => [
        s.armId,
        `${s.answered}/${s.total}`,
        s.groundedMedian.toFixed(1),
        String(s.uncited),
        money(s.costPerAnswer),
        secs(s.medianMs),
        String(s.failures),
        String(s.violations),
      ]),
      ["l", "r", "r", "r", "r", "r", "r", "r"],
    ),
  );
  out.push("");
  out.push(
    "_`uncited claims` counts sources the answer referenced but never opened — an invention wearing a citation, detected mechanically. `leaks` counts isolation violations; anything above zero means that arm saw more than it was configured with, and its numbers are not trustworthy._",
  );
  out.push("");

  // --- per question
  out.push("## By question");
  out.push("");
  const qRows = role.questions.map((q) => {
    const row: string[] = [q.id, String(q.weight), q.expectedGap ? "yes" : ""];
    for (const id of armIds) {
      const cells = result.cells.filter((c) => c.questionId === q.id && c.armId === id);
      const n = median(cells.filter((c) => c.status === "ok").map((c) => grounded(c).length));
      const failed = cells.length > 0 && cells.every((c) => c.status !== "ok");
      row.push(failed ? "FAIL" : n.toFixed(0));
    }
    return row;
  });
  out.push(
    table(
      ["question", "weight", "expected gap", ...armIds],
      qRows,
      ["l", "r", "l", ...armIds.map(() => "r" as const)],
    ),
  );
  out.push("");
  out.push("_Cells show how many distinct sources the agent opened and used. Phase 3 adds judged coverage, grounding and consistency scores._");
  out.push("");

  // --- registry
  out.push("## Sources touched");
  out.push("");
  out.push(registryTable(result.cells));
  out.push("");
  const stats = result.hydrateStats;
  if (stats) {
    const aliases = Object.entries(stats.reviewKeyAliases);
    out.push(
      `_${stats.hydrated} source(s) hydrated, ${stats.unavailable} unreadable._` +
        (aliases.length
          ? ` Review dates arrived under ${aliases.length} different key name(s): ${aliases.map(([k, n]) => `\`${k}\` ×${n}`).join(", ")} — the sprawl recorded as open finding L-0015.`
          : "") +
        (stats.statusCoercions ? ` ${stats.statusCoercions} \`status\` value(s) were booleans rather than strings (L-0016).` : ""),
    );
    out.push("");
  }
  out.push(
    "_`last human edit` and `by` come from page revision history. A folder of files cannot answer either column — that absence is the finding, not a missing value._",
  );
  out.push("");

  // --- canary
  const canary = result.cells.filter((c) => c.questionId === CANARY_QUESTION_ID);
  if (canary.length) {
    out.push("## Isolation check");
    out.push("");
    out.push(
      table(
        ["arm", "answered the canary"],
        canary.map((c) => [
          c.armId,
          c.armId === "coconut" && c.sources.some((s) => s.isError)
            ? "could not read the page (key lacks access to that space)"
            : /unknown|cannot|could not|no access/i.test(c.answer)
              ? c.armId === "coconut" ? "no — expected yes" : "no (correct)"
              : c.armId === "coconut" ? "yes (correct)" : c.answer.slice(0, 40),
        ]),
      ),
    );
    out.push("");
    out.push("_Only the Coconut arm can reach the canary page. Any other arm answering it means isolation is broken and the run is void._");
    out.push("");
  }

  // --- reproduce
  out.push("## Reproduce");
  out.push("");
  out.push("What each arm could actually see, verbatim:");
  out.push("");
  for (const [armId, argv] of Object.entries(result.argvByArm)) {
    out.push(`**${armId}**`);
    out.push("```");
    out.push("claude " + argv.map((a) => (a === "" ? '""' : /[\s"]/.test(a) ? `'${a.replace(/\n/g, " ").slice(0, 120)}…'` : a)).join(" "));
    out.push("```");
    out.push("");
  }

  const infra = result.cells.filter((c) => c.status === "mcp_unavailable" || c.status === "auth_error");
  if (infra.length) {
    const byArm = [...new Set(infra.map((c) => c.armId))];
    out.push(
      `> **Source unreachable.** ${infra.length} cell(s) on ${byArm.map((a) => `\`${a}\``).join(", ")} could not reach their source at all (every tool call errored). They are excluded from scores rather than counted as refusals — a broken connection is not a verdict on the corpus. First error: ${JSON.stringify(firstToolError(infra[0]!)).slice(0, 160)}`,
    );
    out.push("");
  }

  if (result.abortedForBudget) {
    out.push("> **Budget reached.** This report is partial — some cells were not run.");
    out.push("");
  }

  const quoted = NEVER_QUOTE.join(", ");
  out.push(`_Private spaces (${quoted}) are never quoted. Full transcripts stay in \`runs/\` and are not committed._`);

  return out.join("\n");
}
