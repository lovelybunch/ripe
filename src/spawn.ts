// Runs one cell: build an isolated scratch dir, spawn `claude -p`, parse the
// stream-json transcript.
//
// We shell out rather than use the Agent SDK on purpose. The flags that make a
// no-sources arm genuinely have no sources are CLI-level, the subprocess
// boundary *is* the isolation boundary (its own env, cwd and config dir), and
// the artifact worth publishing for reproducibility is a literal command line.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIMITS } from "./config.js";
import type { Arm, FailureClass, Provenance, Usage } from "./types.js";

export interface StreamEvent {
  type: string;
  subtype?: string;
  [k: string]: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  turn: number;
  result: string | null;
  isError: boolean;
}

export interface CellRun {
  status: FailureClass;
  answer: string;
  toolCalls: ToolCall[];
  usage: Usage;
  provenance: Provenance;
  /** The exact command line, for the report and for pasting into a shell. */
  argv: string[];
  events: StreamEvent[];
}

const EMPTY_USAGE: Usage = {
  costUsd: 0,
  durationMs: 0,
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
};

/**
 * A scratch island for one cell: a generated MCP config, an explicitly empty
 * settings file, and an empty cwd so there is no CLAUDE.md anywhere up the tree.
 */
function materialize(arm: Arm): { dir: string; cwd: string; mcpPath: string; settingsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), `ripe-${arm.id}-`));
  const cwd = join(dir, "cwd");
  mkdirSync(cwd);

  const mcpPath = join(dir, "mcp.json");
  // Expand ${VAR} ourselves: the config file is the only place a secret lands,
  // and it is written 0600 inside a private temp dir.
  const servers = JSON.parse(
    JSON.stringify(arm.mcpServers).replace(/\$\{(\w+)\}/g, (_, k: string) => process.env[k] ?? ""),
  ) as Record<string, { headers?: Record<string, string> }>;
  // A header whose variable was unset would be sent as an empty string;
  // drop it instead, so an optional header is genuinely optional.
  for (const server of Object.values(servers)) {
    if (!server.headers) continue;
    for (const [k, v] of Object.entries(server.headers)) if (!v) delete server.headers[k];
  }
  writeFileSync(mcpPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });

  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, "{}");

  return { dir, cwd, mcpPath, settingsPath };
}

export function buildArgv(
  arm: Arm,
  prompt: string,
  preamble: string,
  model: string,
  paths: { mcpPath: string; settingsPath: string },
): string[] {
  const argv = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
    // Only servers from our file. Necessary but, as probing showed, not
    // sufficient on its own — hence the three flags that follow.
    "--strict-mcp-config",
    "--mcp-config",
    paths.mcpPath,
    // Ignore user, project and local settings...
    "--setting-sources",
    "",
    // ...and stand on an explicitly empty settings island instead.
    "--settings",
    paths.settingsPath,
    // No skills: a skill in scope is context the arm was not supposed to have.
    "--disable-slash-commands",
    "--no-session-persistence",
    "--permission-mode",
    "bypassPermissions",
    "--permission-prompts",
    "none",
    "--model",
    model,
    "--max-turns",
    String(LIMITS.maxTurns),
    "--max-budget-usd",
    String(LIMITS.maxBudgetUsd),
    "--system-prompt-snapshot",
    "off",
    "--append-system-prompt",
    preamble,
    // Empty string is meaningful: no built-in tools at all.
    "--tools",
    arm.tools.join(","),
  ];

  if (arm.allowedTools.length) argv.push("--allowedTools", ...arm.allowedTools);
  for (const dir of arm.addDirs) argv.push("--add-dir", dir);
  return argv;
}

/**
 * Env is allowlisted, not inherited: an arm gets PATH, HOME and the specific
 * variables it declares, and nothing else. A stray API key in the parent
 * environment is a source the arm was never meant to have.
 *
 * HOME has to stay, because that is where `claude` finds its own credential.
 * That means an arm which can shell out — one with Bash — could read the
 * user's stored Coconut OAuth token at ~/.config/coco/config.json, so for
 * those arms only, XDG_CONFIG_HOME is redirected at a scratch directory.
 * None of the four built-in arms has Bash; this guards the ones that will.
 */
function childEnv(arm: Arm, scratch: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    USER: process.env.USER,
  };
  if (arm.tools.includes("Bash")) {
    env.XDG_CONFIG_HOME = join(scratch, "config");
  }
  for (const key of arm.requiresEnv) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function collectProvenance(events: StreamEvent[]): Provenance {
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  const usage = (result?.["modelUsage"] ?? {}) as Record<string, Record<string, unknown>>;
  const denials = result?.["permission_denials"];

  const outputTokensByModel: Record<string, number> = {};
  for (const [model, stats] of Object.entries(usage)) {
    outputTokensByModel[model] = Number(stats?.["outputTokens"] ?? 0);
  }
  const assistantModels = [
    ...new Set(
      events
        .filter((e) => e.type === "assistant")
        .map((e) => (e["message"] as Record<string, unknown> | undefined)?.["model"])
        .filter((m): m is string => typeof m === "string"),
    ),
  ];

  const toolsCalled = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => ((e["message"] as Record<string, unknown> | undefined)?.["content"] as Array<Record<string, unknown>>) ?? [])
    .filter((b) => b["type"] === "tool_use")
    .map((b) => String(b["name"]));

  return {
    model: (init?.["model"] as string) ?? null,
    mcpServers: normalizeServers(init?.["mcp_servers"]),
    tools: Array.isArray(init?.["tools"]) ? (init!["tools"] as string[]) : [],
    memoryPaths: Array.isArray(init?.["memory_paths"]) ? (init!["memory_paths"] as string[]) : [],
    cwd: (init?.["cwd"] as string) ?? null,
    hookEvents: events.filter(
      (e) => e.type === "system" && typeof e.subtype === "string" && e.subtype.startsWith("hook_"),
    ).length,
    permissionDenials: Array.isArray(denials) ? denials.length : 0,
    outputTokensByModel,
    assistantModels,
    toolsCalled,
  };
}

/** `mcp_servers` arrives as either names or `{name, status}` objects. */
function normalizeServers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) =>
    typeof s === "string" ? s : String((s as Record<string, unknown>)?.["name"] ?? "?"),
  );
}

function collectToolCalls(events: StreamEvent[]): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  let turn = 0;

  for (const event of events) {
    if (event.type === "assistant") {
      turn += 1;
      const content = (event["message"] as Record<string, unknown> | undefined)?.["content"];
      if (!Array.isArray(content)) continue;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] !== "tool_use") continue;
        const id = String(block["id"]);
        calls.set(id, {
          id,
          name: String(block["name"]),
          input: (block["input"] as Record<string, unknown>) ?? {},
          turn,
          result: null,
          isError: false,
        });
      }
    } else if (event.type === "user") {
      const content = (event["message"] as Record<string, unknown> | undefined)?.["content"];
      if (!Array.isArray(content)) continue;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] !== "tool_result") continue;
        const call = calls.get(String(block["tool_use_id"]));
        if (!call) continue;
        call.result = flattenResult(block["content"]);
        call.isError = block["is_error"] === true;
      }
    }
  }
  return [...calls.values()];
}

/** Tool results arrive as a string or as an array of content blocks. */
function flattenResult(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return raw == null ? "" : JSON.stringify(raw);
  return raw
    .map((b) => {
      const block = b as Record<string, unknown>;
      return typeof block["text"] === "string" ? block["text"] : JSON.stringify(block);
    })
    .join("\n");
}

function collectUsage(events: StreamEvent[]): Usage {
  const result = events.find((e) => e.type === "result");
  if (!result) return EMPTY_USAGE;
  const u = (result["usage"] ?? {}) as Record<string, number>;
  return {
    costUsd: Number(result["total_cost_usd"] ?? 0),
    durationMs: Number(result["duration_ms"] ?? 0),
    turns: Number(result["num_turns"] ?? 0),
    inputTokens: Number(u["input_tokens"] ?? 0),
    outputTokens: Number(u["output_tokens"] ?? 0),
    cacheReadTokens: Number(u["cache_read_input_tokens"] ?? 0),
  };
}

function classify(
  events: StreamEvent[],
  exitCode: number | null,
  timedOut: boolean,
  toolCalls: ToolCall[],
  hasMcp: boolean,
): FailureClass {
  if (timedOut) return "timeout";
  const result = events.find((e) => e.type === "result");
  if (!result) return exitCode === 0 ? "empty_answer" : "crash";

  // An arm whose every MCP call errored never had its source. Scoring that
  // answer as a refusal would blame the corpus for a broken connection —
  // exactly the plumbing-as-model-failure mistake the report must never make.
  if (hasMcp) {
    const mcp = toolCalls.filter((c) => c.name.startsWith("mcp__"));
    if (mcp.length > 0 && mcp.every((c) => c.isError)) return "mcp_unavailable";
  }

  const subtype = String(result["subtype"] ?? "");
  const terminal = String(result["terminal_reason"] ?? "");
  if (subtype.includes("budget") || terminal.includes("budget")) return "budget_exceeded";
  if (result["is_error"] === true) {
    const status = result["api_error_status"];
    if (status === 401 || status === 403) return "auth_error";
    if (typeof status === "number") return "api_error";
    return "crash";
  }
  if (!String(result["result"] ?? "").trim()) return "empty_answer";
  return "ok";
}

/** Parses one NDJSON line, tolerating the occasional non-JSON line on stdout. */
function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== "{") return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

export interface RunCellOptions {
  arm: Arm;
  prompt: string;
  preamble: string;
  model: string;
  timeoutMs?: number;
  /** Injected in tests so the parser can be exercised without spending money. */
  claudeBin?: string;
}

export async function runCell(opts: RunCellOptions): Promise<CellRun> {
  const paths = materialize(opts.arm);
  const argv = buildArgv(opts.arm, opts.prompt, opts.preamble, opts.model, paths);
  const events: StreamEvent[] = [];
  let timedOut = false;

  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn(opts.claudeBin ?? "claude", argv, {
      cwd: paths.cwd,
      env: childEnv(opts.arm, paths.dir),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A process that ignores SIGTERM still has to go; the partial transcript
      // we already have is a result in its own right.
      setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, opts.timeoutMs ?? LIMITS.timeoutMs);

    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseLine(line);
        if (event) events.push(event);
      }
    });
    child.stderr.resume();

    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const event = parseLine(buffer);
      if (event) events.push(event);
      resolve(code);
    });
  });

  const result = events.find((e) => e.type === "result");
  const toolCalls = collectToolCalls(events);
  return {
    status: classify(events, exitCode, timedOut, toolCalls, Object.keys(opts.arm.mcpServers).length > 0),
    answer: String(result?.["result"] ?? "").trim(),
    toolCalls,
    usage: collectUsage(events),
    provenance: collectProvenance(events),
    argv,
    events,
  };
}
