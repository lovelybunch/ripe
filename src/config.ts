// Every tunable constant in the framework, in one place. The report prints a
// hash of this file, so a score is always traceable to the numbers that made it.
//
// Rule: do not change a constant mid-round. Changing one re-baselines the
// trend line, so it forces a new `--round` id.

/** Model presets. Cost and speed are outcomes we report, so they are choices. */
export const PRESETS = {
  fast: { answer: "claude-haiku-4-5-20251001", judge: "claude-sonnet-5", reps: 1 },
  default: { answer: "claude-sonnet-5", judge: "claude-opus-5", reps: 1 },
  thorough: { answer: "claude-sonnet-5", judge: "claude-opus-5", reps: 3 },
} as const;

export type PresetName = keyof typeof PRESETS;

/** Per-cell guardrails. A timeout is a result, not a flake — we never retry it. */
export const LIMITS = {
  maxTurns: 20,
  maxBudgetUsd: 1.0,
  timeoutMs: 300_000,
  /** Identical across every arm, so verbosity cannot vary by arm. */
  answerWordCap: 350,
  retries: 2,
  concurrency: 3,
} as const;

/**
 * Freshness half-lives, in days, by content class.
 *
 * Three numbers rather than one because a single global half-life is the
 * commonest failure of naive freshness scoring: `durable` at 540d encodes that
 * a decision record captures *what was decided*, not what is true now — it
 * does not decay, it gets superseded.
 */
export const DECAY_CLASSES = {
  volatile: { halfLife: 45, grace: 14 },
  standard: { halfLife: 120, grace: 30 },
  durable: { halfLife: 540, grace: 90 },
} as const;

export type DecayClass = keyof typeof DECAY_CLASSES;

/** First match wins. Checked against the page path, lowercased. */
export const DECAY_PATTERNS: ReadonlyArray<readonly [RegExp, DecayClass]> = [
  [/\/decisions?(\/|$)|\/adr|\/principles|\/brand|\/voice/, "durable"],
  [/pricing|\/people(\/|$)|competitor|subprocessor|\/billing\/|\/prospects\//, "volatile"],
];

/** Multiplicative freshness penalties. They compose to a floor, never negative. */
export const FRESHNESS_PENALTIES = {
  draft: 0.25,
  noOwner: 0.15,
  /** An agent refreshed it; no person has reviewed it inside its window. */
  humanStale: 0.2,
  brokenLinksMax: 0.3,
} as const;

/** Below this, a page is empty rather than merely thin, and scores 0. */
export const MIN_CONTENT_TOKENS = 40;

/** Dimension weights. Efficiency is deliberately lowest: never prefer a
 *  cheaper, wronger arm. */
export const DIMENSION_WEIGHTS = {
  coverage: 0.3,
  grounding: 0.3,
  freshness: 0.15,
  consistency: 0.15,
  efficiency: 0.1,
} as const;

export type DimensionName = keyof typeof DIMENSION_WEIGHTS;

export const DIMENSIONS = Object.keys(DIMENSION_WEIGHTS) as DimensionName[];

/**
 * Anchor breakpoints for mapping a 0–1 sub-score onto the 0–4 verbal scale
 * shared with the `context-readiness` skill:
 *   0 nothing · 1 fragments · 2 conflicting or stale · 3 accurate and current
 *   · 4 one current version, owned and kept current
 */
export const ANCHORS: Record<"coverage" | "freshness" | "efficiency", readonly [number, number, number, number]> = {
  coverage: [0.95, 0.8, 0.55, 0.25],
  freshness: [0.85, 0.7, 0.45, 0.2],
  efficiency: [0.85, 0.7, 0.5, 0.25],
};

/** Near-duplicate thresholds over `max(jaccard, containment)`. */
export const DUP = {
  shingleSize: 5,
  duplicate: 0.8,
  substantial: 0.55,
  /** Below this many shingles, containment is too noisy to trust. */
  minShinglesForContainment: 100,
  /** A line appearing in this share of one connector's docs is chrome, not content. */
  boilerplateShare: 0.3,
} as const;

/** Readiness tiers, shared verbatim with the context-readiness skill. */
export const TIERS: ReadonlyArray<readonly [number, string]> = [
  [80, "Ready"],
  [60, "Working Draft"],
  [40, "Foundations"],
  [0, "Cold Start"],
];

/** Corpus paths excluded from an audit by default: agent bookkeeping, not context. */
export const AUDIT_EXCLUDE = [/\/agents\//, /\/runs\//] as const;

/** Spaces never quoted in a report, however the run was configured. */
export const NEVER_QUOTE = ["investors"] as const;
