#!/usr/bin/env bash
# vercel guard (P1.13, D-18; RUNBOOK §9). Installed as ~/.local/bin/vercel; the Node-prefix vercel/vc links point here too.
set -uo pipefail
DEMO_DIR=$HOME/work/demo-publish
DEMO_PROJECT=$(cat "$HOME/.config/illini/vercel-demo-project" 2>/dev/null)
block() { echo "vercel guard: $1 blocked (D-18)" >&2; exit 1; }
for a in "$@"; do
  case "$a" in
    --prod|--prod=*|--production|--target|--target=*|promote|rollback|env|pull|domains|domain|alias|aliases|dns|certs|cert|redeploy|remove|rm|switch|teams|integration|integrations|git|blob) block "$a" ;;
  esac
done
case "${1:-}" in
  --version|-v|--help|-h|help|whoami|ls|list|inspect|logs) ;;
  project|projects) case "${2:-}" in ls|list) ;; *) block "project ${2:-}" ;; esac ;;
  link) { [ -n "$DEMO_PROJECT" ] && [ "$PWD" = "$DEMO_DIR" ] && [ "$*" = "link --yes --project=$DEMO_PROJECT --scope ericxu-0805s-projects" ]; } || block "link" ;;
  ''|deploy|-*) { [ "$PWD" = "$DEMO_DIR" ] && [ -f "$DEMO_DIR/.vercel/project.json" ]; } || block "deploy outside $DEMO_DIR" ;;
  *) block "$1" ;;
esac
[ -n "${VERCEL_REAL:-}" ] && exec "$VERCEL_REAL" "$@"
exec "$HOME/.local/opt/node/bin/node" "$HOME/.local/opt/node/lib/node_modules/vercel/dist/vc.js" "$@"
