// Materializes the `files` arm's corpus: the same Coconut content, flattened
// to markdown on disk.
//
// This arm is the ceiling control. If Coconut cannot beat the same content in
// a folder with grep, the delta is about having content rather than about the
// product — so the export has to be a fair one: same pages, same bodies,
// frontmatter preserved where it exists. What a folder *cannot* carry is
// revision history, so `last human edit` and `updated by` are simply absent,
// and that absence is the finding.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { AUDIT_EXCLUDE } from "./config.js";

const exec = promisify(execFile);

interface ExportPage {
  path: string;
  title?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  updatedAt?: string;
  version?: number;
}

export interface CorpusStats {
  spaces: string[];
  written: number;
  skipped: number;
  bytes: number;
}

export async function buildCorpus(
  spaces: string[],
  outDir: string,
  opts: { includeReserved?: boolean } = {},
): Promise<CorpusStats> {
  const stats: CorpusStats = { spaces: [], written: 0, skipped: 0, bytes: 0 };

  for (const space of spaces) {
    const { stdout } = await exec("coconut", ["spaces", "export", space, "--json"], {
      maxBuffer: 256 * 1024 * 1024,
    });
    const bundle = JSON.parse(stdout) as { space?: { slug?: string }; pages?: ExportPage[] };
    const slug = bundle.space?.slug ?? space;
    const pages = bundle.pages ?? [];
    stats.spaces.push(space);

    for (const page of pages) {
      // Export paths are space-relative; everything else in Coconut addresses
      // pages as `space/path`. Re-prefix so the folder mirrors the real paths —
      // otherwise two spaces silently overwrite each other's pages, and the
      // files arm is not comparing the same corpus at all.
      const canonical = `${slug}/${page.path}`;

      // Agent run records are bookkeeping, not context. Auditing them as "the
      // sales context" is how you get a garbage answer from a good corpus.
      if (!opts.includeReserved && AUDIT_EXCLUDE.some((re) => re.test(`/${canonical}`))) {
        stats.skipped += 1;
        continue;
      }
      const file = join(outDir, `${canonical}.md`);
      mkdirSync(dirname(file), { recursive: true });

      const head = { title: page.title, ...(page.frontmatter ?? {}) };
      const frontmatter = Object.entries(head)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join("\n");
      const body = `---\n${frontmatter}\n---\n\n${page.content ?? ""}`;

      writeFileSync(file, body);
      stats.written += 1;
      stats.bytes += body.length;
    }
  }

  return stats;
}
