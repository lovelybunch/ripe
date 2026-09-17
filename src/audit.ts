// The free front door: a corpus-wide sweep with no agent calls, in seconds.
//
// It reads the same export bundles the files arm is built from, so the audit
// and the eval describe one corpus. And it reconciles against the findings the
// context-hygiene loop already publishes rather than rediscovering them —
// confirming a known finding with a measured consequence is more useful than
// raising it a second time under a new id.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AUDIT_EXCLUDE, DECAY_CLASSES, DUP, MIN_CONTENT_TOKENS } from "./config.js";
import {
  classifyDecay,
  daysBetween,
  isDraft,
  pickOwner,
  pickReviewDate,
  REVIEW_KEYS,
} from "./hydrate.js";

const exec = promisify(execFile);

interface ExportPage {
  path: string;
  title?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
  version?: number;
}

export interface AuditPage {
  path: string;
  space: string;
  title: string;
  tokens: number;
  ageDays: number | null;
  decayClass: keyof typeof DECAY_CLASSES;
  /** Past its half-life plus grace: the point at which decay crosses 0.5. */
  stale: boolean;
  owner: string | null;
  reviewKey: string | null;
  reviewDate: string | null;
  draft: boolean;
  empty: boolean;
  metadata: Record<string, unknown>;
}

export interface DuplicatePair {
  a: string;
  b: string;
  overlap: number;
  kind: "duplicate" | "substantial";
}

export interface AuditFinding {
  id: string;
  kind: "empty" | "stale" | "unowned" | "unreviewed" | "draft" | "duplicate" | "broken-link" | "key-sprawl" | "type-mix";
  finding: string;
  pages: string[];
  smallestFix: string;
  /** Set when the hygiene loop already tracks this: we confirm, not re-raise. */
  confirms?: string;
}

export interface SpaceStats {
  space: string;
  pages: number;
  excluded: number;
  medianAgeDays: number;
  p90AgeDays: number;
  stale: number;
  owned: number;
  reviewed: number;
  drafts: number;
  empty: number;
  brokenLinks: number;
}

export interface AuditResult {
  spaces: SpaceStats[];
  pages: AuditPage[];
  duplicates: DuplicatePair[];
  /** Which spellings of the review-date key are in use, and how often. */
  reviewKeys: Record<string, number>;
  /** Metadata keys holding more than one JSON type across pages. */
  typeMixes: Array<{ key: string; types: string[]; pages: number }>;
  findings: AuditFinding[];
  reconciledAgainst: string | null;
}

async function coco<T>(args: string[]): Promise<T | null> {
  try {
    const { stdout } = await exec("coconut", [...args, "--json"], { maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

/** FNV-1a over the sorted parts, so an id depends only on what it is about. */
function contentId(parts: string[]): string {
  let h = 2166136261;
  for (const ch of [...parts].sort().join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `E-${(h >>> 0).toString(16).slice(0, 4)}`;
}

// ------------------------------------------------------------ duplication

/**
 * Word 5-gram shingles over normalized text. Frontmatter, fenced code and link
 * targets are stripped first; so is any line appearing in a large share of
 * the corpus, because nav and footer chrome would otherwise make every page a
 * duplicate of every other.
 */
function shingles(text: string, boilerplate: Set<string>): Set<number> {
  const cleaned = text
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .split("\n")
    .filter((line) => !boilerplate.has(line.trim()))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const out = new Set<number>();
  for (let i = 0; i + DUP.shingleSize <= cleaned.length; i += 1) {
    let h = 2166136261;
    for (const ch of cleaned.slice(i, i + DUP.shingleSize).join(" ")) {
      h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    }
    out.add(h >>> 0);
  }
  return out;
}

function findBoilerplate(bodies: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    for (const line of new Set(body.split("\n").map((l) => l.trim()).filter((l) => l.length > 12))) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(bodies.length * DUP.boilerplateShare));
  return new Set([...counts.entries()].filter(([, n]) => n >= threshold).map(([l]) => l));
}

/**
 * Pairwise over the whole corpus: at a few hundred pages that is well under a
 * second, and it avoids a MinHash dependency until a corpus genuinely needs one.
 *
 * Two measures, because duplication in a context layer is usually asymmetric —
 * a summary fully contained in a longer page has low Jaccard and containment
 * near 1, and Jaccard alone would miss the commonest real pattern.
 */
export function findDuplicates(pages: Array<{ path: string; content: string }>): DuplicatePair[] {
  const boilerplate = findBoilerplate(pages.map((p) => p.content));
  const sets = pages.map((p) => ({ path: p.path, s: shingles(p.content, boilerplate) }));
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const a = sets[i]!;
      const b = sets[j]!;
      if (!a.s.size || !b.s.size) continue;
      let inter = 0;
      const [small, large] = a.s.size < b.s.size ? [a.s, b.s] : [b.s, a.s];
      for (const h of small) if (large.has(h)) inter += 1;
      if (!inter) continue;

      const jaccard = inter / (a.s.size + b.s.size - inter);
      const containment = small.size >= DUP.minShinglesForContainment ? inter / small.size : 0;
      const overlap = Math.max(jaccard, containment);

      if (overlap >= DUP.duplicate) pairs.push({ a: a.path, b: b.path, overlap, kind: "duplicate" });
      else if (overlap >= DUP.substantial) pairs.push({ a: a.path, b: b.path, overlap, kind: "substantial" });
    }
  }
  return pairs.sort((x, y) => y.overlap - x.overlap);
}

// ------------------------------------------------------------- the sweep

export interface AuditOptions {
  spaces: string[];
  includeReserved?: boolean;
  /** A hygiene-loop report page to reconcile against, e.g. loops/context-hygiene-report. */
  against?: string;
  now?: Date;
}

export async function audit(opts: AuditOptions): Promise<AuditResult> {
  const now = opts.now ?? new Date();
  const pages: AuditPage[] = [];
  const bodies: Array<{ path: string; content: string }> = [];
  const spaces: SpaceStats[] = [];
  const reviewKeys: Record<string, number> = {};
  const typesByKey = new Map<string, Map<string, number>>();
  const findings: AuditFinding[] = [];

  for (const space of opts.spaces) {
    const bundle = await coco<{ space?: { slug?: string }; pages?: ExportPage[] }>([
      "spaces",
      "export",
      space,
    ]);
    if (!bundle) continue;
    const slug = bundle.space?.slug ?? space;
    const broken = await coco<{ items?: Array<{ sourcePath: string; targetPath: string }> }>([
      "spaces",
      "broken-links",
      space,
    ]);

    let excluded = 0;
    const mine: AuditPage[] = [];

    for (const page of bundle.pages ?? []) {
      const path = `${slug}/${page.path}`;
      if (!opts.includeReserved && AUDIT_EXCLUDE.some((re) => re.test(`/${path}`))) {
        excluded += 1;
        continue;
      }

      // Frontmatter and the metadata store are different surfaces; a page can
      // have one populated and the other empty. Read both, store winning.
      const metadata: Record<string, unknown> = { ...(page.frontmatter ?? {}), ...(page.metadata ?? {}) };
      for (const [key, value] of Object.entries(metadata)) {
        const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
        const bucket = typesByKey.get(key) ?? new Map<string, number>();
        bucket.set(type, (bucket.get(type) ?? 0) + 1);
        typesByKey.set(key, bucket);
      }

      const review = pickReviewDate(metadata);
      if (review.key) reviewKeys[review.key] = (reviewKeys[review.key] ?? 0) + 1;

      const tokens = Math.ceil((page.content?.length ?? 0) / 4);
      const ageDays = daysBetween(page.updatedAt, now);
      const decayClass = classifyDecay(path);
      const cls = DECAY_CLASSES[decayClass];

      const row: AuditPage = {
        path,
        space: slug,
        title: page.title ?? page.path,
        tokens,
        ageDays,
        decayClass,
        stale: ageDays != null && ageDays > cls.halfLife + cls.grace,
        owner: pickOwner(metadata),
        reviewKey: review.key,
        reviewDate: review.value,
        draft: isDraft(metadata),
        empty: tokens < MIN_CONTENT_TOKENS,
        metadata,
      };
      mine.push(row);
      bodies.push({ path, content: page.content ?? "" });
    }

    const ages = mine.map((p) => p.ageDays ?? 0);
    spaces.push({
      space: slug,
      pages: mine.length,
      excluded,
      medianAgeDays: Math.round(median(ages)),
      p90AgeDays: Math.round(percentile(ages, 0.9)),
      stale: mine.filter((p) => p.stale).length,
      owned: mine.filter((p) => p.owner).length,
      reviewed: mine.filter((p) => p.reviewDate).length,
      drafts: mine.filter((p) => p.draft).length,
      empty: mine.filter((p) => p.empty).length,
      brokenLinks: broken?.items?.length ?? 0,
    });
    pages.push(...mine);

    for (const link of broken?.items ?? []) {
      // Paths here arrive already canonical, unlike the export bundle's.
      const source = link.sourcePath;
      // A broken link inside an agent run record is bookkeeping noise, and
      // there are enough of them to bury every real finding under it.
      if (!opts.includeReserved && AUDIT_EXCLUDE.some((re) => re.test(`/${source}`))) continue;
      findings.push({
        id: contentId(["broken-link", source, link.targetPath]),
        kind: "broken-link",
        finding: `Links to \`${link.targetPath}\`, which does not exist`,
        pages: [source],
        smallestFix: "Fix the link or create the target",
      });
    }
  }

  // --- per-page findings
  for (const page of pages) {
    if (page.empty) {
      findings.push({
        id: contentId(["empty", page.path]),
        kind: "empty",
        finding: `Empty (${page.tokens} tokens)${page.ageDays != null ? `, for ${Math.round(page.ageDays)} days` : ""}`,
        pages: [page.path],
        smallestFix: "Fill it or archive it",
      });
      continue; // an empty page's other flags are noise
    }
    if (page.stale) {
      findings.push({
        id: contentId(["stale", page.path]),
        kind: "stale",
        finding: `${Math.round(page.ageDays ?? 0)} days without an update (${page.decayClass}: window ${DECAY_CLASSES[page.decayClass].halfLife + DECAY_CLASSES[page.decayClass].grace}d)`,
        pages: [page.path],
        smallestFix: "Review it, or set a review date if it is still current",
      });
    }
    if (page.draft) {
      findings.push({
        id: contentId(["draft", page.path]),
        kind: "draft",
        finding: "Marked draft or placeholder",
        pages: [page.path],
        smallestFix: "Finish it, or clear the flag",
      });
    }
    if (!page.owner) {
      findings.push({
        id: contentId(["unowned", page.path]),
        kind: "unowned",
        finding: "No named owner",
        pages: [page.path],
        smallestFix: "Set `owner` — one metadata edit",
      });
    }
  }

  // --- corpus-wide findings
  const duplicates = findDuplicates(bodies);
  for (const pair of duplicates.filter((d) => d.kind === "duplicate")) {
    findings.push({
      id: contentId(["duplicate", pair.a, pair.b]),
      kind: "duplicate",
      finding: `${Math.round(pair.overlap * 100)}% overlap`,
      pages: [pair.a, pair.b],
      smallestFix: "Keep one, mark the other superseded — never delete",
    });
  }

  const keyNames = Object.keys(reviewKeys);
  if (keyNames.length > 1) {
    findings.push({
      id: contentId(["key-sprawl", "review-date"]),
      kind: "key-sprawl",
      finding: `${keyNames.length} spellings of one review-date key: ${keyNames.map((k) => `\`${k}\` ×${reviewKeys[k]}`).join(", ")}`,
      pages: [],
      smallestFix: `Consolidate to \`${keyNames.sort((a, b) => (reviewKeys[b] ?? 0) - (reviewKeys[a] ?? 0))[0]}\`, the most used`,
    });
  }

  const typeMixes = [...typesByKey.entries()]
    .filter(([, types]) => types.size > 1)
    .map(([key, types]) => ({
      key,
      types: [...types.keys()],
      pages: [...types.values()].reduce((a, b) => a + b, 0),
    }));
  for (const mix of typeMixes) {
    findings.push({
      id: contentId(["type-mix", mix.key]),
      kind: "type-mix",
      finding: `\`${mix.key}\` holds ${mix.types.join(" and ")} across ${mix.pages} pages — breaks any query filtering on it`,
      pages: [],
      smallestFix: "Standardize to one type and migrate",
    });
  }

  // --- reconcile: a known finding is confirmed, not re-raised
  let reconciledAgainst: string | null = null;
  if (opts.against) {
    const known = await loadLoopFindings(opts.against);
    if (known) {
      reconciledAgainst = opts.against;
      for (const finding of findings) {
        const hit = known.find(
          (k) =>
            finding.pages.some((p) => k.pages.some((kp) => p.endsWith(kp) || kp.endsWith(p))) ||
            (finding.kind === "key-sprawl" && /review|date/i.test(k.finding) && /key|spell/i.test(k.finding)) ||
            (finding.kind === "type-mix" && k.finding.includes(`\`${extractKey(finding.finding)}\``) && /boolean|string|type/i.test(k.finding)),
        );
        if (hit) finding.confirms = hit.id;
      }
    }
  }

  return {
    spaces,
    pages,
    duplicates,
    reviewKeys,
    typeMixes,
    findings: sortFindings(findings),
    reconciledAgainst,
  };
}

const extractKey = (finding: string): string => /`([^`]+)`/.exec(finding)?.[1] ?? "";

const KIND_ORDER: Record<AuditFinding["kind"], number> = {
  "broken-link": 0,
  empty: 1,
  duplicate: 2,
  "type-mix": 3,
  "key-sprawl": 4,
  stale: 5,
  draft: 6,
  unreviewed: 7,
  unowned: 8,
};

function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Map(findings.map((f) => [f.id, f]));
  return [...seen.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/**
 * Parses the `| id | raised | finding | pages | smallest fix | state | notes |`
 * table the hygiene and gaps loops publish. Anything that is not a table row
 * is ignored, so a change in prose around the table does not break this.
 */
export async function loadLoopFindings(
  path: string,
): Promise<Array<{ id: string; finding: string; pages: string[] }> | null> {
  const page = await coco<{ content?: string }>(["page", "get", path]);
  if (!page?.content) return null;
  return parseLoopTable(page.content);
}

export function parseLoopTable(markdown: string): Array<{ id: string; finding: string; pages: string[] }> {
  const rows: Array<{ id: string; finding: string; pages: string[] }> = [];
  for (const line of markdown.split("\n")) {
    const m = /^\|\s*([A-Z]-\d{4})\s*\|\s*[^|]*\|\s*([^|]*)\|\s*([^|]*)\|/.exec(line);
    if (!m) continue;
    const pages = (m[3] ?? "")
      .split(/[,;]/)
      .map((p) => p.trim().replace(/`/g, "").replace(/\s.*$/, ""))
      .filter((p) => /^[a-z0-9-]+\/[a-z0-9/_.*-]+$/i.test(p));
    rows.push({ id: m[1]!, finding: (m[2] ?? "").trim().replace(/`/g, "`"), pages });
  }
  return rows;
}
