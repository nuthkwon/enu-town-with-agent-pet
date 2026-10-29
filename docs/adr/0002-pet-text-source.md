# ADR 0002 — Pet text comes only from the employee's own Claude

Status: accepted (2026-10-29)

## Decision
ENU Town has no company API key and makes no server-side LLM calls. Pet bubbles show text written by the owner's
Claude through `post_pet_nudges` (or the title of a Claude-authored to-do), verbatim. ENU Town only decides *when*
(`packages/domain/src/nudge-policy.ts`). Text that violates the publishing rules (personal data, links, too long)
is rejected with a reason so Claude rewrites it; ENU Town never edits it. System information (due time, link
state) is rendered outside the bubble as UI.

## Enforcement
ESLint `no-restricted-imports` + `scripts/verify-policy.sh` (CI) block LLM SDKs; `BubblePresenter` only accepts
candidates loaded from Claude-authored rows; unlinked pets sleep (icon), they never "speak".
