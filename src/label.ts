// Judge validation. Without it, every score the tool produces is unfalsified:
// nobody — including us — has any evidence the judge agrees with a person.
//
// Two commands. `label` exports the judged cells as a form a human fills in
// twenty minutes. `agreement` reads the filled form back and reports the two
// numbers that matter: how close the judge is to a person overall, and — the
// one that matters more — whether it is systematically kinder to one arm.

import { readFileSync } from "node:fs";
import type { Judgement } from "./judge.js";
import type { QuestionScore } from "./score.js";
import type { Cell, Role } from "./types.js";

export interface LabelRow {
  armId: string;
  questionId: string;
  judgeCoverage: number;
  judgeGrounding: number;
}

export function renderLabelSheet(
  role: Role,
  cells: Cell[],
  scores: QuestionScore[],
  judgements: Record<string, Pick<Judgement, "claims" | "facets">>,
): string {
  const out: string[] = [];
  out.push(`# Labelling sheet — ${role.title}`);
  out.push("");
  out.push(
    "For each answer, give your own 0–4 for **coverage** (were the required facets answered?) and **grounding** (is every claim traceable to a source that was actually opened?). Use the same scale as the judge:",
  );
  out.push("");
  out.push("> 0 nothing · 1 fragments · 2 conflicting or stale · 3 accurate and current · 4 one current version, owned and kept current");
  out.push("");
  out.push(
    "Fill the two `human:` fields on each card. Leave the judge's verdicts alone; they are there so you can see where you disagree, not to anchor you — **decide your score before reading them.**",
  );
  out.push("");

  // Shuffle so labellers do not see all of one arm together and start
  // grading the arm rather than the answer.
  const ordered = [...scores].sort((a, b) => hash(a.armId + a.questionId) - hash(b.armId + b.questionId));

  ordered.forEach((score, i) => {
    const cell = cells.find((c) => c.armId === score.armId && c.questionId === score.questionId);
    const question = role.questions.find((q) => q.id === score.questionId);
    const judgement = judgements[`${score.armId}::${score.questionId}`];
    if (!cell || !question) return;

    out.push("---");
    out.push("");
    out.push(`## ${i + 1}. \`${score.armId}::${score.questionId}\``);
    out.push("");
    out.push(`**Question:** ${question.ask.replace(/\s+/g, " ").trim()}`);
    out.push("");
    out.push("**Must cover:**");
    for (const facet of question.mustCover) out.push(`- ${facet}`);
    out.push("");
    out.push("**Answer:**");
    out.push("");
    out.push("> " + cell.answer.replace(/\n/g, "\n> "));
    out.push("");
    const opened = cell.sources.filter((s) => s.access === "read" && !s.isError);
    out.push(`**Sources actually opened (${opened.length}):** ${opened.map((s) => `\`${s.path.replace(/^.*corpora\/[^/]+\//, "")}\``).join(", ") || "_none_"}`);
    out.push("");
    out.push("```");
    out.push(`human: coverage=   grounding=      # 0–4 each. Fill these in first.`);
    out.push("```");
    out.push("");
    out.push("<details><summary>Judge's view (read after scoring)</summary>");
    out.push("");
    out.push(`judge: coverage=${(score.dimensions.coverage ?? 0).toFixed(1)} grounding=${(score.dimensions.grounding ?? 0).toFixed(1)}`);
    out.push("");
    if (judgement) {
      for (const f of judgement.facets) out.push(`- facet ${f.id}: **${f.verdict}** — ${f.reasoning}`);
      out.push("");
      for (const c of judgement.claims.filter((c) => c.verdict !== "not_a_factual_claim")) {
        out.push(`- claim: "${c.claim}" → **${c.verdict}**${c.quote_unverified ? " _(quote not found; downgraded by the harness)_" : ""}`);
      }
    }
    out.push("");
    out.push("</details>");
    out.push("");
  });

  return out.join("\n");
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export interface Agreement {
  n: number;
  /** Mean |judge − human|, per dimension. Under 0.5 is good; over 1 is a rubric problem. */
  meanAbsError: { coverage: number; grounding: number };
  /** Share of cells where judge and human land on the same integer. */
  exactMatch: { coverage: number; grounding: number };
  /**
   * Mean signed error (judge − human) per arm. This is the number that matters
   * most: a judge running +0.4 on one arm and −0.1 on another is producing
   * exactly the flattering-but-false result the framework exists to prevent.
   */
  biasByArm: Record<string, { coverage: number; grounding: number; n: number }>;
  /** Cells where judge and human differ by two or more points — rubric bugs to look at. */
  disputes: Array<{ key: string; dimension: string; judge: number; human: number }>;
}

/** Reads `human: coverage=3 grounding=2` lines back out of a filled sheet. */
export function parseLabelSheet(markdown: string): Map<string, { coverage: number; grounding: number }> {
  const out = new Map<string, { coverage: number; grounding: number }>();
  let current: string | null = null;
  for (const line of markdown.split("\n")) {
    const head = /^## \d+\. `([^`]+)`/.exec(line);
    if (head) current = head[1]!;
    const m = /^human:\s*coverage=\s*(\d(?:\.\d)?)\s+grounding=\s*(\d(?:\.\d)?)/.exec(line.trim());
    if (m && current) out.set(current, { coverage: Number(m[1]), grounding: Number(m[2]) });
  }
  return out;
}

export function computeAgreement(
  scores: QuestionScore[],
  humans: Map<string, { coverage: number; grounding: number }>,
): Agreement {
  const pairs = scores
    .map((s) => ({ s, h: humans.get(`${s.armId}::${s.questionId}`) }))
    .filter((p): p is { s: QuestionScore; h: { coverage: number; grounding: number } } => !!p.h);

  const n = pairs.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const dims = ["coverage", "grounding"] as const;

  const meanAbsError = { coverage: 0, grounding: 0 };
  const exactMatch = { coverage: 0, grounding: 0 };
  const disputes: Agreement["disputes"] = [];
  const byArm = new Map<string, { coverage: number[]; grounding: number[] }>();

  for (const d of dims) {
    const errs = pairs.map(({ s, h }) => (s.dimensions[d] ?? 0) - h[d]);
    meanAbsError[d] = mean(errs.map(Math.abs));
    exactMatch[d] = mean(pairs.map(({ s, h }) => (Math.round(s.dimensions[d] ?? 0) === Math.round(h[d]) ? 1 : 0)));
    pairs.forEach(({ s, h }, i) => {
      if (Math.abs(errs[i]!) >= 2) {
        disputes.push({ key: `${s.armId}::${s.questionId}`, dimension: d, judge: s.dimensions[d] ?? 0, human: h[d] });
      }
      const bucket = byArm.get(s.armId) ?? { coverage: [], grounding: [] };
      bucket[d].push(errs[i]!);
      byArm.set(s.armId, bucket);
    });
  }

  const biasByArm: Agreement["biasByArm"] = {};
  for (const [arm, errs] of byArm) {
    biasByArm[arm] = { coverage: mean(errs.coverage), grounding: mean(errs.grounding), n: errs.coverage.length };
  }

  return { n, meanAbsError, exactMatch, biasByArm, disputes };
}

export function renderAgreement(a: Agreement): string {
  const f = (x: number) => (x >= 0 ? "+" : "") + x.toFixed(2);
  const out: string[] = [];
  out.push(`# Judge agreement — ${a.n} labelled cells`);
  out.push("");
  if (!a.n) return out.concat("_No `human:` lines were filled in._").join("\n");

  out.push(`| dimension | mean abs error | exact match |`);
  out.push(`|:--|--:|--:|`);
  out.push(`| coverage | ${a.meanAbsError.coverage.toFixed(2)} | ${Math.round(a.exactMatch.coverage * 100)}% |`);
  out.push(`| grounding | ${a.meanAbsError.grounding.toFixed(2)} | ${Math.round(a.exactMatch.grounding * 100)}% |`);
  out.push("");
  out.push("_Under 0.5 mean error is a judge you can trust; over 1.0 is a rubric to fix._");
  out.push("");
  out.push("## Bias by arm (judge − human)");
  out.push("");
  out.push("| arm | coverage | grounding | n |");
  out.push("|:--|--:|--:|--:|");
  for (const [arm, b] of Object.entries(a.biasByArm)) {
    out.push(`| ${arm} | ${f(b.coverage)} | ${f(b.grounding)} | ${b.n} |`);
  }
  out.push("");
  const spread = Object.values(a.biasByArm);
  const maxGap = spread.length > 1
    ? Math.max(...["coverage", "grounding"].map((d) => {
        const vals = spread.map((b) => b[d as "coverage" | "grounding"]);
        return Math.max(...vals) - Math.min(...vals);
      }))
    : 0;
  out.push(
    maxGap > 0.3
      ? `**⚠️ The judge is ${maxGap.toFixed(2)} points kinder to one arm than another.** Do not publish a headline delta until this is understood — it is the flattering-but-false result the framework exists to prevent.`
      : "_Bias spread across arms is within 0.3 points. The judge is not favouring an arm._",
  );
  out.push("");
  if (a.disputes.length) {
    out.push("## Disputes (≥2 points apart)");
    out.push("");
    for (const d of a.disputes) out.push(`- \`${d.key}\` ${d.dimension}: judge ${d.judge.toFixed(1)}, human ${d.human}`);
    out.push("");
    out.push("_Each of these is either a labelling slip or a rubric bug. Look at them before trusting anything else._");
  }
  return out.join("\n");
}
