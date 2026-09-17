// Reads back what the arm was actually given, off the transcript, rather than
// trusting the config that was meant to give it.
//
// This exists because probing showed `--strict-mcp-config` alone is not a clean
// baseline: hook events still fired and injected plugin and skill text. An
// unverified "no sources" arm silently has sources, and every delta measured
// against it is wrong by an unknown amount.

import type { Arm, Cell, Provenance, SourceRecord } from "./types.js";

export interface Violation {
  code: string;
  detail: string;
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");

export function checkProvenance(arm: Arm, model: string, prov: Provenance): Violation[] {
  const out: Violation[] = [];

  const expectedServers = Object.keys(arm.mcpServers);
  if (!sameSet(prov.mcpServers, expectedServers)) {
    out.push({
      code: "mcp_mismatch",
      detail: `expected servers [${expectedServers.join(", ")}], transcript reported [${prov.mcpServers.join(", ")}]`,
    });
  }

  // `init.tools` lists built-ins AND every tool the MCP server advertises —
  // including writes the allowlist forbids. Advertised is not available:
  // `--allowedTools` governs what can be called, not what is listed. So the
  // built-in check ignores `mcp__*` entries, and the MCP check below asks the
  // question that matters: was anything outside the allowlist actually called?
  const builtins = prov.tools.filter((t) => !t.startsWith("mcp__"));
  if (arm.tools.length === 0 && builtins.length > 0) {
    out.push({
      code: "tools_leaked",
      detail: `arm declares no built-in tools, transcript reported [${builtins.join(", ")}]`,
    });
  }

  if (arm.allowedTools.length) {
    const allowed = new Set(arm.allowedTools.map((t) => t.replace(/\(.*$/, "")));
    const stray = prov.toolsCalled.filter((t) => !allowed.has(t) && !arm.tools.includes(t));
    if (stray.length) {
      out.push({
        code: "tool_outside_allowlist",
        detail: `called ${[...new Set(stray)].join(", ")}, which the arm does not allow`,
      });
    }
  }

  if (prov.memoryPaths.length > 0) {
    out.push({
      code: "memory_leaked",
      detail: `CLAUDE.md/memory in scope: ${prov.memoryPaths.join(", ")}`,
    });
  }

  if (prov.hookEvents > 0) {
    out.push({
      code: "hooks_fired",
      detail: `${prov.hookEvents} hook event(s) fired; hooks can inject context this arm was not given`,
    });
  }

  if (prov.permissionDenials > 0) {
    // A denial means the arm was crippled by the harness, not that the source
    // was weak. Scoring it as a weak source is how you libel a connector.
    out.push({
      code: "permission_denied",
      detail: `${prov.permissionDenials} tool call(s) denied; the arm did not get the tools it was configured with`,
    });
  }

  if (prov.model && prov.model !== model) {
    out.push({ code: "model_mismatch", detail: `pinned ${model}, session reported ${prov.model}` });
  }

  // A pinned model id that is not enabled can silently fall back to the org
  // default, attributing one model's answers to another. The test is which
  // model authored the assistant turns. Token share is the wrong test: WebFetch
  // summarises fetched pages with a small model, and a one-word canary answer
  // is outweighed by routine side-work — both looked like fallbacks and voided
  // clean runs.
  const others = prov.assistantModels.filter((m) => m !== model);
  if (others.length) {
    out.push({
      code: "model_fallback",
      detail: `pinned ${model}, but assistant turns were written by ${others.join(", ")}`,
    });
  }

  return out;
}

/**
 * Did the arm read anything outside the directories it was given?
 *
 * `--add-dir` plus an empty cwd is the intended fence, and in practice a read
 * outside it comes back "file does not exist" — but that is the sandbox being
 * helpful, not a guarantee. Checking the registry against the arm's own
 * declaration makes the fence something we verify rather than assume.
 */
export function checkFileScope(arm: Arm, sources: SourceRecord[]): Violation[] {
  const allowed = arm.addDirs.map((d) => d.replace(/\/$/, ""));
  const strays = sources
    .filter((s) => s.connector === "files" && s.access === "read" && !s.isError)
    .filter((s) => !allowed.some((dir) => s.path.startsWith(`${dir}/`)))
    .map((s) => s.path);

  if (!strays.length) return [];
  return [
    {
      code: "file_scope_escape",
      detail: `read ${strays.length} file(s) outside ${allowed.join(", ") || "(no allowed dirs)"}: ${strays.slice(0, 3).join(", ")}`,
    },
  ];
}

/** Violations that invalidate a cell rather than merely annotate it. */
const FATAL = new Set([
  "mcp_mismatch",
  "tools_leaked",
  "tool_outside_allowlist",
  "memory_leaked",
  "model_mismatch",
  "model_fallback",
  "file_scope_escape",
]);

export function isFatal(violations: Violation[]): boolean {
  return violations.some((v) => FATAL.has(v.code));
}

// ------------------------------------------------------------- the canary

/**
 * A fact that exists in exactly one place: a page only the Coconut arm can
 * reach. If a no-sources arm answers it, the isolation is broken and the whole
 * run is void — which is a far more legible integrity check than any assertion
 * on a config file, because it tests the thing we actually care about.
 */
export const CANARY_QUESTION_ID = "__canary";
export const CANARY_PAGE = "evals/fixtures/canary";
export const CANARY_METADATA_KEY = "eval-canary-token";

export const CANARY_PROMPT = `What is the value of the metadata key \`${CANARY_METADATA_KEY}\` on the page \`${CANARY_PAGE}\`? Reply with the token only, or the single word "unknown" if you cannot look it up.`;

export interface CanaryVerdict {
  ok: boolean;
  leaked: string[];
  /** The Coconut arm could not read the canary page at all — usually the
   *  agent key lacks access to the space it lives in. The negative half of
   *  the check (no other arm answered) still holds; the positive half does not. */
  unreachable: boolean;
  /** The Coconut arm returned the token, proving it can reach the page. */
  confirmed: boolean;
}

export function canaryVerdict(cells: Cell[], token: string | null): CanaryVerdict {
  if (!token) return { ok: true, leaked: [], unreachable: false, confirmed: false };
  const needle = token.toLowerCase();
  const canaries = cells.filter((c) => c.questionId === CANARY_QUESTION_ID);
  const leaked = canaries
    .filter((c) => c.armId !== "coconut" && c.answer.toLowerCase().includes(needle))
    .map((c) => c.armId);
  const coco = canaries.find((c) => c.armId === "coconut");
  const confirmed = !!coco && coco.answer.toLowerCase().includes(needle);
  const unreachable = !!coco && !confirmed && coco.sources.some((s) => s.isError);
  return { ok: leaked.length === 0, leaked, unreachable, confirmed };
}
