---
role: operations
title: Operations
persona: an operations lead covering for a colleague on leave, needing to run things without asking around
questions:
  - id: processes
    weight: 2
    ask: >
      Which recurring processes does the company run — weekly, monthly,
      quarterly — and who owns each? Cite the page that defines each one.
    must_cover:
      - Named recurring processes with cadence
      - An owner per process, or an explicit "no owner"
      - Cites a definition for each, or says none is written

  - id: vendors
    weight: 1.5
    expected_gap: true
    ask: >
      Which vendors and tools do we pay for, what does each cost, and when does
      each renew?
    must_cover:
      - A named list of vendors or tools
      - Cost per vendor, or an explicit "not recorded"
      - Renewal dates, or flags them as unknown

  - id: onboarding
    weight: 1.5
    ask: >
      A new hire starts Monday. What is the onboarding checklist, which accounts
      do they need, and who provisions each?
    must_cover:
      - A named checklist or an explicit "none exists"
      - The accounts and tools to provision
      - Who provisions each

  - id: decisions
    weight: 2
    ask: >
      What were the last five significant decisions the company made, when, and
      why? Cite the record for each.
    must_cover:
      - Five dated decisions
      - The reasoning or context for each
      - Cites a decision record, or says decisions are not logged
      - Flags any decision that later material contradicts

  - id: access
    weight: 1.5
    ask: >
      Who has admin access to our critical systems, and how is access granted
      and removed?
    must_cover:
      - Names the critical systems
      - Who holds admin access, or says it is not recorded
      - The grant and removal process, or an explicit gap

  - id: incidents
    refusal_ok: true
    ask: >
      What operational incidents have we had in the last six months, and what
      changed as a result?
    must_cover:
      - Named incidents with dates, or an explicit "none recorded"
      - The follow-up action per incident
      - Whether each follow-up was completed

  - id: policies
    ask: >
      Which company policies exist — expenses, travel, leave, security — and
      when was each last reviewed?
    must_cover:
      - Names the policies that exist
      - A last-reviewed date per policy, or flags it missing
      - Who owns each policy

  - id: metrics
    ask: >
      Which operating metrics does leadership track, where do the numbers come
      from, and what were they last period?
    must_cover:
      - Named metrics
      - The source of each
      - A recent value per metric, or an explicit "not available"
---

# What operations needs from context

Keep the company running when the person who usually does a thing is not
there. That means knowing what recurs, who owns it, what it costs, and what
was decided — without a meeting.

The failure mode is tribal knowledge: the process that only exists in one
person's head, the renewal nobody tracked, the decision everyone remembers
differently. Where the material is silent, name the person who would know
rather than reconstructing from memory.
