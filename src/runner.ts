// Orchestrates the matrix of (question × arm × rep).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANARY_PROMPT,
  CANARY_QUESTION_ID,
  checkFileScope,
  checkProvenance,
  isFatal,
} from "./assert.js";
import { redact } from "./redact.js";
import { LIMITS } from "./config.js";
import { buildPreamble } from "./role.js";
import { runCell } from "./spawn.js";
import { analyseCitations, buildRegistry } from "./sources.js";
import { hydrateRegistry, type HydrateStats } from "./hydrate.js";
import type { Arm, Cell, FailureClass, Role } from "./types.js";

/** Whether this arm can look anything up at all. */
const armHasTools = (arm: Arm): boolean =>
  arm.tools.length > 0 || Object.keys(arm.mcpServers).length > 0;

/** These are worth another attempt. A timeout or a broken arm is a result. */
const RETRYABLE: ReadonlySet<FailureClass> = new Set([
  "api_error",
  "mcp_unavailable",
  "crash",
]);

export interface RunOptions {
  /** Where to persist raw transcripts. Omit to keep them in memory only. */
  transcriptDir?: string;
  /** Appended to every role question alike — never to the canary, which by
   *  design lives outside any scope a run would name. */
  scopeHint?: string;
  role: Role;
  arms: Arm[];
  reps: number;
  model: string;
  includeCanary: boolean;
  concurrency?: number;
  budgetUsd?: number;
  hydrate?: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface RunResult {
  cells: Cell[];
  hydrateStats: HydrateStats | null;
  /** One paste-able command line per arm, for reproducibility. */
  argvByArm: Record<string, string[]>;
  abortedForBudget: boolean;
}

interface Job {
  rep: number;
  questionId: string;
  prompt: string;
  arm: Arm;
}

/**
 * Job order is rep → question → arm, so every arm answers a given question
 * within seconds of the others. Arm-major order lets corpus drift and
 * time-of-day API variation confound with whichever arm ran first; this is
 * cheap insurance and almost never done.
 */
function buildJobs(opts: RunOptions): Job[] {
  const jobs: Job[] = [];
  const questions = opts.role.questions.map((q) => ({
    id: q.id,
    prompt: opts.scopeHint ? `${q.ask}\n\n${opts.scopeHint}` : q.ask,
  }));
  if (opts.includeCanary) {
    questions.push({ id: CANARY_QUESTION_ID, prompt: CANARY_PROMPT });
  }

  for (let rep = 1; rep <= opts.reps; rep += 1) {
    for (const question of questions) {
      for (const arm of opts.arms) {
        jobs.push({ rep, questionId: question.id, prompt: question.prompt, arm });
      }
    }
  }
  return jobs;
}

async function executeJob(job: Job, opts: RunOptions): Promise<Cell> {
  const preamble = buildPreamble(opts.role, LIMITS.answerWordCap, armHasTools(job.arm));
  let attempt = 0;
  let run = await runCell({ arm: job.arm, prompt: job.prompt, preamble, model: opts.model });

  while (RETRYABLE.has(run.status) && attempt < LIMITS.retries) {
    attempt += 1;
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500));
    run = await runCell({ arm: job.arm, prompt: job.prompt, preamble, model: opts.model });
  }

  if (opts.transcriptDir) {
    const dir = join(opts.transcriptDir, job.arm.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${job.questionId}-${job.rep}.jsonl`),
      redact(run.events.map((e) => JSON.stringify(e)).join("\n")) + "\n",
    );
  }

  const registry = buildRegistry(run.toolCalls);
  analyseCitations(run.answer, registry);
  const violations = [
    ...checkProvenance(job.arm, opts.model, run.provenance),
    ...checkFileScope(job.arm, registry),
  ];

  return {
    questionId: job.questionId,
    armId: job.arm.id,
    rep: job.rep,
    status: isFatal(violations) ? "hermeticity_violation" : run.status,
    answer: run.answer,
    sources: registry,
    usage: run.usage,
    provenance: run.provenance,
    violations: violations.map((v) => `${v.code}: ${v.detail}`),
    retries: attempt,
  };
}

/** Bounded-concurrency pool. Small enough to read, which is the point. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function run(opts: RunOptions): Promise<RunResult> {
  const jobs = buildJobs(opts);
  const cells: Cell[] = [];
  const argvByArm: Record<string, string[]> = {};
  let spent = 0;
  let abortedForBudget = false;
  let done = 0;

  // Record one representative command line per arm before running anything, so
  // the report can show exactly what each arm could see even if a cell fails.
  for (const arm of opts.arms) {
    const { buildArgv } = await import("./spawn.js");
    const preamble = buildPreamble(opts.role, LIMITS.answerWordCap, armHasTools(arm));
    argvByArm[arm.id] = buildArgv(arm, "<question>", preamble, opts.model, {
      mcpPath: "<scratch>/mcp.json",
      settingsPath: "<scratch>/settings.json",
    });
  }

  await pool(jobs, opts.concurrency ?? LIMITS.concurrency, async (job) => {
    if (abortedForBudget) return;
    const cell = await executeJob(job, opts);
    cells.push(cell);
    spent += cell.usage.costUsd;
    done += 1;
    opts.onProgress?.(done, jobs.length, `${job.questionId} · ${job.arm.id}`);

    if (opts.budgetUsd != null && spent >= opts.budgetUsd) {
      // Stop cleanly and report what we have, rather than silently overspending.
      abortedForBudget = true;
    }
  });

  let hydrateStats: HydrateStats | null = null;
  if (opts.hydrate !== false) {
    const all = cells.flatMap((c) => c.sources);
    hydrateStats = await hydrateRegistry(all);
  }

  return { cells, hydrateStats, argvByArm, abortedForBudget };
}
