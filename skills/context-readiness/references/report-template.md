# Report format

About one page before the detail. Write findings in the reader's own material —
"the March deck and the website disagree on pricing" — never "documentation is
inconsistent". Keep finding numbers stable across re-runs so progress is visible.
Findings and the plan come first; the inventory and the scores are detail.

To hold that length: in "What you have", list only the sources that **changed a
score**, and summarise the rest in one line beneath the table ("six further
connectors were checked and hold nothing role-relevant"). A full inventory of
everything you touched is a log, not a finding.

```markdown
# Context Readiness — <Company> — <Role>
<date> · run <n>

## tl;dr

- **<Tier> — <score>/100**
- Live test 1: **<n>/6 facts had to be invented**
- Live test 2: **<n>/10 answerable with a source**
- <The three findings that matter most, one line each, naming the actual documents>
- <The single fastest fix — usually a decision, not a document>

## What to fix first

| # | Finding | Smallest fix | Unblocks |
|---|---|---|---|
<five at most, ordered by consequence; stable numbers>

## Plan

**This week — one current version of the essentials**

| Page | Content comes from | Owner |
|---|---|---|
<5–7 rows; source is scrape / extract / interview / decide>

**Next — keep it current:** <the feeds to connect>

**To ask or decide:** <interview questions and owner decisions, verbatim, ready to use>

## What you have

| Source | Status | What's there | Fresh? |
|---|---|---|---|

<Two or three sentences on the shape: where the good material is, what is connected but empty, what is rich but flowing nowhere.>

## Scores

| Dimension | 0–4 | Why (with source) | Reaches, if the plan item lands |
|---|---|---|---|
<six rows>

## Couldn't check

<Two groups, kept apart. **Needed sign-in or approval:** with what each might add.
**Connected but not loaded in this session:** listed by name, since the next run may
reach them. Then anything else excluded. Never guessed into the score.>

## The two tests (detail)

<Live test 1, each slot [cited: …], [cited: self-marketing], [CONFLICTED: A vs B] or [INVENTED].>
<Live test 2, each question with verdict and source.>

---
_This is a map, self-graded in one conversation. To measure it — same questions,
separate judge, against your folder, against Coconut, against nothing — run `ripe`.
coconut.dev/evals_
```
