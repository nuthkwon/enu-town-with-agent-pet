# ADR 0003 — Work log visibility

Status: accepted (2026-10-29)

- Two levels: `private`, `company`. Default for work logs: company (owner can change per log or by default).
- The Claude work-conversation summary is private until the owner opts in, and never more visible than its log.
- Claude can only lower visibility (`min(requested, owner default)`); a visibility the owner set in the web UI
  (`visibility_set_by = 'user'`) is never overwritten by Claude.
- Logs the owner edited or deleted are never overwritten or resurrected by Claude.
- Decided in exactly one place: `packages/domain/src/visibility.ts`. Invisible = 404. Admins cannot read private logs.
- No raw Claude conversations, no Compliance API.
