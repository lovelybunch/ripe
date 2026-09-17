#!/usr/bin/env node
// The engineer's front door. The skill in `skills/ripeness/` wraps this,
// so there is one implementation and the numbers cannot diverge.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtinArms, resolveArms, unmetRequirements } from "./arm.js";
import { audit } from "./audit.js";
import { renderAudit } from "./audit-report.js";
import { buildCorpus } from "./corpus.js";
import { CANARY_METADATA_KEY, CANARY_PAGE, canaryVerdict } from "./assert.js";
import { PRESETS, type PresetName } from "./config.js";
import { evaluate } from "./evaluate.js";
import { computeAgreement, parseLabelSheet, renderAgreement, renderLabelSheet } from "./label.js";
import { renderScorecard } from "./report.js";
import { loadRole } from "./role.js";
import { run } from "./runner.js";
import { redact, stripSourceText } from "./redact.js";

const EXIT = { ok: 0, gate: 1, usage: 2, unreachable: 3, auth: 4, notFound: 5, internal: 9 } as const;

/**
 * Loads `.env` from the working directory, without overriding anything already
 * in the environment. Keeps the agent key out of shell history and out of
 * chat, and lets two shells (a terminal and a tool runner) agree on it.
 * `.env` is gitignored; `.env.example` documents the keys.
 */
function loadDotEnv(): void {
  const path = resolve(".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined && value) process.env[key] = value;
  }
}

interface Flags {
  _: string[];
  [k: string]: string | boolean | string[] | undefined;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2);
    if (!key) continue;
    if (inline !== undefined) {
      flags[key] = inline;
    } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
      flags[key] = argv[i + 1]!;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function usage(): void {
  const arms = Object.keys(builtinArms()).join(", ");
  console.log(`ripeness (ripe) — knock before you open it. Pick a role, toggle sources, find out what you can safely automate.

Usage:  ripe <command>

  ripe doctor                         check credentials, tooling and isolation
  ripe audit      --spaces a,b        free corpus health check, no agent calls
                 [--against loops/context-hygiene-report] [--include-reserved]
  ripe roles      [--role sdr]        the bundled roles and their questions
                 [--check]           verify readiness-skill question ids exist in ripe's roles
  ripe corpus     --spaces a,b        build the files arm's folder  [--out corpora/files]
  ripe run        --role sdr          the eval  [--arms ${arms}]
                 [--questions a,b] [--scope products,playbooks] [--n 1]
                 [--fast | --thorough] [--budget-usd 5] [--domain example.com]
                 [--files-dir corpora/files] [--judge-model m] [--no-judge] [--out runs/]
  ripe skills                        where the bundled Claude skills are, and how to install them
  ripe label      --run runs/<dir>    export judged cells for a person to score
  ripe agreement  --run runs/<dir>    how far the judge is from that person, per arm

Defaults: --arms none,coconut --n 1. Reads COCO_AGENT_KEY and COCO_ORG_SLUG from .env.`);
}

function loadRoleByName(nameOrPath: string): ReturnType<typeof loadRole> {
  const candidates = nameOrPath.endsWith(".md")
    ? [resolve(nameOrPath)]
    : [resolve(`roles/${nameOrPath}.md`), resolve(import.meta.dirname, `../roles/${nameOrPath}.md`)];
  for (const candidate of candidates) {
    try {
      return loadRole(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`no role file found for "${nameOrPath}" (looked in ${candidates.join(", ")})`);
}

/** Reads the canary token with the operator's own credential, so the harness
 *  can tell whether an arm that should not know it answered anyway. */
function readCanaryToken(): string | null {
  try {
    const out = execFileSync("coconut", ["meta", "get", CANARY_PAGE, "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(out) as { metadata?: Record<string, { value?: unknown }> };
    const entry = parsed.metadata?.[CANARY_METADATA_KEY];
    const value = entry && typeof entry === "object" ? entry.value : entry;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function cmdRun(flags: Flags): Promise<number> {
  const roleName = str(flags["role"]) ?? "sdr";
  const role = loadRoleByName(roleName);

  // Narrowing the question set is how you iterate on the harness without
  // paying for the full matrix each time.
  const only = str(flags["questions"]);
  if (only) {
    const wanted = new Set(only.split(",").map((s) => s.trim()));
    const unknown = [...wanted].filter((id) => !role.questions.some((q) => q.id === id));
    if (unknown.length) {
      console.error(`error: no such question(s): ${unknown.join(", ")}`);
      return EXIT.usage;
    }
    role.questions = role.questions.filter((q) => wanted.has(q.id));
  }

  const armIds = (str(flags["arms"]) ?? "none,coconut").split(",").map((s) => s.trim()).filter(Boolean);
  const arms = resolveArms(armIds, {
    filesDir: str(flags["files-dir"]),
    domain: str(flags["domain"]),
  });

  const unmet = unmetRequirements(arms);
  if (unmet.length) {
    for (const { arm, missing } of unmet) {
      console.error(`error: arm "${arm}" needs ${missing.join(", ")} in the environment.`);
    }
    console.error("\nGet an agent key from /admin/agent-keys, then: export COCO_AGENT_KEY=…");
    return EXIT.auth;
  }

  const preset: PresetName = flags["thorough"] ? "thorough" : flags["fast"] ? "fast" : "default";
  const reps = flags["n"] ? Number(str(flags["n"])) : PRESETS[preset].reps;
  if (!Number.isInteger(reps) || reps < 1) {
    console.error("error: --n must be a positive integer");
    return EXIT.usage;
  }

  const model = str(flags["model"]) ?? PRESETS[preset].answer;

  // A scope hint keeps a smoke test cheap. It is appended to the brief for
  // every arm alike, so it cannot bias the comparison; for arms with nothing
  // to search it is simply inert.
  // Applied to the role's questions only. Putting it in the brief also fenced
  // off the canary page, and the agent dutifully refused to look for it.
  const scope = str(flags["scope"]);
  const budgetUsd = flags["budget-usd"] ? Number(str(flags["budget-usd"])) : undefined;
  const canaryToken = readCanaryToken();
  const includeCanary = canaryToken != null && arms.length > 1;

  const cellCount = (role.questions.length + (includeCanary ? 1 : 0)) * arms.length * reps;
  console.error(
    `Running ${role.questions.length} questions × ${arms.length} source configuration(s) × n=${reps} = ${cellCount} cells`,
  );
  console.error(`  model: ${model}${budgetUsd ? ` · budget: $${budgetUsd}` : ""}`);
  if (!includeCanary) {
    console.error(
      `  note: no canary token at ${CANARY_PAGE}, so isolation is asserted from the transcript only`,
    );
  }
  console.error("");

  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${role.id}`;
  const outDir = join(str(flags["out"]) ?? "runs", runId);
  mkdirSync(outDir, { recursive: true });

  const result = await run({
    role,
    arms,
    reps,
    model,
    includeCanary,
    budgetUsd,
    transcriptDir: join(outDir, "transcripts"),
    scopeHint: scope ? `Look only in the ${scope} space(s); do not search elsewhere.` : undefined,
    onProgress: (done, total, label) => {
      process.stderr.write(`\r  [${String(done).padStart(3)}/${total}] ${label.padEnd(40)}`);
    },
  });
  process.stderr.write("\n\n");

  const verdict = canaryVerdict(result.cells, canaryToken);

  // Judging is a separate pass so it can later be re-run over stored
  // transcripts without paying for the agent runs again.
  const judgeModel = str(flags["judge-model"]) ?? PRESETS[preset].judge;
  let evaluation;
  if (flags["no-judge"] !== true) {
    if (judgeModel === model) {
      console.error(
        `error: judge model must differ from the answering model (both ${model}); pass --judge-model`,
      );
      return EXIT.usage;
    }
    console.error(`Judging with ${judgeModel}…`);
    evaluation = await evaluate({
      role,
      cells: result.cells,
      judgeModel,
      onProgress: (d, t) => process.stderr.write(`\r  [${String(d).padStart(3)}/${t}] judging`),
    });
    process.stderr.write("\n\n");
  }

  const scorecard = renderScorecard(role, result, { model, reps, startedAt }, evaluation);

  writeFileSync(join(outDir, "scorecard.md"), scorecard + "\n");
  writeFileSync(
    join(outDir, "cells.json"),
    redact(
      JSON.stringify(
        stripSourceText({
          runId,
          role: role.id,
          model,
          judgeModel,
          reps,
          cells: result.cells,
          scores: evaluation?.scores,
          judgements: evaluation ? Object.fromEntries(evaluation.judgements) : undefined,
          findings: evaluation?.findings,
          automation: evaluation?.calls,
        }),
        null,
        2,
      ),
    ),
  );

  console.log(scorecard);
  console.error(`\nWritten to ${outDir}/scorecard.md`);

  if (verdict.unreachable) {
    console.error(
      `\nnote: the Coconut arm could not read ${CANARY_PAGE} — the agent key cannot see that space. Isolation of the other arms still held; grant the key access to the space (or move the canary to one it can read) to complete the check.`,
    );
  } else if (verdict.confirmed) {
    console.error("\ncanary: confirmed — only the Coconut arm returned the token.");
  }

  if (!verdict.ok) {
    console.error(
      `\nFAILED: the canary token leaked into arm(s) ${verdict.leaked.join(", ")}. These arms saw more than they were given, so this run is void.`,
    );
    return EXIT.gate;
  }

  const leaks = result.cells.filter((c) => c.status === "hermeticity_violation");
  if (leaks.length) {
    console.error(`\nFAILED: ${leaks.length} cell(s) failed isolation checks. See "leaks" in the report.`);
    return EXIT.gate;
  }
  return EXIT.ok;
}

interface StoredRun {
  role: string;
  cells: Parameters<typeof renderLabelSheet>[1];
  scores?: Parameters<typeof renderLabelSheet>[2];
  judgements?: Parameters<typeof renderLabelSheet>[3];
}

function loadRun(flags: Flags): { dir: string; run: StoredRun } | null {
  const dir = str(flags["run"]);
  if (!dir) {
    console.error("error: --run <runs/…> is required");
    return null;
  }
  const run = JSON.parse(readFileSync(join(dir, "cells.json"), "utf8")) as StoredRun;
  if (!run.scores?.length) {
    console.error("error: that run has no judged scores (was it run with --no-judge?)");
    return null;
  }
  return { dir, run };
}

function cmdLabel(flags: Flags): number {
  const loaded = loadRun(flags);
  if (!loaded) return EXIT.usage;
  const role = loadRoleByName(loaded.run.role);
  const sheet = renderLabelSheet(role, loaded.run.cells, loaded.run.scores!, loaded.run.judgements ?? {});
  const out = join(loaded.dir, "labels.md");
  writeFileSync(out, sheet + "\n");
  console.error(`Wrote ${loaded.run.scores!.length} cards to ${out}. Fill in the \`human:\` lines, then:\n  ripe agreement --run ${loaded.dir} --labels ${out}`);
  return EXIT.ok;
}

function cmdAgreement(flags: Flags): number {
  const loaded = loadRun(flags);
  if (!loaded) return EXIT.usage;
  const labels = str(flags["labels"]) ?? join(loaded.dir, "labels.md");
  const humans = parseLabelSheet(readFileSync(labels, "utf8"));
  const agreement = computeAgreement(loaded.run.scores!, humans);
  const report = renderAgreement(agreement);
  writeFileSync(join(loaded.dir, "agreement.md"), report + "\n");
  console.log(report);
  return EXIT.ok;
}

async function cmdAudit(flags: Flags): Promise<number> {
  const spaces = str(flags["spaces"])?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!spaces?.length) {
    console.error("error: --spaces is required, e.g. --spaces company,products");
    return EXIT.usage;
  }
  const startedAt = new Date();
  const result = await audit({
    spaces,
    includeReserved: flags["include-reserved"] === true,
    against: str(flags["against"]),
  });
  const report = renderAudit(result, startedAt);

  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-audit`;
  const outDir = join(str(flags["out"]) ?? "runs", runId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "audit.md"), report + "\n");
  writeFileSync(
    join(outDir, "audit.json"),
    JSON.stringify({ ...result, pages: result.pages.map(({ metadata: _m, ...p }) => p) }, null, 2),
  );
  console.log(report);
  console.error(`\nWritten to ${outDir}/audit.md`);
  return EXIT.ok;
}

async function cmdCorpus(flags: Flags): Promise<number> {
  const spaces = str(flags["spaces"])?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!spaces?.length) {
    console.error("error: --spaces is required, e.g. --spaces company,products");
    return EXIT.usage;
  }
  const out = str(flags["out"]) ?? "corpora/files";
  const stats = await buildCorpus(spaces, out, { includeReserved: flags["include-reserved"] === true });
  console.error(
    `Wrote ${stats.written} page(s) (${(stats.bytes / 1024).toFixed(0)} KB) from ${stats.spaces.join(", ")} to ${out}/` +
      (stats.skipped ? `, skipping ${stats.skipped} agent/run record(s)` : ""),
  );
  return EXIT.ok;
}

function cmdDoctor(): number {
  const checks: Array<[string, () => string]> = [
    ["claude CLI", () => execFileSync("claude", ["--version"], { encoding: "utf8" }).trim()],
    ["coconut CLI", () => execFileSync("coconut", ["--version"], { encoding: "utf8" }).trim()],
    [
      "coconut auth",
      () => {
        const out = execFileSync("coconut", ["whoami", "--json"], { encoding: "utf8" });
        const parsed = JSON.parse(out) as { email?: string; name?: string };
        return parsed.email ?? parsed.name ?? "authenticated";
      },
    ],
    ["COCO_AGENT_KEY", () => (process.env["COCO_AGENT_KEY"] ? "set" : "MISSING — the coconut arm cannot run")],
    ["COCO_ORG_SLUG", () => (process.env["COCO_ORG_SLUG"] ? process.env["COCO_ORG_SLUG"]! : "unset — fine on single-tenant; multi-tenant APIs refuse the key without it")],
    ["canary page", () => (readCanaryToken() ? "present" : `MISSING — create ${CANARY_PAGE}`)],
  ];

  let failed = 0;
  for (const [name, probe] of checks) {
    try {
      const value = probe();
      const bad = value.startsWith("MISSING");
      if (bad) failed += 1;
      console.log(`${bad ? "✗" : "✓"} ${name.padEnd(16)} ${value}`);
    } catch (err) {
      failed += 1;
      console.log(`✗ ${name.padEnd(16)} ${(err as Error).message.split("\n")[0]}`);
    }
  }
  console.log(
    failed
      ? `\n${failed} check(s) need attention. \`ripe run --arms none,web,files\` works without an agent key.`
      : "\nReady.",
  );
  return failed ? EXIT.gate : EXIT.ok;
}

/**
 * The skills ship inside the package, which is useless unless a user can find
 * them. Print where they are and the two install paths.
 */
function cmdSkills(): number {
  const dir = resolve(import.meta.dirname, "../skills");
  console.log(`Bundled skills live at:\n  ${dir}\n`);
  console.log(`Claude Code (this machine):\n  cp -r ${dir}/context-readiness ~/.claude/skills/\n  cp -r ${dir}/ripeness ~/.claude/skills/\n`);
  console.log(`Claude Desktop:\n  Settings → Skills → Add, and point it at the same two folders.\n`);
  console.log(`Claude.ai / Desktop, one click (Settings → Skills → Add → upload):\n  https://cdn.jsdelivr.net/npm/ripeness/packages/context-readiness.skill\n  https://cdn.jsdelivr.net/npm/ripeness/packages/ripeness.skill\n`);
  console.log(`context-readiness  one conversation, no setup — start here\nripeness           wraps this CLI conversationally — go deeper`);
  return EXIT.ok;
}

/**
 * The parity contract between the two tools: every question id a Context
 * Readiness role cites must exist in the matching ripe role, so a map and a
 * measurement of the same team line up. The two files are deliberately
 * different shapes — this is the one thing they must agree on, so it is a
 * test rather than a promise.
 */
function checkReadinessParity(): number {
  const ripeDir = resolve(import.meta.dirname, "../roles");
  const readyDir = resolve(import.meta.dirname, "../skills/context-readiness/references/roles");
  let problems = 0;
  for (const file of readdirSync(readyDir).filter((f) => f.endsWith(".md"))) {
    const id = file.replace(/\.md$/, "");
    const cited = [...readFileSync(join(readyDir, file), "utf8").matchAll(/`\[([a-z0-9-]+)\]`/g)].map((m) => m[1]!);
    let known: Set<string>;
    try {
      known = new Set(loadRole(join(ripeDir, file)).questions.map((q) => q.id));
    } catch {
      console.log(`✗ ${id.padEnd(12)} no matching ripe role roles/${file}`);
      problems += 1;
      continue;
    }
    const missing = [...new Set(cited)].filter((c) => !known.has(c));
    if (missing.length) {
      problems += 1;
      console.log(`✗ ${id.padEnd(12)} cites ids ripe does not have: ${missing.join(", ")}`);
    } else {
      console.log(`✓ ${id.padEnd(12)} ${new Set(cited).size} ids, all present in ripe`);
    }
  }
  console.log(problems ? `\n${problems} role(s) out of parity.` : "\nAll readiness roles line up with ripe.");
  return problems ? EXIT.gate : EXIT.ok;
}

function cmdRoles(flags: Flags): number {
  if (flags["check"] === true) return checkReadinessParity();
  const name = str(flags["role"]);
  const rolesDir = resolve(import.meta.dirname, "../roles");
  const names = name
    ? [name]
    : readdirSync(rolesDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
  for (const n of names) {
    const role = loadRoleByName(n);
    console.log(`${role.id} — ${role.title}`);
    if (role.persona) console.log(`  for: ${role.persona}`);
    for (const q of role.questions) {
      console.log(`  · ${q.id}${q.expectedGap ? " (expected gap)" : ""} — ${q.ask.replace(/\s+/g, " ").slice(0, 88)}`);
      for (const facet of q.mustCover) console.log(`      - ${facet}`);
    }
  }
  return EXIT.ok;
}

async function main(): Promise<number> {
  loadDotEnv();
  const flags = parseArgs(process.argv.slice(2));
  const command = flags._[0];

  if (flags["version"] || flags["v"]) {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as { version: string };
    console.log(pkg.version);
    return EXIT.ok;
  }

  if (!command || flags["help"] || flags["h"]) {
    usage();
    return command ? EXIT.ok : EXIT.usage;
  }

  switch (command) {
    case "run":
      return cmdRun(flags);
    case "audit":
      return cmdAudit(flags);
    case "label":
      return cmdLabel(flags);
    case "agreement":
      return cmdAgreement(flags);
    case "corpus":
      return cmdCorpus(flags);
    case "doctor":
      return cmdDoctor();
    case "roles":
      return cmdRoles(flags);
    case "skills":
      return cmdSkills();
    default:
      console.error(`unknown command: ${command}\n`);
      usage();
      return EXIT.usage;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`error: ${(err as Error).message}`);
    process.exit(EXIT.internal);
  });
