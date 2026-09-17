// Fills in the provenance a flat folder cannot answer: which version, who
// touched it last, whether that was a person, and what they changed.
//
// Reads go through the already-authenticated `coconut` CLI rather than the SDK,
// so the tool works with no API key configured. Swapping in `coconut-sdk` is a
// drop-in change behind `fetchPage`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DECAY_CLASSES,
  DECAY_PATTERNS,
  FRESHNESS_PENALTIES,
  MIN_CONTENT_TOKENS,
  type DecayClass,
} from "./config.js";
import type { SourceRecord } from "./types.js";

const exec = promisify(execFile);

/**
 * The same review date is spelled six ways in a real corpus (open finding
 * L-0015). Read raw frontmatter and you silently mis-score most pages, so the
 * alias table is not optional — and the aliases that fire are reported, which
 * cross-references the existing finding instead of re-raising it.
 */
export const REVIEW_KEYS = [
  "last_reviewed",
  "last-reviewed",
  "lastReviewed",
  "lastReviewDate",
  "lastReviewedAgainst",
  "last_updated",
  "lastUpdated",
] as const;

export const OWNER_KEYS = ["owner", "owners", "author", "maintainer"] as const;

/** `status` holds both booleans and strings across the corpus (L-0016). */
const DRAFT_VALUES = new Set(["draft", "wip", "placeholder", "stub", "todo", "false"]);

export interface PageEnvelope {
  path: string;
  title?: string;
  version?: number;
  updatedAt?: string;
  frontmatter?: Record<string, unknown>;
  content?: string;
}

export interface VersionEntry {
  version: number;
  author?: string;
  authorType?: string;
  authorLabel?: string;
  note?: string;
  createdAt?: string;
  isLatest?: boolean;
}

export interface MetaEntry {
  value: unknown;
}

async function coco<T>(args: string[]): Promise<T | null> {
  try {
    const { stdout } = await exec("coconut", [...args, "--json"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout) as T;
  } catch {
    // A page we cannot read is `hydration: "unavailable"`, never scored as
    // unknown-bad — a missing read must not become a penalty.
    return null;
  }
}

/**
 * The revision API labels people `authorType: "human"`. An earlier version of
 * this looked for `"user"` and so flagged every human-written page as
 * agent-only — which drove half the findings on the first real run.
 * Anything not recognisably a person is treated as an agent.
 */
export function isHumanAuthor(v: { authorType?: string }): boolean {
  return v.authorType === "human" || v.authorType === "user";
}

export interface Hydrated {
  page: PageEnvelope | null;
  versions: VersionEntry[];
  metadata: Record<string, unknown>;
}

export async function fetchPage(path: string): Promise<Hydrated> {
  const [page, versions, meta] = await Promise.all([
    coco<PageEnvelope>(["page", "get", path]),
    coco<{ items?: VersionEntry[] }>(["page", "versions", path]),
    coco<{ metadata?: Record<string, MetaEntry> }>(["meta", "get", path]),
  ]);

  // Frontmatter and the metadata store are genuinely different surfaces: a page
  // can have `frontmatter: {}` and a populated store. Merge with the store
  // winning, because that is what `coco query` reads.
  const metadata: Record<string, unknown> = { ...(page?.frontmatter ?? {}) };
  for (const [key, entry] of Object.entries(meta?.metadata ?? {})) {
    metadata[key] = entry && typeof entry === "object" && "value" in entry ? entry.value : entry;
  }

  return { page, versions: versions?.items ?? [], metadata };
}

export function pickReviewDate(metadata: Record<string, unknown>): { value: string | null; key: string | null } {
  for (const key of REVIEW_KEYS) {
    const raw = metadata[key];
    if (typeof raw !== "string") continue;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return { value: raw, key };
  }
  return { value: null, key: null };
}

export function pickOwner(metadata: Record<string, unknown>): string | null {
  for (const key of OWNER_KEYS) {
    const raw = metadata[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  }
  return null;
}

export function isDraft(metadata: Record<string, unknown>): boolean {
  const raw = metadata["status"];
  if (raw === false) return true;
  return typeof raw === "string" && DRAFT_VALUES.has(raw.toLowerCase());
}

export function classifyDecay(path: string): DecayClass {
  const lower = path.toLowerCase();
  for (const [pattern, cls] of DECAY_PATTERNS) {
    if (pattern.test(lower)) return cls;
  }
  return "standard";
}

export function daysBetween(from: string | null | undefined, now: Date): number | null {
  if (!from) return null;
  const then = new Date(from);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, (now.getTime() - then.getTime()) / 86_400_000);
}

/**
 * 0–1 freshness. Penalties are multiplicative so they compose to a floor,
 * never go negative, and each term stays independently auditable.
 */
export function freshnessScore(row: SourceRecord, isEmpty: boolean): number {
  if (isEmpty) return 0;
  const cls = DECAY_CLASSES[row.decayClass ?? "standard"];
  const age = row.ageDays ?? 0;
  let score = Math.pow(0.5, Math.max(0, age - cls.grace) / cls.halfLife);

  if (isDraftFlag(row)) score *= 1 - FRESHNESS_PENALTIES.draft;
  if (!row.owner) score *= 1 - FRESHNESS_PENALTIES.noOwner;
  if (row.humanStale) score *= 1 - FRESHNESS_PENALTIES.humanStale;
  if (row.brokenLinks && row.brokenLinks > 0) {
    score *= 1 - Math.min(FRESHNESS_PENALTIES.brokenLinksMax, 0.5);
  }
  return score;
}

function isDraftFlag(row: SourceRecord): boolean {
  return row.status != null && DRAFT_VALUES.has(row.status.toLowerCase());
}

export interface HydrateStats {
  /** Which review-date aliases actually fired — a finding in its own right. */
  reviewKeyAliases: Record<string, number>;
  statusCoercions: number;
  hydrated: number;
  unavailable: number;
}

/** Enriches every Coconut row in place. Non-Coconut rows are left alone, and
 *  that absence is what the report surfaces as a capability gap. */
export async function hydrateRegistry(
  registry: SourceRecord[],
  now: Date = new Date(),
): Promise<HydrateStats> {
  const stats: HydrateStats = {
    reviewKeyAliases: {},
    statusCoercions: 0,
    hydrated: 0,
    unavailable: 0,
  };

  const targets = registry.filter((r) => r.connector === "coconut" && r.uri.startsWith("coco://"));

  await Promise.all(
    targets.map(async (row) => {
      const { page, versions, metadata } = await fetchPage(row.path);
      if (!page) {
        row.hydration = "unavailable";
        stats.unavailable += 1;
        return;
      }

      row.hydration = "hydrated";
      stats.hydrated += 1;
      row.format = "markdown";
      row.version = page.version ?? row.version;
      row.updatedAt = page.updatedAt ?? row.updatedAt;
      row.ageDays = daysBetween(row.updatedAt, now);
      row.decayClass = classifyDecay(row.path);
      row.owner = pickOwner(metadata);

      const rawStatus = metadata["status"];
      if (typeof rawStatus === "boolean") stats.statusCoercions += 1;
      row.status = rawStatus == null ? null : String(rawStatus);

      const review = pickReviewDate(metadata);
      row.lastReviewed = review.value;
      if (review.key) {
        stats.reviewKeyAliases[review.key] = (stats.reviewKeyAliases[review.key] ?? 0) + 1;
      }

      const latest = versions.find((v) => v.isLatest) ?? versions[0];
      row.lastEditor = latest?.authorLabel ?? latest?.author ?? null;
      row.editorType = latest ? (isHumanAuthor(latest) ? "user" : "agent") : null;
      row.changeNote = latest?.note ?? null;

      const human = versions.find(isHumanAuthor);
      row.lastHumanEdit = human?.createdAt ?? null;
      // No person has ever touched this page. For a security questionnaire
      // that is disqualifying, however good the content reads.
      row.agentWrittenOnly = versions.length > 0 && !human;

      // Recently refreshed by an agent, but past its window for human review:
      // it looks fresh and is not.
      const humanAge = daysBetween(row.lastHumanEdit, now);
      const cls = DECAY_CLASSES[row.decayClass];
      row.humanStale =
        row.agentWrittenOnly || (humanAge != null && humanAge > cls.halfLife + cls.grace);

      const tokens = Math.ceil((page.content?.length ?? 0) / 4);
      row.freshness = freshnessScore(row, tokens < MIN_CONTENT_TOKENS);
    }),
  );

  return stats;
}
