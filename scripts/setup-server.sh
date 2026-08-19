#!/usr/bin/env bash
#
# One-time server provisioning for the Insurance CRM on AWS Lightsail.
#
#   sudo bash scripts/setup-server.sh
#
# Installs Node, PostgreSQL, nginx and certbot; creates the database and the
# application directory; writes both systemd units. It does NOT write .env,
# does NOT run the build, and does NOT request a certificate — those need your
# credentials and your DNS to be live, so they stay manual and deliberate.
#
# Safe to re-run: every step checks before acting.

set -euo pipefail

DOMAIN="${DOMAIN:-crm.avexainsurance.ca}"
APP_DIR="${APP_DIR:-/var/www/crm}"
APP_USER="${APP_USER:-ubuntu}"
DB_NAME="${DB_NAME:-crm}"
DB_USER="${DB_USER:-crm}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m !\033[0m %s\n' "$1"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/setup-server.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
say "System packages"
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib nginx certbot python3-certbot-nginx git ufw curl ca-certificates

if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  say "Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
say "Firewall"
# ---------------------------------------------------------------------------
# Postgres is never exposed — the app talks to it over localhost.
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | head -6

# ---------------------------------------------------------------------------
say "PostgreSQL"
# ---------------------------------------------------------------------------
systemctl enable --now postgresql

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  echo "Role ${DB_USER} already exists — leaving its password alone."
  DB_PASSWORD=""
else
  DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
  sudo -u postgres psql -q <<SQL
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
SQL
  echo "Created role ${DB_USER}."
fi

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "Database ${DB_NAME} already exists."
else
  sudo -u postgres psql -q <<SQL
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
SQL
  sudo -u postgres psql -q -d "${DB_NAME}" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ${DB_USER};
SQL
  echo "Created database ${DB_NAME}."
fi

# Tuning for a 2 GB instance. Postgres defaults assume a dedicated machine.
PG_CONF="$(sudo -u postgres psql -tAc 'SHOW config_file')"
if ! grep -q '# insurance-crm tuning' "$PG_CONF"; then
  cat >> "$PG_CONF" <<'CONF'

# insurance-crm tuning (2 GB instance shared with the app)
shared_buffers = 512MB
effective_cache_size = 1GB
work_mem = 8MB
maintenance_work_mem = 128MB
max_connections = 50
CONF
  systemctl restart postgresql
  echo "Applied tuning to $PG_CONF"
fi

# ---------------------------------------------------------------------------
say "Application directory"
# ---------------------------------------------------------------------------
mkdir -p "$APP_DIR"
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
mkdir -p /var/backups/crm
chown "${APP_USER}:${APP_USER}" /var/backups/crm

# ---------------------------------------------------------------------------
say "systemd services"
# ---------------------------------------------------------------------------
write_unit() {
  local name="$1" desc="$2" exec="$3"
  cat > "/etc/systemd/system/${name}.service" <<UNIT
[Unit]
Description=${desc}
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${exec}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
UNIT
  echo "Wrote /etc/systemd/system/${name}.service"
}

write_unit crm-web    "Insurance CRM (web)"    "/usr/bin/npm start"
write_unit crm-worker "Insurance CRM (worker)" "/usr/bin/npm run worker"
systemctl daemon-reload

# ---------------------------------------------------------------------------
say "nginx"
# ---------------------------------------------------------------------------
cat > /etc/nginx/sites-available/crm <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    # Client documents can be large photos.
    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ---------------------------------------------------------------------------
say "Done"
# ---------------------------------------------------------------------------
cat <<SUMMARY

Server is provisioned. What is NOT done yet, and why:

  .env          needs your credentials — write it yourself (see docs/DEPLOYMENT.md)
  build + seed  needs .env first
  HTTPS         needs ${DOMAIN} to resolve to this server first

Next:

  1. Point ${DOMAIN} at this server's static IP, then wait for DNS.
  2. Put the code in ${APP_DIR} and create ${APP_DIR}/.env
  3. bash scripts/deploy.sh --first-run
  4. sudo certbot --nginx -d ${DOMAIN}

SUMMARY

if [[ -n "$DB_PASSWORD" ]]; then
  cat <<CREDS
Database password — copy this into DATABASE_URL now, it is not shown again:

  DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public

CREDS
fi
