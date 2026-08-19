#!/usr/bin/env bash
#
# Deploy the Insurance CRM.
#
#   bash scripts/deploy.sh              # update an existing install
#   bash scripts/deploy.sh --first-run  # also seed reference data
#
# Run as the application user (not root) from the application directory.
# Expects .env to already exist.

set -euo pipefail

FIRST_RUN=false
[[ "${1:-}" == "--first-run" ]] && FIRST_RUN=true

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mERROR\033[0m %s\n' "$1" >&2; exit 1; }

[[ -f package.json ]] || fail "Run this from the application directory (where package.json lives)."
[[ -f .env ]] || fail ".env not found. Create it first — see docs/DEPLOYMENT.md."

# A world-readable file holding every credential you have is worth catching.
PERMS="$(stat -c '%a' .env)"
if [[ "$PERMS" != "600" ]]; then
  say "Tightening permissions on .env (was $PERMS)"
  chmod 600 .env
fi

if [[ -d .git ]] && [[ "$FIRST_RUN" == false ]]; then
  say "Pulling latest code"
  git pull --ff-only
fi

say "Installing dependencies"
npm ci

say "Generating the database client"
npm run db:generate

say "Applying migrations"
# Migrations run before the build so a schema the new code needs is already
# there when it starts.
npm run db:deploy

if [[ "$FIRST_RUN" == true ]]; then
  say "Seeding reference data"
  # Pipeline stages, insurers, document types and so on — the CRM cannot
  # function without them. Demo clients are skipped in production.
  SEED_DEMO=false npm run db:seed
fi

say "Building"
npm run build

if systemctl list-unit-files 2>/dev/null | grep -q '^crm-web.service'; then
  say "Restarting services"
  sudo systemctl restart crm-web crm-worker
  sleep 4
  systemctl is-active --quiet crm-web    || fail "crm-web failed to start — check: journalctl -u crm-web -n 50"
  systemctl is-active --quiet crm-worker || fail "crm-worker failed to start — check: journalctl -u crm-worker -n 50"
else
  say "systemd units not found — skipping restart (run scripts/setup-server.sh first)"
fi

say "Health check"
sleep 2
if curl -fsS http://127.0.0.1:3000/api/health; then
  printf '\n\n\033[1;32mDeployed.\033[0m\n'
else
  fail "Health check failed. Check: journalctl -u crm-web -n 50"
fi
