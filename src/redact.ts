// Transcripts contain full page bodies from private spaces, and an MCP config
// carries a bearer token. Nothing reaches disk without passing through here.

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[A-Za-z0-9_-]+/g, "sk-ant-[REDACTED]"],
  [/(Authorization"?\s*[:=]\s*"?)(Bearer\s+)?[A-Za-z0-9._~+/-]{16,}/gi, "$1[REDACTED]"],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[REDACTED_JWT]"],
];

/** Also scrubs the literal value of every secret this process holds, so a
 *  token echoed back inside a tool result cannot survive into a run artifact. */
const SECRET_ENV = ["COCO_AGENT_KEY", "COCO_API_KEY", "ANTHROPIC_API_KEY"];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  for (const key of SECRET_ENV) {
    const value = process.env[key];
    if (value && value.length >= 8) out = out.split(value).join(`[REDACTED_${key}]`);
  }
  return out;
}

/** True when a redaction pattern still matches — publish must refuse on this. */
export function hasSecrets(text: string): boolean {
  return PATTERNS.some(([p]) => new RegExp(p.source, p.flags.replace("g", "")).test(text));
}

/**
 * Source bodies are held in memory for judging, never written to disk: a run
 * artifact would otherwise contain full page text from private spaces.
 */
export function stripSourceText<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val: unknown) => (key === "text" ? undefined : val)),
  ) as T;
}
