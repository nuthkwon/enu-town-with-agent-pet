#!/usr/bin/env bash
# Checks what Claude needs to add ENU Den as a custom connector (OAuth discovery for the MCP server).
# Usage: scripts/check-oauth-discovery.sh https://den.enu-tech.co.kr
set -euo pipefail
BASE="${1:?usage: $0 <base-url>}"
BASE="${BASE%/}"
RESOURCE="$BASE/api/mcp"
fail() { echo "✗ $*"; exit 1; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify(($1)(j)))})"; }

hdr=$(curl -sS -o /dev/null -D - -X POST -H 'content-type: application/json' -d '{}' --max-time 10 "$RESOURCE")
echo "$hdr" | grep -qiE '^HTTP/[0-9.]+ 401' || fail "unauthenticated POST /api/mcp must return 401"
meta=$(echo "$hdr" | grep -i '^www-authenticate:' | sed -E 's/.*resource_metadata="([^"]+)".*/\1/' | tr -d '\r')
[ -n "$meta" ] || fail "WWW-Authenticate lacks resource_metadata"
echo "✓ 401 challenge -> $meta"

prm=$(curl -sS --max-time 10 "$meta")
[ "$(echo "$prm" | json 'j=>j.resource')" = "\"$RESOURCE\"" ] || fail "PRM resource must equal $RESOURCE"
as=$(echo "$prm" | json 'j=>j.authorization_servers[0]' | tr -d '"')
echo "✓ protected resource metadata (authorization server: $as)"

asmeta_url="$(node -e "const u=new URL('$as');console.log(u.origin+'/.well-known/oauth-authorization-server'+u.pathname.replace(/\/$/,''))")"
asm=$(curl -sS --max-time 10 "$asmeta_url")
echo "$asm" | json 'j=>j.code_challenge_methods_supported' | grep -q S256 || fail "S256 PKCE not advertised"
echo "$asm" | json 'j=>j.token_endpoint_auth_methods_supported' | grep -q '"none"' || fail "'none' token auth method missing (needed for CIMD public clients)"
echo "$asm" | json 'j=>j.grant_types_supported' | grep -q refresh_token || fail "refresh_token grant missing"
echo "$asm" | json 'j=>j.scopes_supported' | grep -q offline_access || fail "offline_access scope missing"
cimd=$(echo "$asm" | json 'j=>j.client_id_metadata_document_supported')
echo "✓ authorization server metadata (CIMD supported: $cimd)"

jwks=$(echo "$asm" | json 'j=>j.jwks_uri' | tr -d '"')
[ "$(curl -sS --max-time 10 "$jwks" | json 'j=>j.keys.length>0')" = "true" ] || fail "JWKS has no keys"
echo "✓ JWKS reachable"
echo "All OAuth discovery checks passed for $BASE"
