import type { DecayClass, DimensionName } from "./config.js";

// ---------------------------------------------------------------- roles

export interface Question {
  /** Stable forever. Renaming one breaks the trend line. */
  id: string;
  ask: string;
  /** Plain-English facets the answer must supply. The list is closed: correct
   *  information outside it earns nothing, which is the anti-verbosity lock. */
  mustCover: string[];
  weight: number;
  /** True when we believe the corpus answers this badly today. A role file
   *  where nothing is an expected gap is a role file that flatters. */
  expectedGap: boolean;
  /** "We don't publish that" is a correct answer here. */
  refusalOk: boolean;
}

export interface Role {
  id: string;
  title: string;
  /** Who actually does this job. Shapes the agent's preamble. */
  persona?: string;
  /** Injected verbatim as the agent's role preamble. Must contain no answers
   *  and no source hints. */
  brief: string;
  questions: Question[];
  sourcePath: string;
}

// ---------------------------------------------------------------- arms

export interface Arm {
  id: string;
  label: string;
  /** Why this arm exists — printed in the report so no arm is unexplained. */
  rationale: string;
  /** Built-in tools, passed verbatim to `--tools`. Empty means none at all. */
  tools: string[];
  /** Patterns for `--allowedTools`. */
  allowedTools: string[];
  /** Merged into the generated `.mcp.json`. */
  mcpServers: Record<string, unknown>;
  /** Absolute dirs for `--add-dir`. */
  addDirs: string[];
  /** Env vars this arm needs; nothing else is passed through. */
  requiresEnv: string[];
  /** The delta denominator. Exactly one arm may be the control. */
  control?: boolean;
}

// ---------------------------------------------------------------- sources

export type Connector = "coconut" | "files" | "web" | "unknown";

/** One distinct thing the agent actually opened, normalized across connectors. */
export interface SourceRecord {
  /** Dedup key. `coco://sales/customers/acme` · `file:///…` · `https://…` */
  uri: string;
  /** Human-readable location within the connector. */
  path: string;
  connector: Connector;
  /** The tool that produced it, verbatim. */
  tool: string;
  /** `read` opened content · `search`/`list` merely surfaced it. */
  access: "read" | "search" | "list" | "meta";

  bytes: number | null;
  /** How many times it was opened. Repeat reads are an efficiency signal. */
  reads: number;
  /** Position in the result set that surfaced it, if any. */
  rank: number | null;
  turn: number;
  isError: boolean;

  // --- provenance. Populated for `coconut` only; null elsewhere, and that
  //     absence is itself the finding a flat folder cannot answer.
  format: string | null;
  version: number | null;
  updatedAt: string | null;
  ageDays: number | null;
  decayClass: DecayClass | null;
  owner: string | null;
  status: string | null;
  lastReviewed: string | null;
  /** The date a person last stood behind this page. */
  lastHumanEdit: string | null;
  lastEditor: string | null;
  editorType: "user" | "agent" | null;
  /** What changed, in the editor's own words. */
  changeNote: string | null;
  /** No human has touched this page since v1. Disqualifying for a questionnaire. */
  agentWrittenOnly: boolean;
  /** Recently updated by an agent, but past its window for human review. */
  humanStale: boolean;
  brokenLinks: number | null;
  /** 0–1. Null until hydrated. */
  freshness: number | null;
  hydration: "hydrated" | "unavailable" | "not_applicable";

  /**
   * The content the tool actually returned. Held in memory for judging and
   * quote verification only — it is stripped before anything is written to
   * disk, because it contains full page bodies from private spaces.
   */
  text?: string;

  // --- set once the answer has been analysed
  /** Supported at least one claim in the answer. */
  contributed: boolean;
  /** Cited in the answer but never actually opened — an invention wearing a
   *  citation, caught without a judge. */
  claimedOnly: boolean;
}

// ---------------------------------------------------------------- runs

export type FailureClass =
  | "ok"
  | "timeout"
  | "budget_exceeded"
  | "api_error"
  | "auth_error"
  | "mcp_unavailable"
  | "tool_denied"
  | "model_mismatch"
  | "hermeticity_violation"
  | "empty_answer"
  | "crash";

/** What the arm was actually given, read back off the transcript rather than
 *  assumed from the config. */
export interface Provenance {
  model: string | null;
  mcpServers: string[];
  tools: string[];
  memoryPaths: string[];
  cwd: string | null;
  hookEvents: number;
  permissionDenials: number;
  /**
   * Output tokens per model that actually ran, from `result.modelUsage`.
   *
   * Keyed rather than a bare list because the CLI legitimately bills a little
   * auxiliary work to a small model; what matters is whether the *pinned*
   * model did the answering. A silent fallback shows up as the pin producing
   * few or no output tokens.
   */
  outputTokensByModel: Record<string, number>;
  /**
   * Models that authored assistant turns, from each `assistant` event's
   * `message.model`. This is the exact signal for a silent fallback: token
   * share is not, because WebFetch summarises pages with a small model and a
   * one-word answer is outweighed by routine side-work.
   */
  assistantModels: string[];
  /** Every tool actually invoked, verbatim. The allowlist is checked against
   *  this, not against what the server advertised. */
  toolsCalled: string[];
}

export interface Usage {
  costUsd: number;
  durationMs: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** One `(question, arm, rep)` cell. */
export interface Cell {
  questionId: string;
  armId: string;
  rep: number;
  status: FailureClass;
  answer: string;
  sources: SourceRecord[];
  usage: Usage;
  provenance: Provenance;
  violations: string[];
  retries: number;
}

export type DimensionScores = Record<DimensionName, number>;
