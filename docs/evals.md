# How good is your context, really?

Every team building with AI has the same unspoken question: *is what we have
good enough to hand to an agent?* Most answer it by feel. These two tools answer
it by looking — and then tell you what to fix first.

Both start from the same idea. Take a real job — a sales rep on day one, someone
answering a security questionnaire — and ask its real questions of your actual
context. Not "is our documentation good", but *what does it cost, who do we sell
to, where does customer data live, who are our subprocessors*. Then check every
answer against the source it came from.

---

## Start here — Context Readiness

**A Claude Desktop skill. One conversation. Nothing to install.**

Connect what you already have — Google Drive, Notion, Slack, your website — and
ask Claude to run **Context Readiness**. It answers one question (*which role?*),
looks through what's connected, and hands back a one-page report:

- **A score, 0–100**, with a tier: Cold Start · Foundations · Working Draft · Ready
- **Two live tests** — a one-pager drafted from your context with every fact
  marked `[cited]` or `[INVENTED]`, and ten questions a new hire would ask,
  each marked *cited*, *uncertain* or *can't answer*
- **What to fix first**, naming the actual documents — "the March deck and the
  website disagree on pricing" — and the smallest fix for each
- **A plan**: the five to seven pages that would establish one current version
  of the essentials, where each one's content comes from, and who should own it

Read-only by default. It reads what is connected, and asks before it writes
anything back. It never invents a source into the score. And it's honest about
what it is: a map, self-graded in one conversation — a good place to start, not
a benchmark.

> *Install:* add the `context-readiness` skill to Claude Desktop, connect a tool
> or two, and say **"how ready is my context for sales work?"**

---

## Go deeper — `ripe`

**A command-line eval. Repeatable, separately judged, built to be argued with.**

*You knock a coconut before you open it. This is the knock.*

`ripe` runs the same questions, but instead of one conversation grading itself, it
runs each question under several **source configurations** — no sources at all,
your public website, your documents as a plain folder, and Coconut — with the
same model, the same instructions and the same word limit. A separate judge
scores every answer blind, and a mechanical check confirms every quoted source
actually says what the answer claims.

You get three things, in this order:

1. **What you can automate today.** Which jobs cleared a strict bar — every
   fact traceable, no contradictions, every source owned and reviewed by a
   person recently — with the agent task ready to run.
2. **What's blocking the rest.** Findings ranked by what they actually cost you,
   each naming the page, the smallest fix, and which jobs it unblocks.
3. **Where you stand.** Five dimensions per source configuration — coverage,
   grounding, freshness, consistency, efficiency — alongside **cost and time per
   answer**, so you can see the same answer getting cheaper and more accurate as
   the context improves.

### Why the folder matters

One of the source configurations is deliberately unflattering: your Coconut
content exported to a plain folder and read with `grep`. If Coconut can't beat
the same content in a folder, the gain was about *having* the content, not about
the product — and the report will say so. What a folder can't do is tell you who
last touched a page, whether that was a person or an agent, or when a human last
reviewed it. Those columns stay blank for the folder and fill in for Coconut, and
they're what the automation bar is built on.

### Built to be doubted

- Every run reads back off the transcript what each configuration was actually
  given — servers, tools, memory, hooks — and fails if anything leaked.
- A **canary page** holds a fact that exists in exactly one place. If any
  configuration that shouldn't reach it answers, the run is void.
- The judge never sees which configuration produced an answer, and its verdicts
  are overruled when a quoted source doesn't contain the quote.
- A refusal is a graded outcome. A broken connection is not a verdict on your
  content. A single confidently wrong answer outweighs a good average — and is
  reported that way.
- A null result is publishable. If a folder ties with Coconut, that's the finding.

### Quickstart

```bash
npm i -g ripeness        # or prefix each command with: npx ripeness

ripe doctor                                          # can it run?
ripe audit --spaces company,products                 # free: corpus health in seconds
ripe corpus --spaces company,products --out corpora/files
ripe run --role sdr --arms none,web,files,coconut --files-dir "$PWD/corpora/files"
```

A full run is around **$4 and ten minutes**. `--questions pricing,icp` narrows
it; `--scope products` keeps the search small; `--fast` is a cheap plumbing
check, not a number to show anyone.

The Coconut configuration needs an agent key and your org slug in a gitignored
`.env` — `ripe doctor` tells you exactly what's missing. Everything else runs
without them.

---

## Roles

| role | who it's for | the questions |
|---|---|---|
| **`sdr`** | sales development | what we sell, to whom, at what price, against whom, with what proof, where data lives, how to get started |
| **`rfp-ddq`** | GRC, security, compliance | data residency, access control, subprocessors, certifications, incident response, AI and data use |

Both skills read the same role files, and the question ids match — so a
readiness map on Tuesday and a `ripe` measurement on Thursday are two rows of the
same table. Adding a role is one markdown file: plain-English questions, each
with the two to five facts an answer must cover.

---

## Which one?

|  | Context Readiness | `ripe` |
|---|---|---|
| where it runs | Claude Desktop | your terminal |
| setup | none | clone, install, one key |
| takes | ~10 minutes | ~10 minutes per run |
| costs | nothing extra | ~$4 per full run |
| who grades | the same conversation | a separate, blind judge + mechanical checks |
| compares sources? | no — maps what you have | yes — nothing vs web vs folder vs Coconut |
| repeatable? | roughly | exactly; findings keep stable ids across runs |
| best for | a first look; a prospect's baseline | tracking improvement; deciding what to automate; the cost case |

Start with the first. When you want to know whether it's *actually* getting
better — and what it's costing — move to the second.
