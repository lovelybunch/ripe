// The headline output: which jobs can be handed to an agent today, which need
// a human in the loop, and which are blocked — and for the first group, the
// agent task, ready to run.
//
// The bar is strict on purpose. Trust is earned by never being wrong, and the
// automatable set widens on its own as the fix list gets worked. A gate that
// lets through one confidently wrong questionnaire answer has cost more than
// it ever saved.

import type { QuestionScore } from "./score.js";
import type { Question, SourceRecord } from "./types.js";

export type Verdict = "automate" | "with_review" | "not_yet";

export interface AutomationCall {
  questionId: string;
  verdict: Verdict;
  /** Why, in the order a reader should hear it. */
  reasons: string[];
  /** Sources that supported a claim — pinned into the generated task. */
  sources: SourceRecord[];
}

const THRESHOLD = 3;

/**
 * A source is trustworthy enough to automate on when a person is accountable
 * for it and a person has looked at it recently.
 *
 * `agentWrittenOnly` is the interesting case: content an agent wrote and no
 * human has ever reviewed can be perfectly accurate and still be the wrong
 * thing to paste into a contract. Neither a folder of files nor a website can
 * tell you this, which is exactly why it belongs in the gate.
 */
function sourceBlockers(sources: SourceRecord[]): string[] {
  const reasons: string[] = [];
  const contributing = sources.filter((s) => s.contributed);

  // A source we could not hydrate has *unknown* provenance, which is not the
  // same as good provenance. A flat folder cannot say who owns a page or when
  // a person last checked it, so nothing answered from one can clear the bar —
  // that is the concrete form of the folder's limitation, not a gap in ours.
  const unknown = contributing.filter((s) => s.hydration !== "hydrated");
  if (unknown.length) {
    reasons.push(
      `provenance unknown for ${names(unknown)} — this source cannot say who owns it or when a person last reviewed it`,
    );
  }

  const hydrated = contributing.filter((s) => s.hydration === "hydrated");
  const unowned = hydrated.filter((s) => !s.owner);
  if (unowned.length) {
    reasons.push(`${unowned.length} source(s) have no named owner: ${names(unowned)}`);
  }

  const agentOnly = hydrated.filter((s) => s.agentWrittenOnly);
  if (agentOnly.length) {
    reasons.push(`no human has ever reviewed ${names(agentOnly)}`);
  }

  const stale = hydrated.filter((s) => !s.agentWrittenOnly && s.humanStale);
  if (stale.length) {
    reasons.push(`no human review inside the freshness window for ${names(stale)}`);
  }

  return reasons;
}

const names = (sources: SourceRecord[]): string =>
  sources
    .slice(0, 3)
    .map((s) => s.path.replace(/\.md$/, ""))
    .join(", ") + (sources.length > 3 ? `, +${sources.length - 3} more` : "");

export function callAutomation(
  score: QuestionScore,
  question: Question,
  sources: SourceRecord[],
): AutomationCall {
  const blockers: string[] = [];

  const coverage = score.dimensions.coverage ?? 0;
  const grounding = score.dimensions.grounding ?? 0;
  const consistency = score.dimensions.consistency ?? 0;
  const freshness = score.dimensions.freshness;

  if (score.invented > 0) {
    blockers.push(`${score.invented} claim(s) not traceable to a source that was opened`);
  }
  if (score.contradictions > 0) {
    blockers.push(`${score.contradictions} unresolved contradiction(s) between sources`);
  }
  if (coverage < THRESHOLD) {
    blockers.push(`only ${coverage.toFixed(1)}/4 of the required facets were answered`);
  }
  if (grounding < THRESHOLD) blockers.push(`grounding ${grounding.toFixed(1)}/4`);
  if (consistency < THRESHOLD) blockers.push(`consistency ${consistency.toFixed(1)}/4`);
  if (freshness != null && freshness < THRESHOLD) {
    blockers.push(`sources are past their freshness window (${freshness.toFixed(1)}/4)`);
  }

  // A refusal is a correct outcome for some questions and disqualifying for
  // others — the role file says which.
  if (score.refused && !question.refusalOk) {
    blockers.push("the question was not answered");
  }

  const provenance = sourceBlockers(sources);

  // One soft failure means a person should look, not that it cannot be done.
  if (blockers.length === 0 && provenance.length > 0) {
    return { questionId: question.id, verdict: "with_review", reasons: provenance, sources: sources.filter((s) => s.contributed) };
  }
  if (blockers.length === 1 && provenance.length === 0) {
    return { questionId: question.id, verdict: "with_review", reasons: blockers, sources: sources.filter((s) => s.contributed) };
  }
  if (blockers.length === 0) {
    // Only reachable with hydrated, owned, human-reviewed sources — the claim
    // in this string has actually been checked.
    return {
      questionId: question.id,
      verdict: "automate",
      reasons: ["every required facet answered from an owned, human-reviewed source"],
      sources: sources.filter((s) => s.contributed),
    };
  }

  return {
    questionId: question.id,
    verdict: "not_yet",
    reasons: [...blockers, ...provenance],
    sources: sources.filter((s) => s.contributed),
  };
}

/**
 * A Coconut agent task for a question that cleared the bar, with its verified
 * sources pinned so the task does not re-search from scratch — and with an
 * explicit instruction to stop rather than substitute, because the whole point
 * of the gate is that these sources are the ones we checked.
 */
export function renderAgentTask(role: string, question: Question, call: AutomationCall): string {
  const sources = call.sources
    .filter((s) => s.connector === "coconut")
    .map((s) => {
      const meta = [
        s.version != null ? `v${s.version}` : null,
        s.lastHumanEdit ? `human-edited ${s.lastHumanEdit.slice(0, 10)}` : null,
        s.owner ? `owner: ${s.owner}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `  - ${s.path}${meta ? `   # ${meta}` : ""}`;
    });

  return `path: ${role}/agents/answer-${question.id}
title: Answer — ${question.id}
instructions: |
  Answer the question below from the sources listed, and only those sources.
  Cite the source for every factual claim.
  If a source is missing, empty, or has changed materially since this task was
  written, stop and say so rather than substituting your own knowledge.

  Question: ${question.ask.replace(/\s+/g, " ").trim()}
sources:
${sources.length ? sources.join("\n") : "  # none pinned — this task needs sources before it can run"}`;
}

export interface AutomationSummary {
  automate: AutomationCall[];
  withReview: AutomationCall[];
  notYet: AutomationCall[];
  /** The number that matters: it going up is the product outcome. */
  ratio: string;
}

export function summarizeAutomation(calls: AutomationCall[]): AutomationSummary {
  const automate = calls.filter((c) => c.verdict === "automate");
  return {
    automate,
    withReview: calls.filter((c) => c.verdict === "with_review"),
    notYet: calls.filter((c) => c.verdict === "not_yet"),
    ratio: `${automate.length}/${calls.length}`,
  };
}
