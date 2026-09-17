import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyseCitations, buildRegistry, normalizeUrl, stripLineGutter } from "./sources.js";
import type { StreamEvent, ToolCall } from "./spawn.js";
import type { SourceRecord } from "./types.js";

/** Replays a captured transcript through the same collector the runner uses. */
function toolCallsFromFixture(path: string): ToolCall[] {
  const events = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StreamEvent);

  const calls = new Map<string, ToolCall>();
  let turn = 0;
  for (const event of events) {
    const content = (event["message"] as Record<string, unknown> | undefined)?.["content"];
    if (!Array.isArray(content)) continue;
    if (event.type === "assistant") {
      turn += 1;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] !== "tool_use") continue;
        calls.set(String(block["id"]), {
          id: String(block["id"]),
          name: String(block["name"]),
          input: (block["input"] as Record<string, unknown>) ?? {},
          turn,
          result: null,
          isError: false,
        });
      }
    } else if (event.type === "user") {
      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] !== "tool_result") continue;
        const call = calls.get(String(block["tool_use_id"]));
        if (!call) continue;
        const raw = block["content"];
        call.result = typeof raw === "string" ? raw : JSON.stringify(raw);
        call.isError = block["is_error"] === true;
      }
    }
  }
  return [...calls.values()];
}

const FIXTURE = "test/fixtures/transcripts/files-what-it-does.jsonl";

function call(name: string, input: Record<string, unknown>, result: string | null): ToolCall {
  return { id: `t-${name}-${Math.random()}`, name, input, turn: 1, result, isError: false };
}

describe("stripLineGutter", () => {
  it("removes the line-number prefix the Read tool adds", () => {
    expect(stripLineGutter("     1\ttitle: X\n     2\tbody")).toBe("title: X\nbody");
  });
});

describe("normalizeUrl", () => {
  it("collapses fragments, tracking params and trailing slashes to one identity", () => {
    const a = normalizeUrl("https://Example.com/pricing/?utm_source=x#plans");
    const b = normalizeUrl("https://example.com/pricing");
    expect(a).toBe(b);
  });

  it("treats www and bare host as the same page", () => {
    // Otherwise one page counts as two sources and the web arm looks richer
    // than it is.
    expect(normalizeUrl("https://www.coconut.dev/pricing")).toBe(
      normalizeUrl("http://coconut.dev/pricing/"),
    );
  });
});

describe("buildRegistry over a real transcript", () => {
  const registry = buildRegistry(toolCallsFromFixture(FIXTURE));

  it("records the pages that were actually opened", () => {
    const read = registry.filter((r) => r.access === "read" && !r.isError).map((r) => r.path);
    expect(read).toContain("/home/example/ripe/corpora/files/products/index.md");
    expect(read.length).toBeGreaterThan(0);
  });

  it("keeps a failed read out of the opened set rather than dropping it silently", () => {
    const failed = registry.filter((r) => r.isError);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((r) => r.connector === "files")).toBe(true);
  });

  it("attributes every row to a connector", () => {
    expect(registry.every((r) => r.connector !== "unknown")).toBe(true);
  });

  it("counts a glob hit as listed, not opened", () => {
    const globbed = registry.find((r) => r.path.endsWith("changelog.md"));
    expect(globbed?.access).toBe("list");
  });
});

describe("buildRegistry merging", () => {
  it("upgrades a listed page to opened, as one row", () => {
    const registry = buildRegistry([
      call("Glob", { pattern: "**/*" }, "/corpus/a.md\n/corpus/b.md"),
      call("Read", { file_path: "/corpus/a.md" }, "     1\thello"),
    ]);
    const a = registry.filter((r) => r.path === "/corpus/a.md");
    expect(a).toHaveLength(1);
    expect(a[0]!.access).toBe("read");
    // The rank it was first surfaced at survives the upgrade.
    expect(a[0]!.rank).toBe(0);
  });

  it("counts repeat opens of the same page", () => {
    const registry = buildRegistry([
      call("Read", { file_path: "/corpus/a.md" }, "x"),
      call("Read", { file_path: "/corpus/a.md" }, "x"),
    ]);
    expect(registry[0]!.reads).toBe(2);
  });

  it("extracts coconut pages, ranks and versions from a search envelope", () => {
    const result = JSON.stringify({
      items: [
        { path: "products/index", version: 5, updatedAt: "2026-09-01T00:00:00Z" },
        { path: "company/company", version: 2, updatedAt: "2026-08-01T00:00:00Z" },
      ],
    });
    const registry = buildRegistry([
      call("mcp__coco__context_search_shared_pages", { query: "pricing" }, result),
    ]);
    expect(registry.map((r) => r.uri)).toEqual(["coco://products/index", "coco://company/company"]);
    expect(registry[0]!.rank).toBe(0);
    expect(registry[0]!.version).toBe(5);
    expect(registry[0]!.access).toBe("search");
  });

  it("treats grep content hits as reads of an excerpt, visible to the judge", () => {
    // Real shape from a single-file grep: `line:text` with `line-text` context.
    const registry = buildRegistry([
      call(
        "Grep",
        { pattern: "DEC-0045", path: "/corpus/company/decisions.md", output_mode: "content" },
        "34:| DEC-0045 | 2026-09-03 | Deprioritise VCs |\n35-| DEC-0046 | 2026-09-05 | VCs out of scope |",
      ),
    ]);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.access).toBe("read");
    expect(registry[0]!.path).toBe("/corpus/company/decisions.md");
    expect(registry[0]!.text).toContain("DEC-0045");
    expect(registry[0]!.text).not.toMatch(/^34:/);
  });

  it("groups multi-file grep content by file", () => {
    const registry = buildRegistry([
      call(
        "Grep",
        { pattern: "price", path: "/corpus", output_mode: "content" },
        "/corpus/a.md:3:price is $29\n/corpus/b.md:9:no price\n/corpus/a.md:4:per seat",
      ),
    ]);
    expect(registry.map((r) => r.path).sort()).toEqual(["/corpus/a.md", "/corpus/b.md"]);
    expect(registry.find((r) => r.path === "/corpus/a.md")!.text).toBe("price is $29\nper seat");
  });

  it("keeps files_with_matches grep as merely surfaced", () => {
    const registry = buildRegistry([
      call("Grep", { pattern: "price", path: "/corpus" }, "Found 2 files\n/corpus/a.md\n/corpus/b.md"),
    ]);
    expect(registry.every((r) => r.access === "search")).toBe(true);
  });

  it("never drops an unrecognised tool", () => {
    const registry = buildRegistry([call("SomeFutureTool", { q: 1 }, "stuff")]);
    expect(registry).toHaveLength(1);
    expect(registry[0]!.connector).toBe("unknown");
  });
});

function row(over: Partial<SourceRecord>): SourceRecord {
  return {
    uri: "coco://a/b",
    path: "a/b",
    connector: "coconut",
    tool: "t",
    access: "read",
    bytes: 10,
    reads: 1,
    rank: null,
    turn: 1,
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
    ...over,
  };
}

describe("analyseCitations", () => {
  it("credits a page the answer cites and actually opened", () => {
    const registry = [row({ uri: "coco://products/index", path: "products/index" })];
    analyseCitations("See `products/index` for detail.", registry);
    expect(registry[0]!.contributed).toBe(true);
    expect(registry[0]!.claimedOnly).toBe(false);
  });

  it("flags a citation to a page that was only listed, never opened", () => {
    const registry = [
      row({ uri: "coco://products/index", path: "products/index", access: "search", reads: 0 }),
    ];
    analyseCitations("Per products/index, we charge nothing.", registry);
    expect(registry[0]!.claimedOnly).toBe(true);
  });

  it("matches a loose file citation by path suffix", () => {
    const registry = [
      row({
        uri: "file:///abs/corpora/files/company/company.md",
        path: "/abs/corpora/files/company/company.md",
        connector: "files",
      }),
    ];
    analyseCitations("Stated in `company/company.md:101-111`.", registry);
    expect(registry[0]!.contributed).toBe(true);
  });

  it("reports a cited page that exists in the corpus but was never opened", () => {
    const { unresolvable } = analyseCitations(
      "Pricing lives in engineering/billing/credit-model.",
      [],
      new Set(["engineering/billing/credit-model"]),
    );
    expect(unresolvable).toContain("engineering/billing/credit-model");
  });

  it("ignores prose that merely looks like a path", () => {
    const { cited, unresolvable } = analyseCitations("we win/lose on support", []);
    expect(cited.size).toBe(0);
    expect(unresolvable).toHaveLength(0);
  });
});
