import { describe, expect, it } from "vitest";
import {
  attributeSupport,
  blindAnswer,
  blindSources,
  extractHardTokens,
  findHardTokenMisses,
  verifyQuotes,
  type Judgement,
} from "./judge.js";
import { callAutomation, renderAgentTask } from "./automate.js";
import { anchorMap, scoreConsistency, scoreEfficiency, scoreGrounding } from "./score.js";
import type { Question, SourceRecord } from "./types.js";

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
    version: 3,
    updatedAt: "2026-09-01",
    ageDays: 8,
    decayClass: "standard",
    owner: "Priya",
    status: null,
    lastReviewed: "2026-09-01",
    lastHumanEdit: "2026-09-01",
    lastEditor: "Priya",
    editorType: "user",
    changeNote: null,
    agentWrittenOnly: false,
    humanStale: false,
    brokenLinks: null,
    freshness: 0.95,
    hydration: "hydrated",
    contributed: true,
    claimedOnly: false,
    ...over,
  }) as SourceRecord;

const judgement = (over: Partial<Judgement> = {}): Judgement => ({
  claims: [],
  facets: [],
  contradictions: [],
  answer_disclosed_conflict: false,
  refused: false,
  hardTokenMisses: [],
  supportByUri: {},
  costUsd: 0,
  ...over,
});

describe("blinding", () => {
  it("hides paths and connector identity behind opaque ids", () => {
    const sources = [
      src({ uri: "coco://engineering/billing/credit-model", path: "engineering/billing/credit-model", text: "Starter is $29." }),
    ];
    const blinded = blindSources(sources, "pricing");
    expect(blinded.rendered).toContain('id="S1"');
    expect(blinded.rendered).not.toContain("engineering/billing");
    // The title survives because it carries real semantic signal.
    expect(blinded.rendered).toContain("credit-model");
  });

  it("rewrites the answer's own citations, so the answer cannot reveal the arm", () => {
    const sources = [src({ uri: "coco://products/index", path: "products/index", text: "x" })];
    const blinded = blindSources(sources, "seed");
    const out = blindAnswer("As stated in products/index, we do X.", blinded);
    expect(out).not.toContain("products/index");
    expect(out).toContain("[S1]");
  });

  it("scrubs a path the answer wrote with a prefix the blinded title lacks", () => {
    // Otherwise the judge sees `engineering/billing/credit-model` beside a
    // source titled only "credit-model" and flags an invented directory — a
    // false invention the harness created.
    const sources = [src({ uri: "coco://engineering/billing/credit-model", path: "engineering/billing/credit-model", text: "x" })];
    const blinded = blindSources(sources, "seed");
    const out = blindAnswer("Per engineering/billing/credit-model and see marketing/funnel-plan.md and deck.pptx.", blinded);
    expect(out).not.toMatch(/engineering|billing|marketing|funnel|\.pptx/);
    expect(out).toContain("[S1]");
  });

  it("leaves no directory prefix or extension clinging to an id", () => {
    // The real leak: answer cites `products/context/faq.md`, source path is the
    // absolute export location. Matching the inner segments alone leaves
    // `products/[S2].md`, and the judge flags an invented directory.
    const sources = [src({ uri: "file:///abs/corpora/files/products/context/faq.md", path: "/abs/corpora/files/products/context/faq.md", connector: "files", text: "x" })];
    const blinded = blindSources(sources, "seed");
    const out = blindAnswer("Per `products/context/faq.md` and `context/faq`, pricing is by conversation.", blinded);
    expect(out).toBe("Per `[S1]` and `[S1]`, pricing is by conversation.");
  });

  it("scrubs any URL that survives rewriting", () => {
    const blinded = blindSources([], "seed");
    expect(blindAnswer("See https://coconut.dev/pricing", blinded)).not.toContain("coconut.dev");
  });

  it("shuffles deterministically, so every arm sees the same order for a question", () => {
    const sources = ["a", "b", "c", "d"].map((p) => src({ uri: `coco://${p}`, path: p, text: p }));
    const first = [...blindSources(sources, "pricing").map.values()].map((s) => s.path);
    const second = [...blindSources(sources, "pricing").map.values()].map((s) => s.path);
    expect(first).toEqual(second);
  });

  it("only shows the judge sources that were actually opened", () => {
    const blinded = blindSources(
      [src({ access: "search", text: undefined }), src({ uri: "coco://x", path: "x", text: "body" })],
      "seed",
    );
    expect(blinded.map.size).toBe(1);
  });
});

describe("quote verification", () => {
  const blinded = blindSources(
    [src({ uri: "coco://p", path: "p", text: "Starter costs $29 per month." })],
    "seed",
  );

  it("keeps a claim whose quote genuinely appears in the source", () => {
    const j = judgement({
      claims: [
        { claim: "Starter is $29", cited_source: "S1", reasoning: "", support_quote: "Starter costs $29", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("supported");
  });

  it("overrules the judge when the quote is not in the source", () => {
    // A plausible answer produces plausible fake support consistently, so
    // sampling cannot catch this — only a substring check can.
    const j = judgement({
      claims: [
        { claim: "Starter is $29 per seat", cited_source: "S1", reasoning: "", support_quote: "$29 per seat", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("unsupported_but_plausible");
    expect(j.claims[0]!.quote_unverified).toBe(true);
  });

  it("overrules a supported verdict carrying no quote at all", () => {
    const j = judgement({
      claims: [{ claim: "x", cited_source: "S1", reasoning: "", support_quote: null, verdict: "supported" }],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("unsupported_but_plausible");
  });

  it("tolerates whitespace and case differences in a real quote", () => {
    const j = judgement({
      claims: [
        { claim: "x", cited_source: "S1", reasoning: "", support_quote: "STARTER   costs $29", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("supported");
  });

  it("drops a contradiction that is not evidenced on both sides", () => {
    const j = judgement({
      contradictions: [
        { facet: "f1", source_a: "S1", quote_a: "Starter costs $29", source_b: "S2", quote_b: "invented", kind: "substantive", reasoning: "" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(j.contradictions).toHaveLength(0);
  });
});

describe("support attribution", () => {
  const sources = [
    src({ uri: "coco://billing", path: "billing", text: "Starter costs $29 per month." }),
    src({ uri: "coco://company", path: "company", text: "All plans begin with a scoping conversation." }),
  ];
  const blinded = blindSources(sources, "seed");
  const idOf = (uri: string) => [...blinded.map.entries()].find(([, s]) => s.uri === uri)![0];

  it("credits exactly the source a verified quote came from", () => {
    const j = judgement({
      claims: [
        { claim: "x", cited_source: idOf("coco://billing"), reasoning: "", support_quote: "Starter costs $29", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(attributeSupport(j, blinded)).toEqual({ "coco://billing": 1 });
  });

  it("gives no credit to a source that was opened but supported nothing", () => {
    // This is the whole point: without it retrieval precision is always 1.0
    // and efficiency measures nothing.
    const j = judgement({
      claims: [
        { claim: "x", cited_source: idOf("coco://billing"), reasoning: "", support_quote: "Starter costs $29", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(attributeSupport(j, blinded)["coco://company"]).toBeUndefined();
  });

  it("credits where the text actually is when the judge cited the wrong source", () => {
    const j = judgement({
      claims: [
        { claim: "x", cited_source: idOf("coco://company"), reasoning: "", support_quote: "Starter costs $29", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(attributeSupport(j, blinded)).toEqual({ "coco://billing": 1 });
  });

  it("gives no credit for a claim whose quote was not found anywhere", () => {
    const j = judgement({
      claims: [
        { claim: "x", cited_source: idOf("coco://billing"), reasoning: "", support_quote: "$29 per seat", verdict: "supported" },
      ],
    });
    verifyQuotes(j, blinded);
    expect(attributeSupport(j, blinded)).toEqual({});
  });
});

describe("absence claims", () => {
  const blinded = blindSources(
    [src({ uri: "coco://faq", path: "faq", text: "title: FAQ\n\nPricing starts with a conversation." })],
    "seed",
  );
  const id = [...blinded.map.keys()][0]!;

  it("accepts an accurate claim that a source lacks a field", () => {
    // "Say who owns it, or say no owner" is what the question asked for;
    // penalising the honest answer as an invention was the rubric's bug.
    const j = judgement({
      claims: [{ claim: "The FAQ has no owner field", cited_source: id, reasoning: "", support_quote: "owner", verdict: "supported_by_absence" }],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("supported_by_absence");
    expect(attributeSupport(j, blinded)).toEqual({ "coco://faq": 1 });
  });

  it("overrules a false absence claim when the field is declared as a key", () => {
    const withOwner = blindSources([src({ uri: "coco://p", path: "p", text: "title: P\nowner: Priya\n\nbody" })], "s");
    const pid = [...withOwner.map.keys()][0]!;
    const j = judgement({
      claims: [{ claim: "P has no owner field", cited_source: pid, reasoning: "", support_quote: "owner", verdict: "supported_by_absence" }],
    });
    verifyQuotes(j, withOwner);
    expect(j.claims[0]!.verdict).toBe("contradicted");
  });

  it("does not overrule an absence claim just because the word appears in prose", () => {
    // "no owner field" is true even when the body says "the product owner
    // decides"; a substring test would flip the accurate claim to contradicted.
    const prose = blindSources([src({ uri: "coco://p", path: "p", text: "title: P\n\nThe product owner decides pricing." })], "s");
    const pid = [...prose.map.keys()][0]!;
    const j = judgement({
      claims: [{ claim: "P has no owner field", cited_source: pid, reasoning: "", support_quote: "owner", verdict: "supported_by_absence" }],
    });
    verifyQuotes(j, prose);
    expect(j.claims[0]!.verdict).toBe("supported_by_absence");
  });

  it("does not accept an absence claim that names nothing to check", () => {
    const j = judgement({
      claims: [{ claim: "Nothing is missing", cited_source: id, reasoning: "", support_quote: null, verdict: "supported_by_absence" }],
    });
    verifyQuotes(j, blinded);
    expect(j.claims[0]!.verdict).toBe("unsupported_but_plausible");
  });
});

describe("hard tokens", () => {
  it("finds prices, percentages and dates", () => {
    const tokens = extractHardTokens("It costs $299, up 12% since 2026-01-01.");
    expect(tokens).toContain("$299");
    expect(tokens).toContain("12%");
    expect(tokens).toContain("2026-01-01");
  });

  it("flags a number the sources never state", () => {
    // A paraphrase does not carry a number: this is the "$29 per seat" case,
    // caught without any judgement.
    const blinded = blindSources([src({ uri: "coco://p", path: "p", text: "Starter costs $29." })], "s");
    expect(findHardTokenMisses("Starter is $29, discounted 40% at volume.", blinded)).toEqual(["40%"]);
  });
});

describe("dimension scoring", () => {
  it("maps sub-scores onto the verbal anchors", () => {
    expect(anchorMap(1, [0.85, 0.7, 0.45, 0.2])).toBe(4);
    expect(anchorMap(0.7, [0.85, 0.7, 0.45, 0.2])).toBe(3);
    expect(anchorMap(0, [0.85, 0.7, 0.45, 0.2])).toBe(0);
  });

  it("scores a fully grounded answer 4", () => {
    const j = judgement({
      claims: [{ claim: "x", cited_source: "S1", reasoning: "", support_quote: "q", verdict: "supported" }],
    });
    expect(scoreGrounding(j, [src({})])).toBe(4);
  });

  it("punishes a plausible invention as hard as an implausible one", () => {
    const plausible = judgement({
      claims: [
        { claim: "a", cited_source: null, reasoning: "", support_quote: null, verdict: "unsupported_but_plausible" },
        { claim: "b", cited_source: null, reasoning: "", support_quote: null, verdict: "unsupported_but_plausible" },
      ],
    });
    const implausible = judgement({
      claims: plausible.claims.map((c) => ({ ...c, verdict: "unsupported_implausible" as const })),
    });
    expect(scoreGrounding(plausible, [])).toBe(scoreGrounding(implausible, []));
  });

  it("counts a cited-but-never-opened source against grounding", () => {
    const j = judgement({
      claims: [{ claim: "x", cited_source: "S1", reasoning: "", support_quote: "q", verdict: "supported" }],
    });
    expect(scoreGrounding(j, [src({ claimedOnly: true })])).toBeLessThan(4);
  });

  it("scores by rate, so three misses in twenty-three is not the same as three in three", () => {
    const many = judgement({
      claims: [
        ...Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}`, cited_source: "S1", reasoning: "", support_quote: "q", verdict: "supported" as const })),
        ...Array.from({ length: 3 }, (_, i) => ({ claim: `u${i}`, cited_source: null, reasoning: "", support_quote: null, verdict: "unsupported_but_plausible" as const })),
      ],
    });
    const few = judgement({ claims: many.claims.slice(-3) });
    expect(scoreGrounding(many, [])).toBe(3);
    expect(scoreGrounding(few, [])).toBe(1);
  });

  it("caps at 2 on a single invented number, whatever the rate", () => {
    const j = judgement({
      claims: Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}`, cited_source: "S1", reasoning: "", support_quote: "q", verdict: "supported" as const })),
      hardTokenMisses: ["$29"],
    });
    expect(scoreGrounding(j, [])).toBe(2);
  });

  it("caps at 2 on a single contradicted claim, whatever the rate", () => {
    const j = judgement({
      claims: [
        ...Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}`, cited_source: "S1", reasoning: "", support_quote: "q", verdict: "supported" as const })),
        { claim: "wrong", cited_source: "S1", reasoning: "", support_quote: "q", verdict: "contradicted" },
      ],
    });
    expect(scoreGrounding(j, [])).toBe(2);
  });

  it("treats an honest refusal as sound, not as a failure", () => {
    expect(scoreGrounding(judgement({ refused: true }), [])).toBe(3);
  });

  it("caps consistency at 2 even when the answer flags the conflict", () => {
    // The agent's poise is not what is scored — the context layer is.
    const conflict = judgement({
      contradictions: [{ facet: "f1", source_a: "S1", quote_a: "", source_b: "S2", quote_b: "", kind: "substantive", reasoning: "" }],
      answer_disclosed_conflict: true,
    });
    expect(scoreConsistency(conflict)).toBe(2);
    expect(scoreConsistency({ ...conflict, answer_disclosed_conflict: false })).toBe(1);
  });

  it("never penalises a long source, only a duplicated one", () => {
    const long = [src({ bytes: 400_000, contributed: true })];
    expect(scoreEfficiency(long, 3)).toBe(4);
  });

  it("penalises reads that supported nothing", () => {
    const wasteful = [src({ contributed: true }), ...Array.from({ length: 8 }, (_, i) => src({ uri: `coco://w${i}`, contributed: false }))];
    expect(scoreEfficiency(wasteful, 3)!).toBeLessThan(2);
  });

  it("reports efficiency as n/a rather than perfect when nothing was read", () => {
    // Otherwise an arm wins by not trying.
    expect(scoreEfficiency([], 3)).toBeNull();
  });
});

describe("automation gate", () => {
  const question: Question = {
    id: "residency",
    ask: "Where does data live?",
    mustCover: ["region"],
    weight: 1,
    expectedGap: false,
    refusalOk: false,
  };
  const perfect = {
    questionId: "residency",
    armId: "coconut",
    dimensions: { coverage: 4, grounding: 4, freshness: 4, consistency: 4, efficiency: 4 },
    composite: 4,
    caps: [],
    refused: false,
    invented: 0,
    contradictions: 0,
  };

  it("clears a well-sourced, owned, human-reviewed answer", () => {
    expect(callAutomation(perfect, question, [src({})]).verdict).toBe("automate");
  });

  it("blocks on a source no human has ever reviewed", () => {
    // It can be perfectly accurate and still be the wrong thing to paste into
    // a contract.
    const call = callAutomation(perfect, question, [src({ agentWrittenOnly: true })]);
    expect(call.verdict).toBe("with_review");
    expect(call.reasons[0]).toMatch(/no human has ever reviewed/);
  });

  it("never lets a source with unknown provenance clear the bar", () => {
    // The files arm cannot say who owns a page or when a person last checked
    // it. Passing it as "owned, human-reviewed" is the bug this guards.
    const call = callAutomation(perfect, question, [src({ connector: "files", hydration: "not_applicable", owner: null, lastHumanEdit: null })]);
    expect(call.verdict).toBe("with_review");
    expect(call.reasons[0]).toMatch(/provenance unknown/);
  });

  it("blocks on an unowned source", () => {
    expect(callAutomation(perfect, question, [src({ owner: null })]).verdict).toBe("with_review");
  });

  it("blocks outright on an invented claim", () => {
    const call = callAutomation({ ...perfect, invented: 1 }, question, [src({})]);
    expect(call.verdict).toBe("with_review");
  });

  it("blocks outright when facts are invented and facets are missing", () => {
    const call = callAutomation({ ...perfect, invented: 2, dimensions: { ...perfect.dimensions, coverage: 1 } }, question, [src({})]);
    expect(call.verdict).toBe("not_yet");
  });

  it("accepts a refusal where the role says a refusal is correct", () => {
    const refused = { ...perfect, refused: true };
    expect(callAutomation(refused, { ...question, refusalOk: true }, [src({})]).verdict).toBe("automate");
    expect(callAutomation(refused, question, [src({})]).verdict).toBe("with_review");
  });

  it("pins the checked sources with their provenance into the generated task", () => {
    const call = callAutomation(perfect, question, [src({ path: "engineering/security/residency" })]);
    const task = renderAgentTask("rfp", question, call);
    expect(task).toContain("engineering/security/residency");
    expect(task).toContain("human-edited 2026-09-01");
    expect(task).toMatch(/stop and say so rather than substituting/);
  });
});

describe("finding identity", () => {
  it("keeps a contradiction's id stable when retrieval surfaces different pages", async () => {
    // The same disagreement reached through a different page pair is the same
    // finding. Keying on pages would renumber it every run.
    const { deriveFindingsForTest } = await import("./evaluate.js");
    const base = {
      questionId: "pricing",
      armId: "coconut",
      dimensions: { coverage: 3, grounding: 3, consistency: 1 },
      composite: 2,
      caps: [],
      refused: false,
      invented: 0,
      contradictions: 1,
    };
    const cellWith = (paths: string[]) => ({
      questionId: "pricing",
      armId: "coconut",
      rep: 1,
      status: "ok" as const,
      answer: "",
      sources: paths.map((p) => src({ uri: `coco://${p}`, path: p, contributed: true })),
      usage: { costUsd: 0, durationMs: 0, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      provenance: {
        model: null,
        mcpServers: [],
        tools: [],
        memoryPaths: [],
        cwd: null,
        hookEvents: 0,
        permissionDenials: 0,
        outputTokensByModel: {},
        assistantModels: [],
        toolsCalled: [],
      },
      violations: [],
      retries: 0,
    });

    const role = { id: "sdr", title: "", brief: "", sourcePath: "", questions: [
      { id: "pricing", ask: "", mustCover: ["x"], weight: 2, expectedGap: false, refusalOk: false },
    ] };

    const a = deriveFindingsForTest(role, [base], [], [cellWith(["a/one", "b/two"])]);
    const b = deriveFindingsForTest(role, [base], [], [cellWith(["c/three", "d/four"])]);

    const idA = a.find((f) => f.kind === "resolve")?.id;
    const idB = b.find((f) => f.kind === "resolve")?.id;
    expect(idA).toBeDefined();
    expect(idA).toBe(idB);
  });
});
