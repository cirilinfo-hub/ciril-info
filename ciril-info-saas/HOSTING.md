# Hosting: connecting cPanel/WHM

CirilInfo creates, suspends, restores, re-packages and removes hosting accounts through **WHM's API** (version 1). This page is what you need to do on the server side to turn it on. Nothing here is switched on until you set `HOSTING_PROVIDER=cpanel`.

Until then you can sell hosting in **manual mode** (`HOSTING_PROVIDER=manual`): every set-up becomes a task for your team in Admin > Hosting, who do it in WHM and mark it done.

## What you need

- A server running cPanel & WHM, and access to WHM as `root` or as a **reseller** with the permissions below.
- The app server must be able to reach WHM on **port 2087** (open it for the app server's address only, never for the whole internet).
- A hostname on the WHM server with a valid certificate (WHM's AutoSSL can issue one). If you must use WHM's self-signed certificate for now, set `CPANEL_TLS=skip`, and replace it before real customers.

## 1. Create the API token

In WHM: **Development > Manage API Tokens > Generate Token**.

- Name it `cirilinfo`.
- Give it only what it needs. Tick these privileges and nothing else:
  `create-acct`, `suspend-acct`, `kill-acct`, `upgrade-account` (change an account's package), `list-accts`.
  The names can differ slightly between WHM versions. If a task fails with "refused our API token", a privilege is missing: add it to the token in WHM and use Retry.
- Copy the token when it is shown. WHM never shows it again.

Put it on the **server's `.env` only**. Never paste it in chat, a ticket, git or a screenshot. If it ever leaks, revoke it in WHM and generate a new one.

```
HOSTING_PROVIDER=cpanel
CPANEL_HOST=server.yourdomain.com
CPANEL_PORT=2087
CPANEL_USER=root          # the WHM user the token belongs to
CPANEL_API_TOKEN=...      # the token from above
CPANEL_TLS=verify         # verify | skip (self-signed) | off (tests only; refused in production)
```

Restart the API and the worker after changing these. The API refuses to start if `HOSTING_PROVIDER=cpanel` and any of host, user or token is missing.

## 2. Make the packages match

Each plan has a **Panel package** field (Admin > Products & Pricing). It must be the **exact name of a package in WHM** (WHM > Packages > List Packages). A plan with no package set fails clearly for staff instead of guessing.

## 3. Try it on a test account first

1. Set the plan's panel package to a small test package.
2. Order that plan with a test customer, pay, and set up hosting on a domain you control.
3. Watch Admin > Hosting: the account should go **Active** within about a minute, and appear in WHM > List Accounts.
4. Try **Suspend** and **Restore** from Admin > Hosting and check WHM follows.

## How it behaves

- **The customer's login:** WHM sends its own welcome email (to the customer's billing email) with the control panel details. CirilInfo never sees or stores the password it generates.
- **Safe to repeat:** if WHM created the account but the reply was lost, the retry recognises it and does not create a second one. Suspending or restoring something already in that state counts as done.
- **Retries:** a timeout, an unreachable server or a WHM that says it is busy is retried (1, 2, 4, 8 minutes, then hourly, up to 5 tries). Anything else goes straight to staff with WHM's own words: a wrong token, a package that does not exist, a username used by another account.
- **After fixing the cause** (for example creating the missing package), use **Retry** on the task in Admin > Hosting.
- **Removing** an account also removes its DNS zone.

## DNS records (customers editing their domain's DNS)

Customers can add, change and delete DNS records for a registered domain from **Domains > DNS** in the client area. The zone on the panel is the source of truth: the page always shows what is live, and each change is checked (record type rules, CNAME clashes, duplicates, one TTL per name and type) before it is sent.

To use your WHM server's zones, set `DNS_PROVIDER=cpanel` (it uses the same `CPANEL_*` settings as hosting) and give the API token the DNS zone editing privilege (WHM lists it with the DNS functions). Production refuses `DNS_PROVIDER=mock`.

- The domain's own name servers are shown but cannot be changed. The zone's start-of-authority record is hidden.
- If the domain has no zone on the panel (it is registered with us but not hosted there), the page says DNS is not set up yet and asks the customer to contact you.
- WHM addresses records by line number, and line numbers move when the zone changes, so each record is found again by its content just before it is edited or removed. If someone else changed it first, the customer is asked to reload.
- Long TXT values (such as DKIM keys) are sent as one value and WHM splits them.
- **Not yet tried against a real WHM.** The field names used for each record type follow WHM's zone functions but were only tested against a pretend server. Try adding one record of each type on a test domain before relying on it.

## Plesk instead of cPanel

`HOSTING_PROVIDER=plesk` creates accounts on a Plesk (Obsidian) server through its REST API, which runs Plesk's own
`customer` and `subscription` command-line tools. Each hosting account becomes a Plesk **customer** (login = the panel
username, emailed by Plesk so the customer can sign in and set a password) owning one **subscription** for the domain.

1. On the server, create an API key: `plesk bin secret_key -c -ip-address <your app server's IP> -description cirilinfo`.
2. In Plesk, create **service plans** named exactly like each plan's panel package in Admin > Products & Pricing.
3. Put the values in the server's `.env` only:

   ```
   HOSTING_PROVIDER=plesk
   PLESK_HOST=plesk.yourhost.com
   PLESK_PORT=8443
   PLESK_API_KEY=...
   PLESK_IP=203.0.113.10      # the shared IPv4 new subscriptions go on
   PLESK_TLS=verify           # skip only until the server has a valid certificate
   ```
4. Restart the API and worker, then do a test order as in step 3 above. Suspending switches the subscription's
   webspace off, restoring switches it on, a plan change switches the service plan, and removal deletes the
   subscription and its customer.

DNS editing for customers is built for cPanel only: with Plesk, set `DNS_PROVIDER=none` (DNS is managed in Plesk).
Tested against a pretend Plesk only. Plesk and cPanel cannot be used at the same time yet (that needs choosing between
servers).

## Not built yet

Picking between several servers (and so using cPanel and Plesk side by side). DNS for domains that are registered with us but not hosted on the panel (their DNS lives at the registrar) waits for the registrar adapter.
