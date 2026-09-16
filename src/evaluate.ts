// Turns raw cells into scores, an automation verdict per question, and the
// findings that explain the gap. Kept separate from the runner so it can be
// re-run over stored transcripts without spending agent tokens again.

import { CANARY_QUESTION_ID } from "./assert.js";
import { callAutomation, summarizeAutomation, type AutomationCall, type AutomationSummary } from "./automate.js";
import { judge, type Judgement } from "./judge.js";
import { aggregate, scoreCell, type ArmScore, type QuestionScore } from "./score.js";
import type { Cell, Role, SourceRecord } from "./types.js";

export interface ArmCall extends AutomationCall {
  armId: string;
}

export interface Finding {
  /** Content-addressed, so the same problem keeps the same id across re-runs —
   *  which is what makes progress visible. Sequential ids renumber. */
  id: string;
  kind: "resolve" | "refresh" | "attest" | "create" | "own";
  finding: string;
  pages: string[];
  smallestFix: string;
  /** What fixing this unblocks — the reason to do it today. */
  unblocks: string[];
  impact: number;
}

export interface Evaluation {
  scores: QuestionScore[];
  arms: ArmScore[];
  judgements: Map<string, Judgement>;
  automation: Map<string, AutomationSummary>;
  calls: ArmCall[];
  findings: Finding[];
  judgeCostUsd: number;
}

const key = (armId: string, questionId: string): string => `${armId}::${questionId}`;

/** FNV-1a, so a finding's id depends only on what the finding is about. */
function contentId(prefix: string, parts: string[]): string {
  let h = 2166136261;
  for (const ch of parts.sort().join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${prefix}-${(h >>> 0).toString(16).slice(0, 4)}`;
}

export interface EvaluateOptions {
  role: Role;
  cells: Cell[];
  judgeModel: string;
  /** Judging is the slow half of a run; these calls are independent. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Bounded-concurrency map that preserves input order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

export async function evaluate(opts: EvaluateOptions): Promise<Evaluation> {
  const scored = opts.cells.filter(
    (c) => c.questionId !== CANARY_QUESTION_ID && c.status === "ok",
  );
  const judgements = new Map<string, Judgement>();
  const scores: QuestionScore[] = [];
  const calls: ArmCall[] = [];
  let judgeCostUsd = 0;
  let done = 0;

  const judged = await pool(scored, opts.concurrency ?? 4, async (cell) => {
    const question = opts.role.questions.find((q) => q.id === cell.questionId);
    if (!question) return null;

    const judgement = await judge({
      question,
      answer: cell.answer,
      sources: cell.sources,
      model: opts.judgeModel,
      // Same seed per question, so source order is shuffled identically for
      // every arm — the judge cannot infer the arm from the ordering.
      seed: question.id,
    });
    done += 1;
    opts.onProgress?.(done, scored.length);
    return { cell, question, judgement };
  });

  for (const entry of judged) {
    if (!entry) continue;
    const { cell, question, judgement } = entry;
    judgeCostUsd += judgement.costUsd;
    judgements.set(key(cell.armId, cell.questionId), judgement);

    // Grounding needs to know which sources carried a claim; the judge's
    // verified quotes are what tell us.
    markContributors(cell.sources, judgement);

    const score = scoreCell(cell, question, judgement);
    scores.push(score);
    calls.push({ ...callAutomation(score, question, cell.sources), armId: cell.armId });
  }

  const armIds = [...new Set(scored.map((c) => c.armId))];
  const arms = armIds.map((id) => aggregate(scores, opts.role.questions, id));

  const automation = new Map<string, AutomationSummary>();
  for (const armId of armIds) {
    automation.set(armId, summarizeAutomation(calls.filter((c) => c.armId === armId)));
  }

  return {
    scores,
    arms,
    judgements,
    automation,
    calls,
    findings: deriveFindings(opts.role, scores, calls, scored),
    judgeCostUsd,
  };
}

/**
 * A source contributed when a verified quote came from it — and only then.
 *
 * Marking every opened source as contributing would make retrieval precision
 * a constant 1.0, so efficiency would measure nothing and freshness would
 * weight stale pages the agent correctly ignored exactly like the ones it
 * used. Attribution is what gives both dimensions something to measure.
 */
function markContributors(sources: SourceRecord[], judgement: Judgement): void {
  for (const source of sources) {
    source.contributed = (judgement.supportByUri[source.uri] ?? 0) > 0;
  }
}

/**
 * Findings, ranked by what they actually cost rather than by how bad they look.
 *
 * Emitted in the same shape the context-hygiene loop already publishes, so a
 * human triages one table format rather than three.
 */
function deriveFindings(
  role: Role,
  scores: QuestionScore[],
  calls: ArmCall[],
  cells: Cell[],
): Finding[] {
  const byPage = new Map<string, { row: SourceRecord; questions: Set<string>; impact: number }>();

  for (const score of scores) {
    const cell = cells.find((c) => c.armId === score.armId && c.questionId === score.questionId);
    if (!cell) continue;
    const weight = role.questions.find((q) => q.id === score.questionId)?.weight ?? 1;

    for (const source of cell.sources) {
      if (!source.contributed || source.hydration !== "hydrated") continue;
      const entry = byPage.get(source.path) ?? { row: source, questions: new Set<string>(), impact: 0 };
      entry.questions.add(score.questionId);
      // Impact is how much this page dragged the questions it touched: a stale
      // pricing page under three heavy questions outranks an orphan nobody read.
      entry.impact += weight * (4 - score.composite);
      byPage.set(source.path, entry);
    }
  }

  const findings: Finding[] = [];
  const blockedBy = (page: string): string[] =>
    calls
      .filter((c) => c.verdict !== "automate" && c.sources.some((s) => s.path === page))
      .map((c) => c.questionId);

  for (const [page, entry] of byPage) {
    const { row } = entry;
    const unblocks = blockedBy(page);

    if (row.agentWrittenOnly) {
      findings.push({
        id: contentId("E", ["attest", page]),
        kind: "attest",
        finding: "No human has ever reviewed this page",
        pages: [page],
        smallestFix: `Have ${row.owner ?? "an owner"} read it and set a review date`,
        unblocks,
        impact: entry.impact,
      });
    } else if (row.humanStale) {
      findings.push({
        id: contentId("E", ["attest", page]),
        kind: "attest",
        finding: "Updated by an agent; no human review inside its freshness window",
        pages: [page],
        smallestFix: "Review and set a review date",
        unblocks,
        impact: entry.impact,
      });
    }

    if (!row.owner) {
      findings.push({
        id: contentId("E", ["own", page]),
        kind: "own",
        finding: "Load-bearing page with no named owner",
        pages: [page],
        smallestFix: "Set an `owner` — one metadata edit",
        unblocks,
        impact: entry.impact,
      });
    }

    if ((row.freshness ?? 1) < 0.45) {
      findings.push({
        id: contentId("E", ["refresh", page]),
        kind: "refresh",
        finding: `Past its freshness window (${Math.round(row.ageDays ?? 0)} days, ${row.decayClass})`,
        pages: [page],
        smallestFix: "Refresh the content, or confirm it is still current",
        unblocks,
        impact: entry.impact,
      });
    }
  }

  // Contradictions outrank everything: they need a decision, not a document.
  for (const score of scores.filter((s) => s.contradictions > 0)) {
    const cell = cells.find((c) => c.armId === score.armId && c.questionId === score.questionId);
    const pages = (cell?.sources ?? []).filter((s) => s.contributed).map((s) => s.path);
    findings.push({
      // Keyed on the question, not the pages: retrieval varies run to run, so
      // the same underlying disagreement surfaces through different page pairs
      // and a page-keyed id would renumber every time — destroying the trend
      // the stable id exists to preserve. Page-specific findings below can
      // safely key on the page, because that does not move.
      id: contentId("E", ["resolve", score.questionId]),
      kind: "resolve",
      finding: `Sources disagree on "${score.questionId}"`,
      pages,
      smallestFix: "Decide which is current and mark the other superseded",
      unblocks: [score.questionId],
      impact: 100 + score.contradictions,
    });
  }

  // Anything nobody could answer at all is a missing page, not a stale one.
  for (const call of calls.filter((c) => c.verdict === "not_yet")) {
    const anyCovered = scores.some(
      (s) => s.questionId === call.questionId && (s.dimensions.coverage ?? 0) >= 2,
    );
    if (anyCovered) continue;
    findings.push({
      id: contentId("E", ["create", call.questionId]),
      kind: "create",
      finding: `No source adequately answers "${call.questionId}"`,
      pages: [],
      smallestFix: "Write the page — interview whoever knows, or decide it",
      unblocks: [call.questionId],
      impact: 50,
    });
  }

  const deduped = new Map(findings.map((f) => [f.id, f]));
  return [...deduped.values()].sort((a, b) => b.impact - a.impact);
}

/** Exposed for tests: finding identity has to survive retrieval variation. */
export const deriveFindingsForTest = deriveFindings;
