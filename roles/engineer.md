---
role: engineer
title: Engineer
persona: an engineer in their first week, about to make their first change to production
questions:
  - id: architecture
    weight: 2
    ask: >
      Describe the system architecture: the main services, how they talk to
      each other, and where the data lives. Cite the pages you used.
    must_cover:
      - Names the main components or services
      - How they communicate
      - Where persistent data is stored
      - Flags anything the diagrams and the prose disagree on

  - id: local-setup
    weight: 1.5
    ask: >
      How do I run the system locally, from a clean machine to a passing test
      suite?
    must_cover:
      - The steps, in order
      - Required tools and versions
      - How to verify it worked
      - When the guide was last updated

  - id: deploy
    weight: 2
    ask: >
      How does a change get to production? Describe the path from merge to
      live, including approvals and rollback.
    must_cover:
      - The pipeline stages
      - Who or what approves a production deploy
      - How to roll back
      - Cites a runbook or says none exists

  - id: standards
    weight: 1.5
    ask: >
      What coding standards and review rules apply? Which are enforced by
      tooling and which by convention?
    must_cover:
      - Named standards or a style guide
      - Distinguishes tool-enforced from convention
      - When the standards were last reviewed

  - id: decisions
    weight: 1.5
    ask: >
      What were the most consequential technical decisions, and why were they
      made? Cite the decision records.
    must_cover:
      - Named decisions with dates
      - The reasoning for each
      - Cites a record per decision, or says they are not logged
      - Flags any decision the current code no longer reflects

  - id: on-call
    weight: 1.5
    expected_gap: true
    ask: >
      What happens when something breaks at 3am? Who is paged, what runbooks
      exist, and how do incidents get written up?
    must_cover:
      - The on-call arrangement, or an explicit "none"
      - Named runbooks for common failures
      - The postmortem process, or says there is none

  - id: secrets
    weight: 1.5
    ask: >
      Where do secrets and credentials live, and how does a new engineer get the
      ones they need?
    must_cover:
      - The secrets store or mechanism
      - The process to request access
      - What must never be committed, per our own rules

  - id: roadmap
    refusal_ok: true
    ask: What is the engineering team working on this quarter, and what is explicitly not being done?
    must_cover:
      - Named current priorities
      - Anything explicitly deferred or declined, or says nothing is recorded
---

# What an engineer needs from context

Ship a change safely in week one: understand the shape of the system, run it,
follow the rules, and know who to wake up when it breaks.

Stale technical documentation is worse than none, because it is trusted. Where
a diagram, a decision record and the code disagree, the code is what is true
and the disagreement is the finding — say which sources are out of date rather
than averaging them into a plausible story.
