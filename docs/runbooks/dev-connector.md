# Testing the Claude connector before production

Claude reaches the connector from Anthropic's network, so `localhost` cannot be added as a claude.ai connector.

## Option A — stable tunnel + separate "ENU Den (dev)" connector

1. Run the stack locally (`pnpm dev` or `docker compose -f compose.yaml -f compose.dev.yaml up`).
2. Expose it with a named tunnel on a fixed hostname, e.g. `cloudflared tunnel --hostname den-dev.<domain> --url http://localhost:8080`.
3. Set `PUBLIC_URL=https://den-dev.<domain>` and add the dev host's Google OAuth redirect URI.
4. Ask the Owner to register a separate custom connector "ENU Den (dev)" → `https://den-dev.<domain>/api/mcp`
   (auth settings cannot be edited later, so never reuse the production connector).
5. On Team plans every member can see the dev connector: set `ALLOWED_EMAILS` to the pilot list.

## Option B — Claude Code against localhost

Claude Code can connect to a local MCP server directly: `claude mcp add --transport http enu-den-local http://localhost:3000/api/mcp`
then `/mcp` → authenticate. Claude Code uses a loopback redirect (`http://localhost:<port>/callback`).

## Automated checks (no Claude needed)

- `scripts/check-oauth-discovery.sh http://localhost:3000` — 401 challenge, PRM, AS metadata (CIMD, none, S256, offline_access), JWKS.
- `pnpm --filter @enu/auth test:int` — authorize → consent → token → MCP auth → revocation.
- `pnpm --filter @enu/mcp-tools test:int` — all five tools through the MCP client.
