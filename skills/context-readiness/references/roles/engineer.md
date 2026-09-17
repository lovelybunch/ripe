# Role: Engineer

Ship a change safely in week one: understand the shape of the system, run it,
follow the rules, and know who to wake up when it breaks.

## Six dimensions

1. **Architecture** — the main components, how they talk, where data lives.
   Diagrams and prose that disagree cap this at 2.
2. **Local setup** — clean machine to passing tests, with tool versions and a
   last-updated date. An undated guide caps this at 2.
3. **Path to production** — pipeline stages, approvals, rollback, with a
   runbook.
4. **Standards & decisions** — coding rules (tool-enforced vs convention) and
   dated decision records. A decision the code no longer reflects caps this
   at 2.
5. **On-call & incidents** — who is paged, runbooks for common failures, how
   postmortems are written.
6. **Secrets & access** — where credentials live and how a new engineer gets
   theirs. Anything committed that our own rules say must never be is a 0.

Stale technical documentation is worse than none, because it is trusted.
Where a diagram, a decision record and the code disagree, the code is true and
the disagreement is the finding.

## The draft — a runbook entry

Six slots: the failure it covers · how you'd know it's happening · first
diagnostic step · the fix · how to verify · who to escalate to.

## The ten questions

1. What are the main services, and how do they talk to each other? `[architecture]`
2. Where does persistent data live? `[architecture]`
3. How do I run the system locally, from a clean machine to passing tests?
   `[local-setup]`
4. How does a change get to production, and who approves it? `[deploy]`
5. How do I roll back? `[deploy]`
6. Which coding standards apply, and which are enforced by tooling? `[standards]`
7. What were the most consequential technical decisions, and why? `[decisions]`
8. What happens when something breaks at 3am? `[on-call]`
9. Where do secrets live, and how do I get the ones I need? `[secrets]`
10. What is the team working on this quarter, and what is explicitly not being
    done? `[roadmap]`
