#!/usr/bin/env bash
# Repository policy gate (CI + local):
#  1. No LLM SDK may be a dependency or import (pet text comes only from each user's own Claude).
#  2. MCP tools must never request user interaction (unattended scheduled runs would stall).
#  3. Real employee names / seat roster must not be committed (public repository).
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
if [ "$fail" -eq 0 ]; then echo "✓ policy checks passed"; fi
exit "$fail"
