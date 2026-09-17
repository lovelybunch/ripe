---
role: sdr
title: SDR (Sales Development)
persona: a sales development rep in their first week, writing to real prospects today
questions:
  - id: pricing
    weight: 2
    expected_gap: true
    refusal_ok: true
    ask: >
      What does it cost? Give the pricing posture and any published numbers. If
      we do not publish pricing, say so explicitly and cite where that is stated.
    must_cover:
      - The price, or an explicit "custom / talk to us" posture
      - The unit pricing is charged on (per seat, per workspace, or usage)
      - What the free or entry tier includes
      - Whether any two sources disagree about price, and which is current

  - id: competitor
    weight: 1.5
    ask: >
      How are we different from our closest named competitor? Give one
      when-we-win and one when-we-lose. Name the competitor from our own
      material rather than assuming who it is.
    must_cover:
      - Names a competitor that appears in our own material
      - A concrete when-we-win, not a generic benefit
      - An honest when-we-lose
      - How recent the competitive information is

  - id: materials
    weight: 2
    ask: >
      Show me my sales materials. List every asset an SDR could send a prospect
      today. For each one: where it lives, what it is for, when it was last
      updated, and who owns it. Flag anything you would NOT send, and say why.
    must_cover:
      - At least five distinct assets, each with an exact location
      - A last-updated date for each asset
      - An owner for each asset, or an explicit "no owner"
      - What stage or purpose each asset serves
      - At least one asset flagged as not-send-worthy, with a reason

  - id: icp
    weight: 1.5
    ask: >
      Who is this for, and who is it explicitly NOT for? Name the segments and
      the disqualifiers.
    must_cover:
      - Names the target segment or segments
      - Names who we walk away from
      - Names the buying titles or personas
      - Cites a specific internal source, not a general impression

  - id: proof
    weight: 1.5
    ask: >
      Give me two customer proof points I could put in an email today. For each,
      state the source and whether we have permission to name the customer
      publicly.
    must_cover:
      - Two distinct proof points
      - Names the customer, or explicitly says it must stay anonymous
      - States permission status per item, or flags it as unknown

  - id: what-it-does
    ask: >
      In two sentences, what does the product do? Cite the source for each claim.
    must_cover:
      - Names the product category in our own words
      - Says how it works, not only what it is
      - States the outcome for the buyer
  - id: data-residency
    ask: >
      A prospect asks where their data lives and who can see it. Answer as you
      would in an email, citing the internal source for every factual claim.
    must_cover:
      - Says where data is stored (regions or providers)
      - Says who inside the company can see it
      - Names certifications, or says explicitly there are none yet

  - id: getting-started
    ask: How long does it take to get started, and what does onboarding involve?
    must_cover:
      - A time-to-value figure or range
      - What the customer has to do
      - Cites a specific internal source

  - id: integrations
    ask: What does the product integrate with? Name them from our own material.
    must_cover:
      - Names specific integrations
      - Distinguishes what is live from what is planned

  - id: support
    ask: What support does a customer get, and at which tiers?
    must_cover:
      - Names the support channels or tiers
      - States response commitments, or says none are published

  - id: reference
    ask: >
      A prospect asks to speak to a reference customer. Who could we offer, and
      do we have their permission?
    must_cover:
      - Names a candidate, or says explicitly we have none yet
      - States permission status, or flags it unknown
---

# What an SDR needs from context

Describe what we sell accurately in one breath, know who to say it to, produce
outbound materials that do not come back for a rewrite, and answer inbound
questions fast and correctly.

An answer that is confidently wrong is worse than an answer that admits a gap.
A prospect who is told the wrong price, or sent a stale one-pager, costs more
than one who is told "let me confirm that and come back to you".
