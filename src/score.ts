// The five dimensions, the capped composite, and the readiness projection.
//
// Coverage, grounding and consistency come from the judge (with mechanical
// checks able to overrule it). Freshness and efficiency are computed from the
// source registry and need no model at all.

import { ANCHORS, DIMENSION_WEIGHTS, DIMENSIONS, TIERS, type DimensionName } from "./config.js";
import type { Judgement } from "./judge.js";
import type { Cell, DimensionScores, Question, SourceRecord } from "./types.js";

/** Maps a 0–1 sub-score onto the 0–4 verbal scale, hitting the anchors exactly. */
export function anchorMap(x: number, [b4, b3, b2, b1]: readonly [number, number, number, number]): number {
  const v = Math.max(0, Math.min(1, x));
  if (v >= b4) return 4;
  if (v >= b3) return 3 + (v - b3) / (b4 - b3);
  if (v >= b2) return 2 + (v - b2) / (b3 - b2);
  if (v >= b1) return 1 + (v - b1) / (b2 - b1);
  return v / b1;
}

const FACET_VALUE = { covered: 1, partial: 0.5, missing: 0, contradicted: -0.5 } as const;

/**
 * Coverage: how many declared facets the answer actually supplied.
 *
 * A facet answered *wrongly* scores below one left out, which is what stops
 * bluffing from beating an honest gap.
 */
export function scoreCoverage(judgement: Judgement, question: Question): number {
  const n = question.mustCover.length;
  if (!n) return 0;
  const total = judgement.facets.reduce((sum, f) => sum + (FACET_VALUE[f.verdict] ?? 0), 0);
  return anchorMap(Math.max(0, total) / n, ANCHORS.coverage);
}

/**
 * Grounding: is every claim traceable to a source that actually says it.
 *
 * Scored as a *rate* with hard floors. The earlier absolute count came from the
 * readiness one-pager, which has six slots; applied to an answer with twenty
 * atomic claims it scored three misses out of twenty-three the same as three
 * out of three, and held every real Coconut answer at 1/4. The floors keep the
 * part of counting that was right: one contradicted claim, one invented
 * number, or one implausible invention is disqualifying whatever the rate.
 */
export function scoreGrounding(judgement: Judgement, sources: SourceRecord[]): number {
  const claims = judgement.claims.filter((c) => c.verdict !== "not_a_factual_claim");
  const unsupported = claims.filter(
    (c) => c.verdict === "unsupported_but_plausible" || c.verdict === "unsupported_implausible",
  ).length;
  const implausible = claims.filter((c) => c.verdict === "unsupported_implausible").length;
  const contradicted = claims.filter((c) => c.verdict === "contradicted").length;
  const tokenMisses = judgement.hardTokenMisses.length;
  // A source named in the answer but never opened is an invention wearing a
  // citation; it counts against grounding like any other unsupported claim.
  const claimedOnly = sources.filter((s) => s.claimedOnly).length;

  // An honest refusal is a correct outcome, not a grounding failure.
  if (!claims.length) return judgement.refused ? 3 : 0;

  const bad = unsupported + claimedOnly;
  const verified = claims.length - unsupported - contradicted;
  const rate = Math.max(0, verified) / (claims.length + claimedOnly);

  let score: number;
  if (rate >= 0.95) score = 4;
  else if (rate >= 0.85) score = 3;
  else if (rate >= 0.7) score = 2;
  else score = 1;

  // Hard floors: some failures are not a matter of degree.
  if (contradicted >= 1 || tokenMisses >= 1 || implausible >= 1) score = Math.min(score, 2);
  if (contradicted >= 2 || bad >= 5) score = Math.min(score, 1);
  return score;
}

/**
 * Freshness, weighted by what each source actually contributed — so an arm is
 * not punished for stale pages it correctly ignored.
 */
export function scoreFreshness(sources: SourceRecord[]): number | null {
  const used = sources.filter((s) => s.freshness != null && s.access === "read");
  if (!used.length) return null; // nothing hydratable: report n/a, never zero
  const contributing = used.filter((s) => s.contributed);
  const pool = contributing.length ? contributing : used;
  const mean = pool.reduce((sum, s) => sum + (s.freshness ?? 0), 0) / pool.length;
  return anchorMap(mean, ANCHORS.freshness);
}

/**
 * Consistency: does the context speak with one voice on this question.
 *
 * Capped at 2 whenever a substantive conflict exists, even if the answer flags
 * it. The agent's poise is not what is being scored — the context layer is. A
 * layer with two live prices is a 2 however gracefully it is handled.
 */
export function scoreConsistency(judgement: Judgement): number {
  const substantive = judgement.contradictions.filter((c) => c.kind === "substantive");
  if (!substantive.length) {
    return judgement.contradictions.length ? 3 : 4;
  }
  return judgement.answer_disclosed_conflict ? 2 : 1;
}

/**
 * Efficiency: hops, wasted reads and duplication.
 *
 * Deliberately carries no per-source size term. A long authoritative page read
 * once is the best possible outcome; only duplication is penalised, and only
 * pairwise.
 */
export function scoreEfficiency(sources: SourceRecord[], facetCount: number): number | null {
  const reads = sources.filter((s) => s.access === "read" && !s.isError);
  if (!reads.length) return null; // an arm cannot win by not trying: n/a, not 4

  const contributed = reads.filter((s) => s.contributed).length;
  const precision = contributed / reads.length;

  const repeats = reads.reduce((n, s) => n + Math.max(0, s.reads - 1), 0);
  const noRepeat = 1 - repeats / reads.length;

  const budget = 2 + facetCount;
  const hops = Math.max(0, reads.length - budget);
  const restraint = Math.max(0, 1 - hops / 10);

  return anchorMap(0.5 * precision + 0.3 * noRepeat + 0.2 * restraint, ANCHORS.efficiency);
}

export interface QuestionScore {
  questionId: string;
  armId: string;
  dimensions: Partial<DimensionScores>;
  composite: number;
  caps: string[];
  refused: boolean;
  invented: number;
  contradictions: number;
}

export function scoreCell(cell: Cell, question: Question, judgement: Judgement): QuestionScore {
  const dimensions: Partial<DimensionScores> = {
    coverage: scoreCoverage(judgement, question),
    grounding: scoreGrounding(judgement, cell.sources),
  };
  const freshness = scoreFreshness(cell.sources);
  if (freshness != null) dimensions.freshness = freshness;
  dimensions.consistency = scoreConsistency(judgement);
  const efficiency = scoreEfficiency(cell.sources, question.mustCover.length);
  if (efficiency != null) dimensions.efficiency = efficiency;

  // Renormalize over the dimensions that apply, so an arm with nothing to
  // hydrate is not silently credited or punished for the absence.
  let weighted = 0;
  let totalWeight = 0;
  for (const name of DIMENSIONS) {
    const value = dimensions[name];
    if (value == null) continue;
    weighted += value * DIMENSION_WEIGHTS[name];
    totalWeight += DIMENSION_WEIGHTS[name];
  }
  let composite = totalWeight ? weighted / totalWeight : 0;

  // Caps, not a plain mean: an arm that invents should not be rescued by being
  // fast and tidy. That is the failure mode where a benchmark tells you to
  // ship something dangerous.
  const caps: string[] = [];
  if ((dimensions.grounding ?? 4) < 2) {
    caps.push("invention (grounding below 2)");
    composite = Math.min(composite, 2);
  }
  if ((dimensions.coverage ?? 4) < 1) {
    caps.push("empty (coverage below 1)");
    composite = Math.min(composite, 1.5);
  }

  const invented = judgement.claims.filter(
    (c) => c.verdict === "unsupported_but_plausible" || c.verdict === "unsupported_implausible",
  ).length;

  return {
    questionId: cell.questionId,
    armId: cell.armId,
    dimensions,
    composite,
    caps,
    refused: judgement.refused,
    invented: invented + cell.sources.filter((s) => s.claimedOnly).length,
    contradictions: judgement.contradictions.filter((c) => c.kind === "substantive").length,
  };
}

// ------------------------------------------------------------- aggregation

export interface ArmScore {
  armId: string;
  dimensions: Partial<DimensionScores>;
  composite: number;
  worst: { questionId: string; composite: number } | null;
  readiness: number;
  tier: string;
  /** Negative signals: reported beside the mean, never inside it. */
  inventedTotal: number;
  contradictionTotal: number;
  refusalRate: number;
  caps: string[];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function aggregate(scores: QuestionScore[], questions: Question[], armId: string): ArmScore {
  const mine = scores.filter((s) => s.armId === armId);
  const weightOf = (id: string) => questions.find((q) => q.id === id)?.weight ?? 1;

  const dimensions: Partial<DimensionScores> = {};
  for (const name of DIMENSIONS) {
    const present = mine.filter((s) => s.dimensions[name] != null);
    if (!present.length) continue;
    const totalWeight = present.reduce((n, s) => n + weightOf(s.questionId), 0);
    dimensions[name] =
      present.reduce((n, s) => n + (s.dimensions[name] ?? 0) * weightOf(s.questionId), 0) / totalWeight;
  }

  const totalWeight = mine.reduce((n, s) => n + weightOf(s.questionId), 0) || 1;
  const composite = mine.reduce((n, s) => n + s.composite * weightOf(s.questionId), 0) / totalWeight;

  const worst = mine.length
    ? mine.reduce((lo, s) => (s.composite < lo.composite ? s : lo))
    : null;

  const readiness = Math.round(composite * 25);
  const tier = TIERS.find(([floor]) => readiness >= floor)?.[1] ?? "Cold Start";

  return {
    armId,
    dimensions,
    composite,
    worst: worst ? { questionId: worst.questionId, composite: worst.composite } : null,
    readiness,
    tier,
    inventedTotal: mine.reduce((n, s) => n + s.invented, 0),
    contradictionTotal: mine.reduce((n, s) => n + s.contradictions, 0),
    refusalRate: mine.length ? mine.filter((s) => s.refused).length / mine.length : 0,
    caps: [...new Set(mine.flatMap((s) => s.caps.map((c) => `${s.questionId}: ${c}`)))],
  };
}

export { mean };
