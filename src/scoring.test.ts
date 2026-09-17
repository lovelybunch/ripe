import { describe, expect, it } from "vitest";
import { checkFileScope, checkProvenance } from "./assert.js";
import { classifyDecay, freshnessScore, isDraft, isHumanAuthor, pickOwner, pickReviewDate } from "./hydrate.js";
import { parseRole, buildPreamble } from "./role.js";
import type { Arm, Provenance, SourceRecord } from "./types.js";

const NO_TOOLS: Arm = {
  id: "none",
  label: "None",
  rationale: "",
  tools: [],
  allowedTools: [],
  mcpServers: {},
  addDirs: [],
  requiresEnv: [],
};

const clean = (over: Partial<Provenance> = {}): Provenance => ({
  model: "claude-sonnet-5",
  mcpServers: [],
  tools: [],
  memoryPaths: [],
  cwd: "/tmp/scratch/cwd",
  hookEvents: 0,
  permissionDenials: 0,
  outputTokensByModel: { "claude-sonnet-5": 300 },
  assistantModels: ["claude-sonnet-5"],
  toolsCalled: [],
  ...over,
});

describe("metadata normalization", () => {
  it("reads a review date under any of the six key spellings", () => {
    // Six keys for one concept is the corpus's actual state (finding L-0015);
    // a scorer that reads only `last_reviewed` mis-scores most pages.
    for (const key of ["last_reviewed", "last-reviewed", "lastReviewed", "lastUpdated"]) {
      const picked = pickReviewDate({ [key]: "2026-08-01" });
      expect(picked.value).toBe("2026-08-01");
      expect(picked.key).toBe(key);
    }
  });

  it("ignores an unparseable review date rather than trusting it", () => {
    expect(pickReviewDate({ last_reviewed: "soon" }).value).toBeNull();
  });

  it("treats a boolean status as a draft, not as a string", () => {
    // `status` holds both booleans and strings across 72 pages (L-0016).
    expect(isDraft({ status: false })).toBe(true);
    expect(isDraft({ status: "draft" })).toBe(true);
    expect(isDraft({ status: "published" })).toBe(false);
  });

  it("finds an owner under any of its spellings", () => {
    expect(pickOwner({ owner: "Priya" })).toBe("Priya");
    expect(pickOwner({ owners: ["Sam", "Jo"] })).toBe("Sam");
    expect(pickOwner({})).toBeNull();
  });
});

describe("author type", () => {
  it("recognises the API's actual label for a person", () => {
    // The revision API says "human". Looking for "user" flagged every
    // human-written page as agent-only on the first real run.
    expect(isHumanAuthor({ authorType: "human" })).toBe(true);
    expect(isHumanAuthor({ authorType: "user" })).toBe(true);
    expect(isHumanAuthor({ authorType: "agent" })).toBe(false);
    expect(isHumanAuthor({})).toBe(false);
  });
});

describe("decay classes", () => {
  it("treats a decision record as durable, not stale", () => {
    // An ADR records what was decided, not what is true now: it does not
    // decay, it gets superseded.
    expect(classifyDecay("company/decisions")).toBe("durable");
  });

  it("treats pricing and people as volatile", () => {
    expect(classifyDecay("engineering/billing/credit-model")).toBe("volatile");
    expect(classifyDecay("company/people")).toBe("volatile");
  });

  it("falls back to standard", () => {
    expect(classifyDecay("marketing/audience")).toBe("standard");
  });
});

const src = (over: Partial<SourceRecord>): SourceRecord =>
  ({
    uri: "coco://a/b",
    path: "a/b",
    connector: "coconut",
    tool: "t",
    access: "read",
    bytes: 100,
    reads: 1,
    rank: null,
    turn: 1,
    isError: false,
    format: "markdown",
    version: 1,
    updatedAt: null,
    ageDays: 0,
    decayClass: "standard",
    owner: "Priya",
    status: null,
    lastReviewed: null,
    lastHumanEdit: null,
    lastEditor: null,
    editorType: "user",
    changeNote: null,
    agentWrittenOnly: false,
    humanStale: false,
    brokenLinks: null,
    freshness: null,
    hydration: "hydrated",
    contributed: false,
    claimedOnly: false,
    ...over,
  }) as SourceRecord;

describe("freshness", () => {
  it("does not penalise a page inside its grace window", () => {
    expect(freshnessScore(src({ ageDays: 20 }), false)).toBe(1);
  });

  it("decays by half over one half-life past grace", () => {
    expect(freshnessScore(src({ ageDays: 150 }), false)).toBeCloseTo(0.5, 2);
  });

  it("scores an empty page zero however recently it was touched", () => {
    expect(freshnessScore(src({ ageDays: 0 }), true)).toBe(0);
  });

  it("keeps a 54-day engineering standard healthy, not alarming", () => {
    // The hygiene loop flags this page; under a reference-length half-life it
    // is fine, which is the right call and why one global half-life fails.
    const score = freshnessScore(src({ ageDays: 54, decayClass: "standard" }), false);
    expect(score).toBeGreaterThan(0.8);
  });

  it("penalises a page an agent refreshed but no human reviewed", () => {
    const fresh = freshnessScore(src({ ageDays: 10 }), false);
    const stale = freshnessScore(src({ ageDays: 10, humanStale: true }), false);
    expect(stale).toBeLessThan(fresh);
  });

  it("stacks penalties multiplicatively without going negative", () => {
    const score = freshnessScore(
      src({ ageDays: 400, owner: null, status: "draft", humanStale: true, brokenLinks: 3 }),
      false,
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.2);
  });
});

describe("isolation assertions", () => {
  it("passes a genuinely clean control arm", () => {
    expect(checkProvenance(NO_TOOLS, "claude-sonnet-5", clean())).toEqual([]);
  });

  it("catches a tool the arm was never given", () => {
    const found = checkProvenance(NO_TOOLS, "claude-sonnet-5", clean({ tools: ["Bash"] }));
    expect(found.map((v) => v.code)).toContain("tools_leaked");
  });

  it("ignores MCP tools the server merely advertises", () => {
    // The server lists all 33 of its tools, writes included. Advertised is
    // not available; this voided the first real Coconut run.
    const arm: Arm = { ...NO_TOOLS, id: "coconut", mcpServers: { coco: {} }, allowedTools: ["mcp__coco__context_get_shared_page"] };
    const found = checkProvenance(arm, "claude-sonnet-5", clean({
      mcpServers: ["coco"],
      tools: ["mcp__coco__context_get_shared_page", "mcp__coco__agent_create_task"],
      toolsCalled: ["mcp__coco__context_get_shared_page"],
    }));
    expect(found).toEqual([]);
  });

  it("catches a call to a tool outside the allowlist", () => {
    const arm: Arm = { ...NO_TOOLS, id: "coconut", mcpServers: { coco: {} }, allowedTools: ["mcp__coco__context_get_shared_page"] };
    const found = checkProvenance(arm, "claude-sonnet-5", clean({
      mcpServers: ["coco"],
      tools: ["mcp__coco__context_get_shared_page", "mcp__coco__agent_create_task"],
      toolsCalled: ["mcp__coco__agent_create_task"],
    }));
    expect(found.map((v) => v.code)).toContain("tool_outside_allowlist");
  });

  it("catches CLAUDE.md or memory in scope", () => {
    const found = checkProvenance(NO_TOOLS, "claude-sonnet-5", clean({ memoryPaths: ["/x/CLAUDE.md"] }));
    expect(found.map((v) => v.code)).toContain("memory_leaked");
  });

  it("catches a hook firing, which can inject context the arm was not given", () => {
    const found = checkProvenance(NO_TOOLS, "claude-sonnet-5", clean({ hookEvents: 2 }));
    expect(found.map((v) => v.code)).toContain("hooks_fired");
  });

  it("reports a denied tool call as a crippled arm, not a weak source", () => {
    const found = checkProvenance(NO_TOOLS, "claude-sonnet-5", clean({ permissionDenials: 1 }));
    expect(found.map((v) => v.code)).toContain("permission_denied");
  });

  it("ignores tool-side work billed to a small model, however large", () => {
    // WebFetch summarises pages with a small model; a one-word canary answer
    // is outweighed by side-work. Neither is a fallback, and both voided real
    // runs when token share was the test.
    const found = checkProvenance(
      NO_TOOLS,
      "claude-sonnet-5",
      clean({ outputTokensByModel: { "claude-sonnet-5": 5, "claude-haiku-4-5-20251001": 900 } }),
    );
    expect(found).toEqual([]);
  });

  it("catches a real silent fallback: an assistant turn written by another model", () => {
    const found = checkProvenance(
      NO_TOOLS,
      "claude-sonnet-5",
      clean({ assistantModels: ["claude-haiku-4-5-20251001"] }),
    );
    expect(found.map((v) => v.code)).toContain("model_fallback");
  });

  it("catches a file read outside the arm's allowed directories", () => {
    const arm: Arm = { ...NO_TOOLS, id: "files", tools: ["Read"], addDirs: ["/corpus"] };
    const found = checkFileScope(arm, [
      src({ connector: "files", path: "/corpus/ok.md" }),
      src({ connector: "files", path: "/Users/me/.ssh/id_rsa" }),
    ]);
    expect(found.map((v) => v.code)).toContain("file_scope_escape");
  });

  it("allows reads inside the allowed directory", () => {
    const arm: Arm = { ...NO_TOOLS, id: "files", tools: ["Read"], addDirs: ["/corpus"] };
    expect(checkFileScope(arm, [src({ connector: "files", path: "/corpus/ok.md" })])).toEqual([]);
  });
});

describe("role files", () => {
  const good = `---
role: demo
title: Demo
questions:
  - id: q1
    ask: What does it cost?
    must_cover:
      - A number or a posture
---

# The job

Answer accurately.`;

  it("parses questions and facets", () => {
    const role = parseRole(good, "demo.md");
    expect(role.questions).toHaveLength(1);
    expect(role.questions[0]!.mustCover).toEqual(["A number or a posture"]);
    expect(role.questions[0]!.weight).toBe(1);
  });

  it("rejects a duplicate question id, which would corrupt the trend line", () => {
    const dup = good.replace("questions:", "questions:\n  - id: q1\n    ask: x\n    must_cover: [y]");
    expect(() => parseRole(dup, "demo.md")).toThrow(/duplicate question id/);
  });

  it("rejects a question with no facets to check against", () => {
    const bad = good.replace("      - A number or a posture", "");
    expect(() => parseRole(bad, "demo.md")).toThrow(/must_cover/);
  });

  it("tells a no-tools arm not to simulate looking things up", () => {
    // Otherwise the control role-plays a tool call and stops, which cripples
    // it and manufactures the delta.
    const role = parseRole(good, "demo.md");
    expect(buildPreamble(role, 350, false)).toMatch(/no tools and cannot look anything up/);
    expect(buildPreamble(role, 350, true)).toMatch(/You have tools/);
  });

  it("gives both arms the same word cap and the same honesty instruction", () => {
    const role = parseRole(good, "demo.md");
    for (const hasTools of [true, false]) {
      const preamble = buildPreamble(role, 350, hasTools);
      expect(preamble).toContain("under 350 words");
      expect(preamble).toMatch(/a plausible guess is still invented/);
    }
  });
});
