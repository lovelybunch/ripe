// Role files: YAML frontmatter for the machine, markdown body for the human.
//
// The body is injected verbatim as the agent's preamble, so it must describe
// the job and nothing else — an answer or a source hint in there invalidates
// every arm at once.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Question, Role } from "./types.js";

interface RawQuestion {
  id?: unknown;
  ask?: unknown;
  must_cover?: unknown;
  weight?: unknown;
  expected_gap?: unknown;
  refusal_ok?: unknown;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits a role file into its YAML head and markdown body. */
export function splitFrontmatter(text: string): { head: string; body: string } {
  const m = FRONTMATTER.exec(text);
  if (!m) throw new Error("role file must start with a --- YAML frontmatter block");
  return { head: m[1] ?? "", body: (m[2] ?? "").trim() };
}

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}

export function parseRole(text: string, sourcePath: string): Role {
  const { head, body } = splitFrontmatter(text);
  const raw = parseYaml(head) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") fail(sourcePath, "frontmatter did not parse as a mapping");

  const id = raw["role"];
  if (typeof id !== "string" || !id.trim()) fail(sourcePath, "`role` is required");
  const title = typeof raw["title"] === "string" ? raw["title"] : id;
  const persona = typeof raw["persona"] === "string" ? raw["persona"] : undefined;

  const rawQuestions = raw["questions"];
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    fail(sourcePath, "`questions` must be a non-empty list");
  }

  const seen = new Set<string>();
  const questions: Question[] = rawQuestions.map((entry, i) => {
    const q = entry as RawQuestion;
    const qid = q.id;
    if (typeof qid !== "string" || !qid.trim()) {
      fail(sourcePath, `questions[${i}] needs a stable string \`id\``);
    }
    if (seen.has(qid)) fail(sourcePath, `duplicate question id \`${qid}\``);
    seen.add(qid);

    if (typeof q.ask !== "string" || !q.ask.trim()) {
      fail(sourcePath, `question \`${qid}\` needs an \`ask\``);
    }
    const mustCover = q.must_cover;
    if (!Array.isArray(mustCover) || mustCover.length === 0) {
      fail(sourcePath, `question \`${qid}\` needs a non-empty \`must_cover\` list`);
    }
    for (const facet of mustCover) {
      if (typeof facet !== "string" || !facet.trim()) {
        fail(sourcePath, `question \`${qid}\` has a non-string facet in \`must_cover\``);
      }
    }

    const weight = q.weight === undefined ? 1 : Number(q.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      fail(sourcePath, `question \`${qid}\` has a non-numeric \`weight\``);
    }

    return {
      id: qid,
      ask: q.ask.trim(),
      mustCover: (mustCover as string[]).map((f) => f.trim()),
      weight,
      expectedGap: q.expected_gap === true,
      refusalOk: q.refusal_ok === true,
    };
  });

  if (!body) fail(sourcePath, "role file needs a markdown body describing the job");

  return { id, title, persona, brief: body, questions, sourcePath };
}

export function loadRole(path: string): Role {
  return parseRole(readFileSync(path, "utf8"), path);
}

/**
 * The agent's preamble.
 *
 * Identical across arms in every respect that could bias a comparison — the
 * role, the job, the word cap, the citation instruction. The one thing that
 * varies is a factual statement of which tools this arm actually has, because
 * without it the no-sources arm role-plays a tool call and stops, which
 * cripples the control and manufactures the delta. Stating the precondition
 * truthfully is not a nudge; withholding it is.
 */
export function buildPreamble(role: Role, wordCap: number, hasTools: boolean): string {
  const persona = role.persona ? `\nYou are: ${role.persona}\n` : "\n";

  const sourcing = hasTools
    ? `You have tools for looking things up. Use them: answer from what you can
actually retrieve, and cite the exact path, filename or URL you read each fact
from.`
    : `You have no tools and cannot look anything up. Answer from your own
knowledge, and say plainly that you are doing so. Do not describe or simulate
looking anything up — there is nothing to look in.`;

  return `You are answering a question in the role of ${role.title}.
${persona}
${role.brief}

How to answer:
- Keep the answer under ${wordCap} words.
- ${sourcing}
- If you cannot establish something, say so plainly. "I could not determine X
  from what is available to me" is a correct and useful answer. Do not guess to
  fill a gap: a plausible guess is still invented, and plausible inventions are
  the dangerous ones.`;
}
