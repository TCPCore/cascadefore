#!/usr/bin/env bash
# One gate for the whole repo. The panel has its own tsconfig, and a type error
# there is invisible to the root check — which is exactly how "Matrix is not
# defined" shipped into a build.
set -euo pipefail

unset npm_config_prefix
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1
nvm use 24 >/dev/null 2>&1

echo "· root typecheck"
npx tsc --noEmit

echo "· panel typecheck"
# `npm exec` swallows the exit code, which is how two type errors passed this
# gate. Run tsc directly from the panel directory instead.
(cd static/panel && npx tsc --noEmit)

echo "· tests"
npx vitest run --silent

echo "· lint"
forge lint

echo "· panel bundles"
npm --prefix static/panel run build >/dev/null
npm --prefix static/panel run build:web >/dev/null

echo "all green"
