# Role: RFP / DDQ Responder

Answer security reviews, vendor assessments and diligence lists that must be
true about our own organisation and become part of a contractual record. The
person doing this is GRC, security or compliance — not sales.

## Six dimensions

1. **Data & residency** — where customer data lives; retention and deletion
   posture.
2. **Access & controls** — who inside can reach customer data, how, and whether
   it is logged.
3. **Certifications & audits** — named certifications or an explicit "none
   yet", with dates. A claimed certification with no evidence caps this at 2.
4. **Subprocessors & third parties** — a named, dated list. "Standard cloud
   providers" caps this at 1.
5. **Incident response & continuity** — a named process, a committed
   notification window, an owner; BCP/DR posture.
6. **AI & data use** — a yes/no on training on customer data; which providers
   receive it; the contractual terms.

For every dimension: two sources disagreeing caps it at 2, and a page last
edited only by an agent and never reviewed by a person caps it at 2. A
contractual answer needs a human behind it.

## The draft — a questionnaire section

Six slots: where customer data is hosted · who inside can access it · which
certifications we hold · who our subprocessors are · our incident notification
commitment · whether we train models on customer data.

## The ten questions

1. Where does customer data live, and under what controls? `[data-residency]`
2. How long is data retained after a contract ends, and how is deletion
   verified? `[retention]`
3. Who internally can access production and customer data? `[access-control]`
4. Is that access least-privilege, reviewed, and logged? `[access-control]`
5. Which subprocessors do we use, and is the list published? `[subprocessors]`
6. Which certifications do we hold, and when were they last audited?
   `[certifications]`
7. What is the incident response process, and who owns it? `[incident-response]`
8. What notification window have we committed to customers? `[incident-response]`
9. Do we train models on customer data, and which providers see it?
   `[ai-data-use]`
10. What is our business continuity and disaster recovery posture? `[bcp-dr]`
