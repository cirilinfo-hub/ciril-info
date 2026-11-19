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

## Not built yet

Plesk, and picking between several servers. Domain registration and DNS are separate (see the README).
