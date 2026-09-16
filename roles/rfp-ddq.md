---
role: rfp-ddq
title: RFP / DDQ Responder
persona: GRC, security or compliance — the person who actually answers these, not sales
questions:
  - id: data-residency
    weight: 2
    ask: >
      Where does customer data live, who inside the company can access it, and
      under what controls? Answer as you would in a security questionnaire, and
      cite the internal source for every factual claim.
    must_cover:
      - Named hosting regions or cloud providers
      - Who internally can access customer data
      - The controls governing that access
      - Named certifications, or an explicit "none yet"

  - id: subprocessors
    weight: 2
    ask: >
      Which subprocessors do we use, is the list current, and is it published
      anywhere a customer can see it?
    must_cover:
      - A named list, not a category description
      - When the list was last reviewed
      - Whether it is published customer-facing

  - id: retention
    weight: 1.5
    refusal_ok: true
    ask: >
      What is our data retention and deletion policy? How long do we keep
      customer data after a contract ends, and how is deletion verified?
    must_cover:
      - A stated retention period, or an explicit "not yet defined"
      - What happens on contract termination
      - How deletion is verified or evidenced

  - id: incident-response
    weight: 1.5
    expected_gap: true
    ask: >
      What is our security incident response process, and what notification
      commitments have we made to customers?
    must_cover:
      - A named process or runbook
      - A notification window we have committed to
      - Who owns the process

  - id: ai-data-use
    weight: 2
    ask: >
      Do we train models on customer data, and what does a customer's data
      touch when they use AI features? Answer precisely — this is the question
      that kills deals when answered loosely.
    must_cover:
      - A yes or no on training, not a hedge
      - Which third-party model providers receive customer data
      - What contractual commitments exist with those providers

  - id: access-control
    weight: 1.5
    ask: >
      How is access to production and to customer data controlled internally?
    must_cover:
      - The authentication and authorisation model
      - Whether access is least-privilege and how it is reviewed
      - Whether access is logged and auditable
---

# What this role needs from context

You answer externally-facing questionnaires that must be true about your own
organisation: security reviews, vendor assessments, diligence lists. An outside
party sets the questions, a deadline applies, and the answers become part of a
contractual record.

Accuracy is the whole job. A wrong answer here is not an embarrassment, it is a
misrepresentation — so an unsourced claim is worse than a gap, and a source
nobody owns or has reviewed is not a source you can stand behind. Say what is
true, cite where it is written down, and name what you cannot confirm.
