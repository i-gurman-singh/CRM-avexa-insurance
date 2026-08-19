# Deployment — AWS Lightsail

Target: one Lightsail instance running the web app, the background worker and
PostgreSQL, with client documents in S3, serving **https://crm.avexainsurance.ca**.

**Instance size:** 2 GB RAM / 2 vCPU minimum. Postgres and the Node build
together will not fit comfortably on the 1 GB plan.

---

## Where the environment variables go

**One file: `/var/www/crm/.env` on the server.** That is the only place
credentials live. There is no second config file, no dashboard, no secrets in
the database.

Three things read it, all from that one path:

| Reads it | How |
|---|---|
| The web app | Next.js loads `.env` automatically |
| The background worker | `src/lib/load-env.ts`, imported first |
| systemd | `EnvironmentFile=/var/www/crm/.env` in both units |

Rules that matter:

- `chmod 600 .env` — it holds every credential you have. `scripts/deploy.sh`
  fixes this automatically if it drifts.
- It is in `.gitignore`. **Never commit it.** `.env.example` is the template.
- Format is `KEY=value`, one per line, no spaces around `=`, no quotes needed
  unless the value contains a space. `#` starts a comment.
- **Restart both services after editing** — nothing is re-read at runtime:
  ```bash
  sudo systemctl restart crm-web crm-worker
  ```
- Every value is validated at boot. A missing or malformed one fails
  immediately with a readable message, rather than surfacing as a confusing
  error an hour later.

### What goes where

| Variable | Value | Where to get it |
|---|---|---|
| `APP_URL` | `https://crm.avexainsurance.ca` | — |
| `NEXTAUTH_URL` | `https://crm.avexainsurance.ca` | — |
| `NEXTAUTH_SECRET` | 32 random bytes | `openssl rand -base64 32` |
| `DATABASE_URL` | `postgresql://crm:PASSWORD@localhost:5432/crm?schema=public` | printed by `setup-server.sh` |
| **WhatsApp** | | |
| `WHATSAPP_PROVIDER` | `360dialog` | — |
| `DIALOG360_API_KEY` | your API key | 360dialog hub → your number → API key |
| `DIALOG360_PHONE_NUMBER` | your WABA number, E.164 | 360dialog hub |
| `WHATSAPP_WEBHOOK_TOKEN` | random secret | `openssl rand -hex 32` — you invent this, then put it in the webhook URL |
| `WHATSAPP_WEBHOOK_SECRET` | signing secret, optional | 360dialog hub, only if your plan signs payloads |
| **AI** | | |
| `AI_PROVIDER` | `openai` | — |
| `OPENAI_API_KEY` | `sk-…` | platform.openai.com → API keys |
| **Documents** | | |
| `STORAGE_PROVIDER` | `s3` | — |
| `AWS_REGION` | `ca-central-1` | keep Canadian client data in Canada |
| `S3_BUCKET` | `avexa-crm-documents` | the bucket you create in step 4 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | scoped IAM key | IAM → the user you create in step 4 |
| **Jobs** | | |
| `QUEUE_PROVIDER` | `database` | SQS is optional; Postgres is enough |
| **Safety** | | |
| `AUTOMATION_OUTBOUND_ENABLED` | `false` at first | leave off until you have read a week of drafted messages |

---

## 1. Create the instance

In the Lightsail console:

1. **Create instance** → Linux/Unix → **Ubuntu 24.04 LTS** → **2 GB RAM plan**.
2. Name it something like `avexa-crm`.
3. Once running: **Networking → Attach static IP**. Note the IP.
4. **Networking → IPv4 Firewall** — allow only:
   - SSH (22)
   - HTTP (80)
   - HTTPS (443)

   Do not open 5432. Postgres is reached over localhost only.

---

## 2. Point the domain

At whoever hosts DNS for `avexainsurance.ca`, add:

```
Type: A     Name: crm     Value: <your static IP>     TTL: 300
```

Check it before continuing — certbot will fail otherwise:

```bash
dig +short crm.avexainsurance.ca
```

---

## 3. Provision the server

```bash
ssh ubuntu@<your-static-ip>

# Get the code onto the server
sudo mkdir -p /var/www/crm && sudo chown ubuntu:ubuntu /var/www/crm
git clone <your-github-repo-url> /var/www/crm
cd /var/www/crm

# Installs Node 22, PostgreSQL, nginx, certbot; creates the database;
# writes both systemd units and the nginx site; enables the firewall.
sudo bash scripts/setup-server.sh
```

**Copy the `DATABASE_URL` it prints at the end.** It contains a generated
password and is not shown again.

---

## 4. AWS: S3 bucket for documents

From your laptop with the AWS CLI, or in the S3 console.

```bash
aws s3api create-bucket --bucket avexa-crm-documents --region ca-central-1 \
  --create-bucket-configuration LocationConstraint=ca-central-1

# Not optional. Client licences and void cheques must never be public.
aws s3api put-public-access-block --bucket avexa-crm-documents \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

aws s3api put-bucket-encryption --bucket avexa-crm-documents \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Versioning means an accidental delete is recoverable.
aws s3api put-bucket-versioning --bucket avexa-crm-documents \
  --versioning-configuration Status=Enabled
```

Then create an IAM user (**no console access**, programmatic only) with exactly
this policy and nothing more:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::avexa-crm-documents",
      "arn:aws:s3:::avexa-crm-documents/*"
    ]
  }]
}
```

Save its access key and secret — they go in `.env` next.

---

## 5. Write `.env`

```bash
cd /var/www/crm
cp .env.example .env
chmod 600 .env
nano .env
```

A complete production file for you:

```bash
NODE_ENV=production
APP_URL=https://crm.avexainsurance.ca
PORT=3000

DATABASE_URL=postgresql://crm:PASTE_PASSWORD_HERE@localhost:5432/crm?schema=public

NEXTAUTH_SECRET=PASTE_OUTPUT_OF_openssl_rand_base64_32
NEXTAUTH_URL=https://crm.avexainsurance.ca
SESSION_MAX_AGE=28800

# --- WhatsApp -------------------------------------------------------------
WHATSAPP_PROVIDER=360dialog
DIALOG360_API_KEY=PASTE_FROM_360DIALOG_HUB
DIALOG360_BASE_URL=https://waba-v2.360dialog.io
DIALOG360_PHONE_NUMBER=+1XXXXXXXXXX
WHATSAPP_WEBHOOK_TOKEN=PASTE_OUTPUT_OF_openssl_rand_hex_32
WHATSAPP_WEBHOOK_SECRET=

# --- AI -------------------------------------------------------------------
AI_PROVIDER=openai
OPENAI_API_KEY=sk-PASTE_YOUR_KEY
OPENAI_MODEL_TEXT=gpt-4o-mini
OPENAI_MODEL_VISION=gpt-4o
AI_AUTO_APPLY_MIN_CONFIDENCE=0.85
AI_DOCUMENT_AUTO_APPLY_MIN_CONFIDENCE=0.9

# --- Documents ------------------------------------------------------------
STORAGE_PROVIDER=s3
AWS_REGION=ca-central-1
S3_BUCKET=avexa-crm-documents
AWS_ACCESS_KEY_ID=PASTE_IAM_KEY
AWS_SECRET_ACCESS_KEY=PASTE_IAM_SECRET
S3_SIGNED_URL_TTL=300

# --- Background jobs ------------------------------------------------------
QUEUE_PROVIDER=database
WORKER_BATCH_SIZE=10
WORKER_POLL_INTERVAL_MS=2000
WORKER_MAX_ATTEMPTS=5

# --- Safety switch --------------------------------------------------------
# Leave false until you have watched the drafted messages for a week.
AUTOMATION_OUTBOUND_ENABLED=false

LOG_LEVEL=info
```

Generate the two secrets:

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # WHATSAPP_WEBHOOK_TOKEN
```

---

## 6. Build and start

```bash
cd /var/www/crm
bash scripts/deploy.sh --first-run
```

This installs dependencies, generates the database client, applies migrations,
seeds the reference data (pipeline stages, insurers, document types — the CRM
cannot run without them), builds, and starts both services.

`--first-run` seeds reference data only. Demo clients are skipped in production.

Then create your first administrator — the seeded demo accounts are not for
production:

```bash
npm run db:seed          # creates the four demo users if you want them
```

Or better, create a real one and delete the demo accounts from
**Settings → Users** once you can sign in.

---

## 7. HTTPS

```bash
sudo certbot --nginx -d crm.avexainsurance.ca
```

Choose redirect-to-HTTPS when asked. Renewal is automatic.

Verify:

```bash
curl https://crm.avexainsurance.ca/api/health
```

You should see `"status":"ok"` and the providers you configured. If it says
`"whatsapp":"mock"` you edited the wrong file or forgot to restart.

---

## 8. Connect WhatsApp

In the [360dialog hub](https://hub.360dialog.com), set the webhook URL to —
with your real token from `.env`:

```
https://crm.avexainsurance.ca/api/webhooks/whatsapp?token=YOUR_WHATSAPP_WEBHOOK_TOKEN
```

Then message your business number from your own phone. Within a second or two
a lead should appear on the dashboard.

If nothing arrives:

```bash
sudo journalctl -u crm-web -n 50      # 401 means the token does not match
sudo journalctl -u crm-worker -n 50   # AI and media processing
```

---

## 9. Backups

```bash
cat > /var/www/crm/scripts/backup.sh <<'EOF'
#!/bin/bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
pg_dump "$DATABASE_URL" | gzip > "/var/backups/crm/crm-$STAMP.sql.gz"
find /var/backups/crm -name 'crm-*.sql.gz' -mtime +14 -delete
aws s3 cp "/var/backups/crm/crm-$STAMP.sql.gz" "s3://avexa-crm-backups/" || true
EOF
chmod +x /var/www/crm/scripts/backup.sh

# 02:30 nightly
(crontab -l 2>/dev/null; echo "30 2 * * * set -a; . /var/www/crm/.env; set +a; /var/www/crm/scripts/backup.sh") | crontab -
```

Also enable automatic Lightsail snapshots. **Test a restore before you need
one** — an untested backup is a hope, not a backup. Documents are already
versioned in S3.

---

## Everyday operations

```bash
# Deploy an update
cd /var/www/crm && bash scripts/deploy.sh

# Change a credential
nano /var/www/crm/.env
sudo systemctl restart crm-web crm-worker

# Watch logs
sudo journalctl -u crm-web -f
sudo journalctl -u crm-worker -f

# Is it healthy?
curl -s https://crm.avexainsurance.ca/api/health

# Database console
psql "$DATABASE_URL"
```

The **Settings → Background jobs** screen shows anything that failed
permanently, with the error and a retry button. Check it occasionally.

---

## Go-live checklist

- [ ] `NEXTAUTH_SECRET` is 32 random bytes, not the example value
- [ ] `WHATSAPP_WEBHOOK_TOKEN` is random and matches the URL in the 360dialog hub
- [ ] `/var/www/crm/.env` is `chmod 600`
- [ ] S3 bucket: public access blocked, encryption on, versioning on
- [ ] IAM key scoped to that one bucket, no console access
- [ ] Firewall allows 22/80/443 only; Postgres on localhost
- [ ] HTTPS working, certificate auto-renewing
- [ ] `crm-worker` is `active` — without it, media and AI processing never run
- [ ] Demo accounts deleted; real staff created with the narrowest role that works
- [ ] Demo clients removed (they carry the `demo` tag)
- [ ] Backups running, and a restore tested
- [ ] `AUTOMATION_OUTBOUND_ENABLED=false` until the drafted messages look right

---

## If something goes wrong

| Symptom | Check |
|---|---|
| Site does not load | `systemctl status crm-web`, then `journalctl -u crm-web -n 50` |
| "Invalid environment configuration" | The message names the variable. Fix `.env`, restart. |
| WhatsApp messages not arriving | Webhook token matches? `journalctl -u crm-web` for 401s |
| Messages arrive, nothing happens after | `systemctl status crm-worker` — it is probably not running |
| Documents will not download | S3 credentials and bucket name; `curl /api/health` |
| Certificate expired | `sudo certbot renew --dry-run` |
| Out of disk | `df -h`; old backups in `/var/backups/crm`, journal logs |
