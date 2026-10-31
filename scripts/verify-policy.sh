#!/usr/bin/env bash
# Repository policy gate (CI + local):
#  1. No LLM SDK may be a dependency or import (pet text comes only from each user's own Claude).
#  2. MCP tools must never request user interaction (unattended scheduled runs would stall).
#  3. Real employee names / seat roster must not be committed (public repository).
#  4. Local only (config/seats.local.json present): no roster name appears in any tracked file.
#     Only file paths are reported, never the names.
#  5. The product is ENU Den: the previous brand may appear only in this script and the cutover runbook.
#  6. No audio files (ADR 0008): every sound is a recipe in packages/sfx, synthesized at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

banned='"(@anthropic-ai/[^"]+|openai|@ai-sdk/[^"]+|ai|@google/genai|@google/generative-ai|langchain|@langchain/[^"]+)"[[:space:]]*:'
if grep -REn --include=package.json "$banned" apps packages package.json >/dev/null 2>&1; then
  echo "✗ LLM SDK dependency found:"; grep -REn --include=package.json "$banned" apps packages package.json; fail=1
fi
if grep -REn --include='*.ts' --include='*.tsx' "from ['\"](@anthropic-ai/|openai|@ai-sdk/|@google/genai|langchain)" apps packages >/dev/null 2>&1; then
  echo "✗ LLM SDK import found"; fail=1
fi
if grep -RIn --include='*.ts' "requiresUserInteraction" packages/mcp-tools/src apps/web/src 2>/dev/null | grep -v "never" >/dev/null; then
  echo "✗ requiresUserInteraction must not be used in MCP tools"; fail=1
fi
if git ls-files --error-unmatch config/seats.local.json >/dev/null 2>&1; then
  echo "✗ config/seats.local.json (real roster) must not be committed"; fail=1
fi
if [ -f config/seats.local.json ]; then
  roster_check='
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const seats = JSON.parse(readFileSync("config/seats.local.json", "utf8")).seats ?? [];
const names = seats.map((s) => (typeof s?.name === "string" ? s.name.trim() : "")).filter((n) => n.length >= 2);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (names.some((n) => text.includes(n))) console.log(f);
}'
  if ! roster_hits=$(node --input-type=module -e "$roster_check" 2>/dev/null); then
    echo "✗ config/seats.local.json could not be read for the roster-name check"; fail=1
  elif [ -n "$roster_hits" ]; then
    echo "✗ a name from config/seats.local.json appears in tracked files (names not printed):"
    echo "$roster_hits"; fail=1
  fi
fi
legacy='enu[ _-]?town|town\.enu-tech\.co\.kr|town-dev\.'
legacy_allow=(':(exclude)scripts/verify-policy.sh' ':(exclude)docs/runbooks/rename-enu-den.ko.md')
if git grep -qIiE "$legacy" -- . "${legacy_allow[@]}"; then
  echo "✗ previous brand found (use ENU Den / enu-den / enu_den):"
  git grep -nIiE "$legacy" -- . "${legacy_allow[@]}"; fail=1
fi
if git ls-files | grep -qiE 'enu[-_]?town'; then
  echo "✗ previous brand in a tracked path:"; git ls-files | grep -iE 'enu[-_]?town'; fail=1
fi
audio='\.(wav|mp3|ogg|oga|m4a|aac|flac|opus|weba|mid|midi)$'
if git ls-files | grep -qiE "$audio"; then
  echo "✗ audio file committed (sounds are code: packages/sfx recipes):"; git ls-files | grep -iE "$audio"; fail=1
fi
if [ "$fail" -eq 0 ]; then echo "✓ policy checks passed"; fi
exit "$fail"
