# ADR 0001 — Claude links to ENU Town (not the other way round)

Status: accepted (2026-10-29)

## Context

Each pet must be "linked to the employee's own Claude business account" and the work log must be written
periodically by that account. Anthropic does not allow third-party apps to offer claude.ai login or to collect,
store or intermediate claude.ai credentials or session tokens. There is no "Sign in with Claude" for apps.

## Decision

ENU Town is a remote MCP server (`/api/mcp`, Streamable HTTP) plus its own OAuth 2.1 authorization server
(Better Auth `mcp()` + `cimd()` + `jwt()`), whose login is the same Google sign-in restricted to the workspace
domain. The Claude org Owner registers it once as an org custom connector (Claude's published identity / CIMD);
each employee clicks Connect. Every tool call then carries that employee's identity (token `sub`).
Periodic writing is a Cowork cloud scheduled task per employee running the `enu-town-checkin` skill.

## Consequences

- ENU Town never sees Claude credentials; tokens are ours (aud = MCP URL, revocable per link).
- The token proves which Google user consented, not which Claude account calls. Mitigations: consent screen
  shows the email, Claude org SSO via Google Workspace, per-client link list with revoke, audit log.
- Unattended runs depend on Claude org approval settings (Always allow / auto-approve) — verified in the pilot.
