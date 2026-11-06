#!/usr/bin/env bash
# One command from clone to a running product.
set -euo pipefail

unset npm_config_prefix
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use 24 >/dev/null 2>&1

echo "· installing"
npm install --silent
npm --prefix static/panel install --silent

echo "· building the panel"
npm --prefix static/panel run build:web >/dev/null

echo "· starting on http://localhost:4173"
echo "  (real recorded Teamwork Graph payloads; no Atlassian account needed)"
echo
exec env CASCADE_SOURCE=live CASCADE_STORE=sqlite CASCADE_DB=/tmp/cascade-evaluate.db \
  npx tsx scripts/serve.ts
