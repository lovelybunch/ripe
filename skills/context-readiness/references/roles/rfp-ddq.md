# Role: RFP / DDQ Responder

The job, in context terms: answer externally-facing questionnaires — security
reviews, vendor assessments, diligence lists — that must be true about your own
organisation, on a deadline, and that become part of a contractual record. The
person who does this is usually GRC, security or compliance, not sales.

Accuracy is the whole job. An unsourced answer is worse than a gap; a source
nobody owns or has reviewed is not a source you can stand behind.

## The six dimensions

1. **Data & residency** — where customer data lives (regions, providers), and
   the retention and deletion posture. One current version, or nothing.
2. **Access & controls** — who inside can reach customer data, under what
   authentication and authorisation model, and whether access is logged.
3. **Certifications & audits** — named certifications or an explicit "none
   yet"; audit reports and their dates. A claimed certification with no
   evidence caps this at 2.
4. **Subprocessors & third parties** — a named, dated list. "We use standard
   cloud providers" caps this at 1.
5. **Incident response & continuity** — a named process, a committed
   notification window, an owner; BCP/DR posture.
6. **AI & data use** — a yes/no on training on customer data; which model
   providers receive customer data; the contractual terms with them.

Scoring notes: score the data, not the connection — a policy folder full of
undated drafts is a 2. Any two sources disagreeing on a fact caps that
dimension at 2. Anything last edited only by an agent, never reviewed by a
person, caps at 2: for a contractual answer, a human has to have stood behind it.

## Live test 1 — the questionnaire section

Using **only** what the map found, answer these six as you would in a security
questionnaire. Mark every fact **[cited: source]** or **[INVENTED]**.

1. Where is customer data hosted?
2. Who inside the company can access it?
3. Which certifications do you hold?
4. Who are your subprocessors?
5. What is your incident notification commitment?
6. Do you train models on customer data?

Headline the **invented count out of 6**. Score: 4 = zero · 3 = one · 2 = two ·
1 = three or more · 0 = couldn't attempt.

## Live test 2 — ten questions

Verdicts: **cited** / **uncertain** / **can't answer**. Ids match `roles/rfp-ddq.md` in `ripe`.

1. Where does customer data live, and under what controls? `[data-residency]`
2. How long is data retained after a contract ends, and how is deletion verified? `[retention]`
3. Who internally can access production and customer data? `[access-control]`
4. Is access least-privilege, reviewed, and logged? `[access-control]`
5. Which subprocessors do you use, and is the list published? `[subprocessors]`
6. What certifications do you hold, and when were they last audited? `[certifications]`
7. What is the incident response process, and who owns it? `[incident-response]`
8. What notification window have you committed to customers? `[incident-response]`
9. Do you train models on customer data, and which providers see it? `[ai-data-use]`
10. What is your business continuity and disaster recovery posture? `[bcp-dr]`

Headline the **cited count out of 10**. Score: 4 = 9–10 · 3 = 7–8 · 2 = 4–6 ·
1 = 1–3 · 0 = none.

## The starter page set (for the plan)

1. Data residency and retention — one page, one owner, a review date.
2. Access control model — who, how, logged where.
3. Subprocessor list — dated, published customer-facing.
4. Certifications and audit evidence — with dates and where the reports live.
5. Incident response — the process, the owner, the committed window.
6. AI and data use — the yes/no, the providers, the contractual terms.

Then the feeds: policy changes → the pages; audit cycles → certification dates;
new vendors → the subprocessor list. Set an owner and a review date on every one
of these — for this role, an unreviewed page is a page you cannot send.
