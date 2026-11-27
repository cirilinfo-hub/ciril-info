# Deployment: putting CirilInfo on a server

This is the runbook for the production server (a Hostinger KVM 2 VPS, or any Linux server with Docker). It was written from the files in this repository and tested in parts here (the backup scripts, the database seed, the settings check and the compose file). **The whole procedure has not yet been run on a real server, because there is no server yet.** Treat the first deployment as a rehearsal, take notes, and fix this page where reality differs.

## What runs

Everything runs as containers from `docker-compose.yml`:

| Container | What it does | Open to the internet? |
|---|---|---|
| `nginx` | Serves the website and both portals, and passes `/api` to the API. Holds the TLS certificates. | Yes, ports 80 and 443 only |
| `api` | The application server. | No (nginx reaches it) |
| `worker` | The background jobs: emails, invoices and renewals, hosting set-up, domain reminders. **It must always be running.** | No |
| `postgres` | The database. | No |
| `redis` | The job queue. | No |
| `migrate` | Runs once at each start to bring the database up to date, then stops. | No |

Five addresses point at the one server: `cirilinfo.com`, `www.`, `app.` (customers), `admin.` (staff) and `api.`.

## Before you start

- A VPS with Ubuntu 24.04, 2 CPUs and 8 GB of memory or more, and its public IP address.
- Access to the DNS settings of your domain.
- A **Resend** account with your domain verified (so email is delivered), and its API key. Or **Amazon SES** instead
  (`EMAIL_PROVIDER=ses`): verify your domain in SES (region `ap-south-1` unless you choose another), ask AWS for
  production access (a new SES account is in a "sandbox" that only sends to verified addresses), and create an IAM
  access key allowed only `ses:SendEmail`. Optionally set `AWS_SES_CONFIGURATION_SET` to track bounces and complaints.
- **Razorpay live keys** and the webhook, as in `PAYMENTS.md`.
- Your WHM server's address and an API token, as in `HOSTING.md`. **If you don't have a cPanel server yet, you can still launch:** set `HOSTING_PROVIDER=manual` (your team creates each hosting account by hand and marks the task done) and `DNS_PROVIDER=none` (customers are told DNS editing is not set up yet and asked to contact you). Switch both to `cpanel` once WHM is connected.
- About an hour, and a person who is comfortable typing commands on a server.

## 1. DNS

Create **A records** pointing to the server's IP for `@`, `www`, `app`, `admin` and `api`. Do this at least a day before launch with a short TTL (300), so that changes spread quickly.

If your domain's email is hosted elsewhere, leave its MX records alone. Add the SPF and DKIM records that Resend (or SES) asks for.

## 2. Prepare the server

Sign in as root over SSH, then:

```bash
# 1. Updates and basic protection
apt update && apt -y upgrade
apt -y install ufw fail2ban git certbot
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# 2. Docker
curl -fsSL https://get.docker.com | sh

# 3. Where everything lives
mkdir -p /opt/cirilinfo/backups /var/www/certbot
cd /opt/cirilinfo
git clone <your repository address> .
```

Use SSH keys rather than a password for signing in to the server, and turn password sign-in off (`PasswordAuthentication no` in `/etc/ssh/sshd_config`).

## 3. Settings (`.env`)

```bash
cp infra/env.production.example .env
chmod 600 .env
nano .env
```

Fill in every `CHANGE_ME`. The comments in the file say how to make each secret. Two matter most:

- **`DATA_ENCRYPTION_KEY`** protects two-step sign-in secrets and domain transfer codes. If you lose it, a restored backup cannot read them and every staff member must set up two-step sign-in again. **Keep a copy somewhere safe that is not this server** (a password manager).
- Never put this file in Git, a chat or a screenshot.

The API refuses to start with unsafe settings in production (test-mode payments, the mock hosting or DNS, the local test inbox, and so on), and says which setting is wrong. That is on purpose.

## 4. Build the images

On the server:

```bash
cd /opt/cirilinfo
TAG=$(date +%Y-%m-%d).1
docker build -f infra/docker/api.Dockerfile -t ghcr.io/cirilinfo/api:$TAG .
docker build -f infra/docker/web.Dockerfile -t ghcr.io/cirilinfo/web:$TAG .
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env
```

(If you build somewhere else and push to a registry instead, set `REGISTRY` and `IMAGE_TAG` in `.env` to match and `docker login` on the server.) A build takes several minutes.

## 5. HTTPS certificates

nginx will not start without certificates, so make them first, while nothing else is using port 80:

```bash
certbot certonly --standalone \
  -d cirilinfo.com -d www.cirilinfo.com -d app.cirilinfo.com -d admin.cirilinfo.com -d api.cirilinfo.com \
  --agree-tos -m you@yourdomain.com --no-eff-email
```

The files go to `/etc/letsencrypt/live/cirilinfo.com/`, which is where `infra/nginx/conf.d/cirilinfo.conf` looks. Certificates last 90 days. Set up renewal once:

```bash
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'EOF'
#!/bin/sh
docker compose --env-file /opt/cirilinfo/.env -f /opt/cirilinfo/docker-compose.yml exec -T nginx nginx -s reload
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
certbot renew --dry-run     # should say the simulated renewal succeeded
```

Renewal uses the webroot at `/var/www/certbot`, which nginx serves. If `--dry-run` fails once nginx is running, run `certbot renew --webroot -w /var/www/certbot --dry-run` and change the saved method to webroot in `/etc/letsencrypt/renewal/cirilinfo.com.conf`.

## 6. Start

```bash
cd /opt/cirilinfo
docker compose --env-file .env up -d
docker compose --env-file .env ps          # everything "running" or "healthy"; migrate says "exited (0)"
curl -s https://api.cirilinfo.com/health/ready
```

If the API will not start, look at why:

```bash
docker compose --env-file .env logs --tail 50 api
```

The usual cause is a setting the safety check refused. The message names it.

## 7. Create the first admin

A new database has no roles and no staff, so nobody can sign in yet. Run the seed once. It creates the roles and permissions, the first Super Admin, and the empty product lines. It never creates sample data in production.

```bash
docker compose --env-file .env run --rm \
  -e SEED_SUPERADMIN_EMAIL=you@yourdomain.com \
  -e SEED_SUPERADMIN_PASSWORD='a-long-temporary-password-12+' \
  migrate node dist-seed/prisma/seed.js
```

The password must be at least 12 characters. It is temporary: the first sign-in at `https://admin.cirilinfo.com` forces you to choose a new one and set up two-step verification. The seed is safe to run again (it changes nothing that exists).

## 8. Get the business ready

Sign in to the admin portal and open **Settings > Launch checklist**. It lists what is still missing or in test mode. Work down it:

1. **Company profile**: legal name, GSTIN, address with its GST state, email, phone, and optionally bank details.
2. **Tax rates**: add your GST rate (18%) so invoices carry tax. Have your accountant check the invoice and credit note format.
3. **Products & Pricing**: real plans and prices, with the exact **Panel package** name from WHM on each hosting plan.
4. **Domain prices**: the endings you sell and their prices.
5. **Legal pages**: write and publish privacy, terms, refund, cancellation and SLA, and have a lawyer review them.
6. **Razorpay webhook**: add `https://api.cirilinfo.com/api/v1/webhooks/razorpay` in the Razorpay dashboard (see `PAYMENTS.md`), with the same secret as `RAZORPAY_WEBHOOK_SECRET`.
7. **Staff**: invite the team; everyone sets up two-step verification.

Place a real small order yourself, pay it, and refund it, before you tell anyone the site is live.

## 9. Backups

Back up every night. Nothing else protects you from a disk failure, a mistake, or a bad update.

```bash
chmod +x /opt/cirilinfo/infra/backup/*.sh
crontab -e
# add this line: every day at 02:15 server time
15 2 * * * /opt/cirilinfo/infra/backup/backup.sh >> /var/log/cirilinfo-backup.log 2>&1
```

Each run saves the database and the uploaded files to `/opt/cirilinfo/backups`, checks the database dump can be read back, and removes backups older than 14 days (`KEEP_DAYS`). **A backup on the same disk does not survive the disk.** Copy them to another place: set `RSYNC_TARGET=backup@another-host:/backups/cirilinfo/` in the cron line, or copy the folder to cloud storage with a tool you trust.

Also keep a separate copy of `.env`, above all `DATA_ENCRYPTION_KEY`. It is not in the backups.

### Virus scanning

`docker-compose.yml` runs a `clamav` service and sets `VIRUS_SCAN=clamav`, so every uploaded file (ticket attachments,
website images) is checked before it is kept. An infected file is refused, with the virus name shown to whoever
uploaded it and an `upload.infected` entry in the audit log.

- ClamAV needs about **1.5 GB of memory**; size the server for it (the KVM 2 plan is enough).
- On the first start it downloads its virus signatures, which takes a few minutes. Until it answers, uploads are
  refused with "Files cannot be checked for viruses right now", never kept unchecked. Text-only tickets still work.
- It updates its signatures by itself every few hours (it needs outbound internet, which the `edge` network gives it).
- Check it is working: upload a text file containing the standard EICAR test string as a ticket attachment; it must be
  refused. **Admin > Launch checklist** shows whether scanning is on.
- To turn it off (not recommended), set `VIRUS_SCAN=off` in `.env` and restart the API.

### Uploaded files in S3 (optional)

By default, website images and ticket attachments are kept on the server's disk (a Docker volume) and included in the
backups above. To keep them in a bucket instead, so they survive the server:

1. Create a **private** bucket (Amazon S3 in `ap-south-1`, or an S3-compatible store such as Cloudflare R2). Do not
   make it public: every file is served through the API, which checks who may see it.
2. Create an access key that can only read, write and delete objects in that bucket.
3. Turn on versioning (or the store's own backups) for the bucket. The nightly backup script then only covers the database.
4. Set in the server's `.env`: `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION` (R2: `auto`), `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, and for an S3-compatible store `S3_ENDPOINT` (its `https://` address). `S3_PREFIX` puts
   everything in a folder.
5. **Copy the files you already have before switching**, or old images and attachments will go missing. With the AWS
   CLI: `aws s3 sync /var/lib/docker/volumes/cirilinfo_storage/_data s3://<bucket>/<prefix>/` (the `images/` and
   `tickets/` folders keep their names). Then restart the API.

The S3 driver has been tested against a pretend S3 server only. Upload an image and a ticket attachment once after switching.

**Once a month, prove a backup restores:**

```bash
/opt/cirilinfo/infra/backup/restore-test.sh
```

It restores the newest backup into a throwaway database, checks it holds data and the same tables as the live one, deletes it, and prints `RESTORE TEST PASSED`. It never touches live data.

## 10. Updating

```bash
cd /opt/cirilinfo
git pull
/opt/cirilinfo/infra/backup/backup.sh            # always, before an update
TAG=$(date +%Y-%m-%d).2
docker build -f infra/docker/api.Dockerfile -t ghcr.io/cirilinfo/api:$TAG .
docker build -f infra/docker/web.Dockerfile -t ghcr.io/cirilinfo/web:$TAG .
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env
docker compose --env-file .env up -d
```

Database changes are applied automatically by `migrate` before the API starts. **To go back** to the last release, set `IMAGE_TAG` back and run `up -d` again. That is safe unless the update changed the database; migrations only go forward, so after a bad migration the way back is to restore the backup you took first.

## 11. Disaster recovery

If the server or its disk is lost:

1. Prepare a new server (steps 2 to 5), put back your saved `.env` (with the **same** `DATA_ENCRYPTION_KEY`), and copy the newest backup files onto it.
2. Start only the database: `docker compose --env-file .env up -d postgres`. On a new volume it creates the three database roles itself.
3. Restore into a new database, then switch to it:
   ```bash
   infra/backup/restore.sh /path/to/db-<time>.dump --into cirilinfo_restored
   ```
   Stop the stack, then rename: in `psql`, `ALTER DATABASE cirilinfo RENAME TO cirilinfo_empty;` and `ALTER DATABASE cirilinfo_restored RENAME TO cirilinfo;`.
4. Put the files back: `docker volume create cirilinfo_storage`, then `docker run --rm -v cirilinfo_storage:/data -v /path/to/backups:/b alpine tar xzf /b/files-<time>.tar.gz -C /data`.
5. `docker compose --env-file .env up -d`, sign in, and check the Launch checklist and a recent invoice.

Practise this once on a spare server before you need it.

## 12. Keeping an eye on it

- `docker compose --env-file .env ps`: everything should be running. The `worker` matters most: if it stops, no invoices renew, no hosting is created and no domain reminders go out.
- `docker compose --env-file .env logs --tail 100 -f api worker`
- `df -h`: the disk filling up is the most common way a small server fails.
- Use an outside uptime monitor on `https://cirilinfo.com` and `https://api.cirilinfo.com/health/ready`, and set `SENTRY_DSN` to hear about errors.
- Admin **Settings > Launch checklist** is also a quick health read-out.

## 13. Security checklist

- SSH keys only; the firewall allows 22, 80 and 443 and nothing else.
- `.env` is `chmod 600` and in no repository.
- Postgres and Redis publish no ports (the compose file keeps them on an internal network).
- Open the WHM port (2087) on the cPanel server **only to this server's IP address**.
- Apply system updates regularly (`apt update && apt upgrade`) and reboot when asked.
- Every staff member uses two-step verification (the Launch checklist counts anyone who doesn't).

## Sharing the server with FASTPANEL

The app can run on the same server as FASTPANEL (the panel your customers' websites live on). This is how cirilinfo.com
runs today. Customer websites then share a machine with your billing system: keep FASTPANEL and the server updated, and
move the app to its own server once you can.

FASTPANEL's nginx owns ports 80 and 443, so the app sits behind it:

- **The app's nginx** listens on `127.0.0.1:8080` only, in plain HTTP (`docker-compose.fastpanel.yml`, using
  `infra/nginx/behind-proxy/cirilinfo.conf`). It takes the visitor's address and scheme from FASTPANEL's nginx, so rate
  limits and sign-in protection still see real visitors.
- **FASTPANEL's nginx** handles HTTPS for the five names and forwards them there, from
  `/etc/nginx/sites-enabled/cirilinfo.conf` (`infra/host-nginx/cirilinfo.conf` with `__IPV4__`/`__IPV6__` replaced). It
  listens on the server's own address and port, exactly like FASTPANEL's sites, or nginx never uses it.

Set up once (after steps 1 to 3 above; Docker and certbot are installed the same way):

```bash
cd /opt/cirilinfo
V4=<server IPv4>; V6=<server IPv6>
mkdir -p /etc/nginx/sites-enabled /var/www/certbot
sed -e "s/__IPV4__/$V4/g" -e "s/__IPV6__/$V6/g" infra/host-nginx/cirilinfo.conf > /root/cirilinfo.host.conf
# First only the port-80 block, so certbot can prove the names:
awk '/^server \{/{n++} n==1' /root/cirilinfo.host.conf > /etc/nginx/sites-enabled/cirilinfo.conf
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/certbot --cert-name cirilinfo.com \
  -d cirilinfo.com -d www.cirilinfo.com -d app.cirilinfo.com -d admin.cirilinfo.com -d api.cirilinfo.com
# Then the whole file, and a renewal hook that reloads FASTPANEL's nginx:
cp /root/cirilinfo.host.conf /etc/nginx/sites-enabled/cirilinfo.conf && nginx -t && systemctl reload nginx
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

From then on, **every `docker compose` command uses both files**:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.fastpanel.yml up -d
```

Always run `nginx -t` before reloading FASTPANEL's nginx: a broken file there takes every website on the server down.
Connect the panel itself in Admin > Hosting servers as described in HOSTING.md ("FASTPANEL"). The app's containers reach
it at the server's address on port 8888.

## Email from your own mailbox

Instead of Resend, the app can send from a mailbox on your domain, for example `noreply@cirilinfo.com` made in hPanel >
Emails (which also adds the MX, SPF and DKIM records). In `.env`:

```
EMAIL_PROVIDER=smtp
EMAIL_FROM=CirilInfo <noreply@cirilinfo.com>
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@cirilinfo.com
SMTP_PASSWORD=<the mailbox password>
```

`EMAIL_FROM` must use the mailbox's own address, or the mail server refuses it. The connection is always encrypted. A
mailbox can only send so many emails per hour and day; switch to Resend or Amazon SES if you outgrow it. The Launch
checklist says when the email settings are incomplete, and the API refuses to start in production with Resend chosen but
no key.

## What is still done by hand

Domain **registration, renewal and transfer** happen at your registrar (staff are notified and mark each done). Names are checked against the public registry, so searches are real, but no registrar is connected yet.
