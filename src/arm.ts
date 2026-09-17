// Arms are source configurations. Four are built in so a new user configures
// nothing; `arms.yaml` only exists for custom connectors.

import type { Arm } from "./types.js";

/** The read-only slice of the Coconut MCP surface. Writes are never exposed
 *  to an arm — an eval must not be able to change the thing it measures. */
export const COCO_READ_TOOLS = [
  "context_whoami",
  "context_space_list",
  "context_search_shared_pages",
  "context_get_shared_page",
  "context_list_shared_pages",
  "context_recent_shared_pages",
  "context_get_page_metadata",
  "context_query_pages_by_metadata",
  "context_list_metadata_keys",
  "context_get_page_links",
  "context_get_shared_page_revisions",
  "get_context_by_url",
].map((t) => `mcp__coco__${t}`);

export interface BuiltinArmOptions {
  /** Domain the `web` arm is confined to. */
  domain?: string;
  /** Folder the `files` arm reads. */
  filesDir?: string;
  baseUrl?: string;
}

export function builtinArms(opts: BuiltinArmOptions = {}): Record<string, Arm> {
  const domain = opts.domain ?? "coconut.dev";
  const baseUrl = opts.baseUrl ?? process.env.COCO_BASE_URL ?? "https://api.coconut.md";

  return {
    none: {
      id: "none",
      label: "No sources",
      rationale:
        "The floor. Also the prior-leakage measurement: anything this arm answers well was already in the model.",
      tools: [],
      allowedTools: [],
      mcpServers: {},
      addDirs: [],
      requiresEnv: [],
      control: true,
    },
    web: {
      id: "web",
      label: "Public website only",
      rationale: "The 'you already have this for free' comparison.",
      tools: ["WebSearch", "WebFetch"],
      // Confined to the company's own site: this arm is "what our public
      // website already tells an agent", not "what the whole internet says".
      allowedTools: ["WebSearch", `WebFetch(domain:${domain})`, `WebFetch(domain:www.${domain})`],
      mcpServers: {},
      addDirs: [],
      requiresEnv: [],
    },
    files: {
      id: "files",
      label: "A folder of documents",
      rationale:
        "The ceiling control: the same content, flat, with grep. If Coconut cannot beat this, the delta is about having content rather than about the product.",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
      mcpServers: {},
      addDirs: opts.filesDir ? [opts.filesDir] : [],
      requiresEnv: [],
    },
    coconut: {
      id: "coconut",
      label: "Coconut Context",
      rationale: "The arm being measured.",
      tools: [],
      allowedTools: COCO_READ_TOOLS,
      mcpServers: {
        coco: {
          type: "http",
          url: `${baseUrl.replace(/\/$/, "")}/mcp`,
          // A multi-tenant deployment refuses an agent key that arrives without
          // its org ("missing_org_context"); a human OAuth session carries the
          // org implicitly, which is why the CLI works without it. Empty
          // headers are dropped at materialization, so this is inert on a
          // single-tenant API.
          headers: { Authorization: "Bearer ${COCO_AGENT_KEY}", "x-coco-org-slug": "${COCO_ORG_SLUG}" },
        },
      },
      addDirs: [],
      requiresEnv: ["COCO_AGENT_KEY", "COCO_ORG_SLUG"],
    },
  };
}

export function resolveArms(ids: string[], opts: BuiltinArmOptions = {}): Arm[] {
  const all = builtinArms(opts);
  const missing = ids.filter((id) => !all[id]);
  if (missing.length) {
    throw new Error(
      `unknown arm(s): ${missing.join(", ")}. Available: ${Object.keys(all).join(", ")}`,
    );
  }
  return ids.map((id) => all[id]!);
}

/** Arms whose required env is absent, with the variable that is missing. */
/** Env an arm may use if present, but can run without. */
const OPTIONAL_ENV = new Set(["COCO_ORG_SLUG"]);

export function unmetRequirements(arms: Arm[]): Array<{ arm: string; missing: string[] }> {
  return arms
    .map((arm) => ({
      arm: arm.id,
      missing: arm.requiresEnv.filter((k) => !OPTIONAL_ENV.has(k) && !process.env[k]),
    }))
    .filter((r) => r.missing.length > 0);
}
