// Turns a transcript's tool calls into one row per distinct thing the agent
// opened, normalized across connectors.
//
// Extractors are pure functions over a single tool call, matched on tool name.
// Adding a connector means adding one entry here plus one transcript fixture.
// An unrecognised tool is never dropped silently — it surfaces as
// `connector: "unknown"`, which is a visible gap rather than a missing row.

import type { Connector, SourceRecord } from "./types.js";
import type { ToolCall } from "./spawn.js";

type Partials = Array<Partial<SourceRecord> & Pick<SourceRecord, "uri" | "connector" | "access">>;

function blank(): Omit<SourceRecord, "uri" | "connector" | "access" | "tool" | "turn"> {
  return {
    path: "",
    bytes: null,
    reads: 0,
    rank: null,
    isError: false,
    format: null,
    version: null,
    updatedAt: null,
    ageDays: null,
    decayClass: null,
    owner: null,
    status: null,
    lastReviewed: null,
    lastHumanEdit: null,
    lastEditor: null,
    editorType: null,
    changeNote: null,
    agentWrittenOnly: false,
    humanStale: false,
    brokenLinks: null,
    freshness: null,
    hydration: "not_applicable",
    contributed: false,
    claimedOnly: false,
  };
}

/** The `Read` tool prefixes every line with `<n>\t`; that gutter is not content. */
export function stripLineGutter(text: string): string {
  return text.replace(/^\s*\d+\t/gm, "");
}

/**
 * One page, one row. Drops the fragment, tracking params, a trailing slash and
 * a `www.` prefix — otherwise `coconut.dev/pricing` and
 * `www.coconut.dev/pricing` count as two sources for the same page, which
 * silently inflates how much the web arm found.
 */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.protocol = "https:";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Coconut list/search results are JSON envelopes with an `items` array. */
function parseItems(result: string | null): Array<Record<string, unknown>> {
  if (!result) return [];
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    const items = parsed["items"];
    return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function cocoItems(call: ToolCall, access: "search" | "list"): Partials {
  return parseItems(call.result).flatMap((item, i) => {
    const path = asString(item["path"]);
    if (!path) return [];
    return [
      {
        uri: `coco://${path}`,
        path,
        connector: "coconut" as Connector,
        access,
        rank: i,
        version: typeof item["version"] === "number" ? item["version"] : null,
        updatedAt: asString(item["updatedAt"]),
      },
    ];
  });
}

/** Maps one tool call to zero or more source rows. */
function extract(call: ToolCall): Partials {
  const name = call.name;
  const input = call.input;
  const bytes = call.result?.length ?? null;

  // --- Coconut over MCP. Tool names are prefixed `mcp__<server>__`, and the
  //     server is named by the arm, so match on the suffix.
  const coco = /^mcp__[^_]+(?:_[^_]+)*__(?:context_|get_context_)/.test(name)
    ? name.replace(/^mcp__.*?__/, "")
    : null;

  if (coco) {
    if (coco === "context_get_shared_page") {
      const path = asString(input["path"]);
      if (!path) return [];
      return [
        {
          uri: `coco://${path}`,
          path,
          connector: "coconut",
          access: "read",
          bytes,
          text: call.result ?? undefined,
        },
      ];
    }
    if (coco === "context_search_shared_pages") return cocoItems(call, "search");
    if (coco === "context_list_shared_pages" || coco === "context_recent_shared_pages") {
      return cocoItems(call, "list");
    }
    if (
      coco === "context_get_page_metadata" ||
      coco === "context_get_page_links" ||
      coco === "context_get_shared_page_revisions"
    ) {
      const path = asString(input["path"]);
      if (!path) return [];
      return [{ uri: `coco://${path}`, path, connector: "coconut", access: "meta" }];
    }
    if (coco === "get_context_by_url") {
      const url = asString(input["url"]);
      if (!url) return [];
      return [
        {
          uri: normalizeUrl(url),
          path: url,
          connector: "coconut",
          access: "read",
          bytes,
          text: call.result ?? undefined,
        },
      ];
    }
    // A coco tool we have no extractor for. Better a visible unknown row than
    // a silently uncounted read.
    return [{ uri: `tool://${name}`, path: name, connector: "unknown", access: "read", bytes }];
  }

  // --- Local files
  if (name === "Read") {
    const path = asString(input["file_path"]);
    if (!path) return [];
    return [
      {
        uri: `file://${path}`,
        path,
        connector: "files",
        access: "read",
        bytes: call.result ? stripLineGutter(call.result).length : null,
        format: path.split(".").pop()?.toLowerCase() ?? null,
        text: call.result ? stripLineGutter(call.result) : undefined,
      },
    ];
  }
  if (name === "Grep" && isGrepContent(call)) return grepExcerpts(call);

  if (name === "Glob" || name === "Grep") {
    const lines = (call.result ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("/"));
    return lines.slice(0, 50).map((path, i) => ({
      uri: `file://${path.split(":")[0]}`,
      path: path.split(":")[0] ?? path,
      connector: "files" as Connector,
      access: name === "Glob" ? ("list" as const) : ("search" as const),
      rank: i,
    }));
  }

  // --- Web
  if (name === "WebFetch") {
    const url = asString(input["url"]);
    if (!url) return [];
    const uri = normalizeUrl(url);
    return [
      {
        uri,
        path: uri,
        connector: "web",
        access: "read",
        bytes,
        format: "html",
        text: call.result ?? undefined,
      },
    ];
  }
  if (name === "WebSearch") {
    const urls = [...(call.result ?? "").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]);
    return [...new Set(urls)].slice(0, 20).map((url, i) => ({
      uri: normalizeUrl(url),
      path: normalizeUrl(url),
      connector: "web" as Connector,
      access: "search" as const,
      rank: i,
    }));
  }

  return [{ uri: `tool://${name}`, path: name, connector: "unknown", access: "read", bytes }];
}

/**
 * Grep in `content` mode returns the matched lines themselves — the model reads
 * them and cites the file. That is a read of an excerpt, not a mere search hit,
 * and treating it as "surfaced only" did two unfair things at once: it counted
 * the citation as an invention, and it hid the very text the claim rests on
 * from the judge. Both penalised the flat-folder control specifically, which
 * is the direction that flatters the product.
 */
function isGrepContent(call: ToolCall): boolean {
  if (call.input["output_mode"] === "content") return true;
  const first = (call.result ?? "").split("\n").find((l) => l.trim());
  // `path:line:text` or, for a single-file grep, `line:text`.
  return !!first && /^(\/[^:\n]+)?:?\d+[:-]/.test(first) && !first.startsWith("Found ");
}

function grepExcerpts(call: ToolCall): Partials {
  const byPath = new Map<string, string[]>();
  const single = typeof call.input["path"] === "string" && /\.\w+$/.test(call.input["path"]) ? call.input["path"] : null;

  for (const raw of (call.result ?? "").split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const multi = /^(\/[^:]+?)[:-](\d+)[:-](.*)$/.exec(line);
    if (multi && !single) {
      byPath.set(multi[1]!, [...(byPath.get(multi[1]!) ?? []), multi[3] ?? ""]);
      continue;
    }
    const one = /^(\d+)[:-](.*)$/.exec(line);
    if (one && single) {
      byPath.set(single, [...(byPath.get(single) ?? []), one[2] ?? ""]);
    }
  }

  return [...byPath.entries()].map(([path, lines], i) => ({
    uri: `file://${path}`,
    path,
    connector: "files" as Connector,
    access: "read" as const,
    rank: i,
    format: "excerpt",
    bytes: lines.join("\n").length,
    text: lines.join("\n"),
  }));
}

/** `read` outranks `search`/`list`: what matters is whether content was opened. */
const ACCESS_RANK = { read: 3, meta: 2, search: 1, list: 0 } as const;

export function buildRegistry(calls: ToolCall[]): SourceRecord[] {
  const rows = new Map<string, SourceRecord>();

  for (const call of calls) {
    for (const partial of extract(call)) {
      const existing = rows.get(partial.uri);
      if (!existing) {
        rows.set(partial.uri, {
          ...blank(),
          ...partial,
          path: partial.path ?? partial.uri,
          tool: call.name,
          turn: call.turn,
          isError: call.isError,
          reads: partial.access === "read" ? 1 : 0,
        });
        continue;
      }

      // Merge: one page surfaced by a search, then opened, then checked for
      // metadata is one row — with the strongest access it ever received.
      if (ACCESS_RANK[partial.access] > ACCESS_RANK[existing.access]) {
        existing.access = partial.access;
        existing.tool = call.name;
      }
      if (partial.access === "read") existing.reads += 1;
      existing.bytes = partial.bytes ?? existing.bytes;
      if (partial.text && partial.text.length > (existing.text?.length ?? 0)) {
        existing.text = partial.text;
      }
      existing.version = existing.version ?? partial.version ?? null;
      existing.updatedAt = existing.updatedAt ?? partial.updatedAt ?? null;
      existing.format = existing.format ?? partial.format ?? null;
      // Keep the best rank the source ever achieved.
      if (partial.rank != null) {
        existing.rank = existing.rank == null ? partial.rank : Math.min(existing.rank, partial.rank);
      }
      existing.isError = existing.isError || call.isError;
    }
  }

  return [...rows.values()];
}

// ------------------------------------------------------- citation analysis

/** `space/page` shaped, two or more segments, no spaces. */
const COCO_PATH = /\b[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9._-]*)+\b/g;
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Which sources the answer *claims* versus which it actually opened.
 *
 * `claimedOnly` is the highest-signal field in the registry and needs no
 * judge: a citation to a page that was never opened is an invention wearing a
 * citation, and one to a page that does not exist is worse.
 *
 * Answers cite loosely — `company/company.md:101-111`, `products/index`, a bare
 * filename — so matching is by path suffix rather than exact URI. Being
 * generous here is deliberate: a false *match* only ever understates the
 * problem, whereas a false miss would invent one.
 */
export function analyseCitations(
  answer: string,
  registry: SourceRecord[],
  knownPaths?: ReadonlySet<string>,
): { cited: Set<string>; unresolvable: string[] } {
  const cited = new Set<string>();
  const unresolvable: string[] = [];

  for (const row of registry) row.claimedOnly = false;

  /** Longest-suffix match, so `company/company` beats a bare `company`. */
  const matchRow = (needle: string): SourceRecord | undefined => {
    const clean = needle.replace(/\.md$/, "").replace(/:[\d-]+$/, "").replace(/^\.?\//, "");
    if (!clean) return undefined;
    let best: SourceRecord | undefined;
    for (const row of registry) {
      const path = row.path.replace(/\.md$/, "");
      if (path === clean || path.endsWith(`/${clean}`)) {
        if (!best || row.path.length < best.path.length) best = row;
      }
    }
    return best;
  };

  for (const match of answer.matchAll(URL_RE)) {
    const uri = normalizeUrl(match[0]);
    const row = registry.find((r) => r.uri === uri);
    if (row) cited.add(row.uri);
    else unresolvable.push(uri);
  }

  for (const match of answer.matchAll(COCO_PATH)) {
    const raw = match[0].replace(/[.,;:)]+$/, "");
    const row = matchRow(raw);
    if (row) {
      cited.add(row.uri);
    } else if (knownPaths?.has(raw.replace(/\.md$/, ""))) {
      // The corpus has this page, but this run never opened it: the answer is
      // citing something it did not read.
      unresolvable.push(raw);
    }
  }

  for (const uri of cited) {
    const row = registry.find((r) => r.uri === uri);
    if (!row) continue;
    // Surfaced by a search or a glob but never actually opened still counts as
    // unverified — a title in a result list is not a source.
    if (row.access === "read") row.contributed = true;
    else row.claimedOnly = true;
  }

  return { cited, unresolvable };
}
