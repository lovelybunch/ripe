# ripeness

*Knock before you open it.*

Repo `ripe`, package `ripeness`, command `ripe` — one project.

Pick a role. Toggle sources on and off. Find out what you can safely automate.

This measures what an AI agent can actually do with your shared context — by
asking the same real questions with each source switched on and off, one at a
time — and then tells you three things:

1. **What you can automate today**, with the agent task ready to run.
2. **What's blocking the rest**, naming the exact page and the smallest fix.
3. **Where you stand**, including cost and speed per answer.

The score is not the point. The automatable set is the point, and the fix list
is how it grows.

## Install

```bash
npx ripeness doctor          # no install — or:
npm i -g ripeness            # gives you `ripe`

cp "$(npm root -g)/ripeness/.env.example" .env   # add COCO_AGENT_KEY and COCO_ORG_SLUG
ripe skills                  # where the two Claude skills are, and how to add them
```

From source: `git clone https://github.com/lovelybunch/ripe.git && cd ripe && pnpm install && pnpm build && npm link`.

Two skills ship in `skills/`: **`context-readiness`** (Claude Desktop — one
conversation, no setup, a self-graded map) and **`ripe`** (wraps this CLI
conversationally). Both read the same role files, so their numbers line up.

## Three steps

```bash
# 0. Can it run? And what does the corpus look like, for free?
ripe doctor
ripe audit --spaces company,products --against loops/context-hygiene-report

# 1. What are we asking, and what will it cost?
ripe roles --role sdr

# 2. Run it
ripe corpus --spaces company,products,playbooks --out corpora/files
ripe run --role sdr --arms none,web,files,coconut --files-dir "$PWD/corpora/files"

# 3. Act
cat runs/*/scorecard.md
```

Non-technical path: use the bundled `ripe` skill instead, which wraps
this and runs it conversationally.

## The arms

| Arm | What the agent gets | Why it's there |
|---|---|---|
| `none` | nothing | the floor — and the measurement of what the model already knew |
| `web` | your public site | the "you already have this for free" comparison |
| `files` | the same content, flat, with grep | **the honest control** |
| `coconut` | Coconut Context over MCP | the arm being measured |

`files` is the one that matters most. If Coconut cannot beat the same content in
a folder, the gain is about *having* the content, not about the product. Any
report worth publishing includes `web` and `files`.

## What makes a source trustworthy

For an accuracy-critical job — a security questionnaire, a diligence request —
being current is not enough. The registry records, per source:

- `last updated` and `version`
- **`last human edit`** — the date a person last stood behind it
- **`updated by`** — and whether that was a person or an agent
- `owner`, review date, and the editor's own note on what changed

Two flags block automation outright: **`agent-only`** (no human has ever touched
this page) and **`human-stale`** (an agent refreshed it; no person has reviewed
it inside its window). A page that looks fresh and has never been read by a
human is exactly the page you must not paste into a contract.

This is also the crispest answer to "why not just a folder in Drive": a folder
cannot tell you who last touched a file, whether they were a person, or what
they changed.

## Honesty controls

Built in, because this measures a product built by the same team:

- **The control is not crippled.** Every arm gets the same role, the same word
  cap, the same model and the same instruction to cite. The no-sources arm is
  told plainly that it has none and may answer from its own knowledge.
- **Isolation is verified, not assumed.** Every run reads back off the
  transcript what the arm was *actually* given — servers, tools, memory paths,
  hook events, denied tool calls — and fails the run on a mismatch. This is not
  paranoia: `--strict-mcp-config` alone leaves hooks able to inject context.
- **A canary page** holds a fact only the Coconut arm can reach. If another arm
  answers it, the run is void by construction.
- **Prior knowledge is measured.** Any question the no-sources arm answers well
  was already in the model, and is excluded from the headline delta.
- **Failures survive the average.** Uncited claims, contradictions and the
  single worst question are reported next to the mean, never inside it.
- **A null result is publishable.** If Coconut ties with a flat folder on
  coverage and only wins on freshness and provenance, that is the finding, and
  it is a better claim than a flat win because it survives scrutiny.

## Layout

```
roles/          question sets — YAML frontmatter, plain-English facets
skills/         the conversational front door
config.ts       every tunable constant, hashed into each report
src/            the harness (~16 files)
runs/           output. gitignored: transcripts contain private page bodies
```

## What a run tells you

```
## 1 · What you can automate today
   3/12 jobs clear the bar  →  ready-to-run agent tasks, sources pinned

## 2 · What's blocking the rest
   findings ranked by measured impact, each naming the page, the smallest
   fix, and which jobs it unblocks

## 3 · Where you stand
   composite + the five dimensions, per arm, with cost and speed per answer
   and the failures reported beside the mean rather than inside it
```

## Status

Working end to end against real Coconut: MCP retrieval with provenance (version,
owner, last human edit, whether an agent or a person made the last change),
per-cell isolation checks and a canary, the blind judge with quote verification,
five dimensions, the automation gate, generated agent tasks, the free `audit`,
and judge validation tooling. Grounding is scored as a rate with hard floors.

Not yet: publishing scorecards back into Coconut, `--n` medians with
win/loss/tie, and connector arms (Drive, Slack, Notion) over MCP — for now,
export a folder and point the `files` arm at it.
