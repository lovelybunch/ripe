---
role: support
title: Customer Support / Success
persona: a support lead answering a customer who is already frustrated, with a QBR next week
questions:
  - id: escalation
    weight: 2
    ask: >
      A customer reports a serious problem. What is our escalation path, who is
      on it, and what response times have we committed to?
    must_cover:
      - A named escalation path or process
      - Who is responsible at each step
      - Committed response or resolution times, or an explicit "none published"

  - id: known-issues
    weight: 1.5
    expected_gap: true
    ask: >
      What are the current known issues and workarounds a customer might hit
      this week? Cite where they are tracked.
    must_cover:
      - Names specific issues
      - A workaround or status per issue
      - Cites the tracker or page, and how current it is

  - id: account-history
    weight: 2
    ask: >
      Pick one named customer from our material. Summarise their history with
      us: what they bought, what has gone wrong, what was promised.
    must_cover:
      - A real customer named from our material
      - What they use and since when
      - Past incidents or complaints, or an explicit "none recorded"
      - Any outstanding commitments made to them

  - id: faq
    weight: 1.5
    ask: >
      What are the five questions customers ask most, and what is our approved
      answer to each?
    must_cover:
      - Five distinct questions
      - An answer per question with a source
      - Flags any answer that is out of date or disputed

  - id: sla
    weight: 1.5
    ask: >
      What do we contractually commit to on uptime and support, and where are
      the current numbers against those commitments?
    must_cover:
      - The committed SLA figures, or an explicit "none contractual"
      - Where actual performance is recorded
      - Whether we are currently meeting them

  - id: refunds
    refusal_ok: true
    ask: >
      A customer asks for a refund or to cancel. What is our policy and who can
      approve exceptions?
    must_cover:
      - The stated policy, or an explicit "not written down"
      - Who approves exceptions

  - id: qbr
    weight: 1.5
    ask: >
      What should go into a quarterly review for a customer: which metrics do we
      show, and where do they come from?
    must_cover:
      - Named metrics
      - The source system or page for each
      - Any template or prior example we have

  - id: roadmap-asks
    ask: >
      What have customers asked for that we have said is coming, and what did we
      commit to?
    must_cover:
      - Named requests with the customer who asked
      - What was said in response and by whom
      - Distinguishes committed from acknowledged
---

# What support needs from context

Give a frustrated customer a correct answer quickly, know what has already been
promised to them, and never contradict what a colleague told them last week.

The dangerous answer here is the confident one: a policy that changed, a
workaround that no longer works, a commitment nobody wrote down. If the
material does not say, say that — and say who would know.
