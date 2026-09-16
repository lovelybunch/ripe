import { describe, expect, it } from "vitest";
import { findDuplicates, parseLoopTable } from "./audit.js";

/** Seeded pseudo-random prose. A linear formula here cycles the same word
 *  sequence for every seed, which makes "distinct" pages near-duplicates and
 *  the test lies. */
const lorem = (seed: number, words: number): string => {
  let h = (seed * 2654435761) >>> 0;
  return Array.from({ length: words }, () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    return `w${h % 2000}`;
  }).join(" ");
};

describe("duplicate detection", () => {
  it("flags two near-identical pages", () => {
    const base = lorem(1, 300);
    const pairs = findDuplicates([
      { path: "a", content: base },
      { path: "b", content: base + " and one more sentence here" },
    ]);
    expect(pairs[0]?.kind).toBe("duplicate");
  });

  it("catches a summary fully contained in a longer page, which Jaccard alone would miss", () => {
    // Asymmetric duplication is the commonest real pattern in a context layer.
    const summary = lorem(2, 150);
    const detail = summary + " " + lorem(3, 1200);
    const pairs = findDuplicates([
      { path: "summary", content: summary },
      { path: "detail", content: detail },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.overlap).toBeGreaterThan(0.9);
  });

  it("does not flag distinct pages on a shared topic", () => {
    const pairs = findDuplicates([
      { path: "a", content: lorem(4, 300) },
      { path: "b", content: lorem(5, 300) },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("ignores boilerplate shared by most pages, so a website is not all one page", () => {
    const chrome = "Home · Pricing · Docs · Sign in · © Coconut all rights reserved";
    const pages = Array.from({ length: 6 }, (_, i) => ({
      path: `p${i}`,
      content: `${chrome}\n${lorem(10 + i, 200)}\n${chrome}`,
    }));
    expect(findDuplicates(pages)).toHaveLength(0);
  });
});

describe("loop table parsing", () => {
  const md = `
## Open findings

| id | raised | finding | pages | smallest fix | state | notes |
|---|---|---|---|---|---|---|
| L-0016 | 2026-08-19 | \`status\` key holds both boolean and string | 72 pages | Standardize | open | x |
| L-0007 | 2026-08-08 | \`design/motion\` empty since 2026-06-24 | design/motion | Fill or archive | open | y |
| F-0023 | 2026-09-01 | metadata disagrees | company/competitors, company/decisions | Align | open | z |

Some prose after.
`;

  it("extracts ids, findings and page paths from the loops' table", () => {
    const rows = parseLoopTable(md);
    expect(rows.map((r) => r.id)).toEqual(["L-0016", "L-0007", "F-0023"]);
    expect(rows[1]!.pages).toEqual(["design/motion"]);
    expect(rows[2]!.pages).toEqual(["company/competitors", "company/decisions"]);
  });

  it("does not mistake a page count for a page path", () => {
    expect(parseLoopTable(md)[0]!.pages).toEqual([]);
  });
});
