# ADR 0001 — Claude links to ENU Den (not the other way round)

Status: accepted (2026-10-29)

## Context

Each pet must be "linked to the employee's own Claude business account" and the work log must be written
periodically by that account. Anthropic does not allow third-party apps to offer claude.ai login or to collect,
store or intermediate claude.ai credentials or session tokens. There is no "Sign in with Claude" for apps.

## Decision

ENU Den is a remote MCP server (`/api/mcp`, Streamable HTTP) plus its own OAuth 2.1 authorization server
(Better Auth `mcp()` + `cimd()` + `jwt()`), whose login is the same Google sign-in restricted to the workspace
domain. The Claude org Owner registers it once as an org custom connector (Claude's published identity / CIMD);
each employee clicks Connect. Every tool call then carries that employee's identity (token `sub`).
Periodic writing is a Cowork cloud scheduled task per employee running the `enu-den-checkin` skill.

## Consequences

- ENU Den never sees Claude credentials; tokens are ours (aud = MCP URL, revocable per link).
- The token proves which Google user consented, not which Claude account calls. Mitigations: consent screen
  shows the email, Claude org SSO via Google Workspace, per-client link list with revoke, audit log.
- Unattended runs depend on Claude org approval settings (Always allow / auto-approve) — verified in the pilot.

## Addendum (2026-10-29): ENU Den and the pet channel ([ADR 0005](0005-enu-den-messenger-and-pets.md))

- The product is ENU Den at `den.enu-tech.co.kr`. Connector auth cannot be edited after registration, so the Owner
  registers the "ENU Den" connector at `https://den.enu-tech.co.kr/api/mcp` and everyone connects again
  ([cutover runbook](../runbooks/rename-enu-den.ko.md)). Periodic writing is the Cowork task "ENU Den 체크인" running
  `enu-den-checkin`.
- A second kind of ENU Den link: the `enu-den-channel` Claude Code plugin ([ADR 0006](0006-claude-code-pet-channel.md)).
  It is paired by the employee with a single-use code from ENU Den settings and receives a narrow, revocable token
  that only the pet-channel routes accept. It is listed with the other Claude links and revoked with them, on
  deactivation included. Claude Code signs in to Anthropic on its own; ENU Den still never sees, stores or relays
  claude.ai credentials.
