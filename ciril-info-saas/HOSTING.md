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

Each hosting plan has a **Panel package** field (Admin > Products & Pricing > Edit plan). It must be the **exact name of a package in WHM** (WHM > Packages > List Packages). A plan with no package set fails clearly for staff instead of guessing.

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
Tested against a pretend Plesk only.

## FASTPANEL

FASTPANEL is free and works through the **several servers** setup below (`HOSTING_PROVIDER=servers`): add the FASTPANEL
server in **Admin > Hosting servers** with the panel set to FASTPANEL. Mapped and tested against a real FASTPANEL 8.0 on
Ubuntu 24.04 (create, retry, suspend, restore, plan change, new panel login, removal).

**Keep it on its own server.** FASTPANEL serves customers' websites on ports 80 and 443, as this app does; never install it
on the app's server. On Hostinger, choosing a VPS's "with FASTPANEL" OS template **erases that VPS**.

On the FASTPANEL server, once:

1. **Turn limits on**: FASTPANEL > Settings, switch on limits. Without it no plan can be applied (the set-up goes to staff
   with "Limits are switched off").
2. **Install the Quota application** (FASTPANEL > Applications), so disk sizes are enforced. Until then accounts are made
   without a disk limit, and **Test connection** says "DISK QUOTAS OFF".
3. **Make a limit template per plan** (FASTPANEL > Settings > Limit templates): websites, databases, mail domains,
   mailboxes, FTP accounts. Name it exactly like the plan's **Panel package** in Products & Pricing, e.g. `Starter`.
4. **Make the API token** as root, allowed only from this app's server:
   ```bash
   mogwai users tokens add --name cirilinfo --scopes full --constraint <this app server's IP> --expire_at 2030-12-31
   ```
   Copy the `msg` value: it is the token, shown once. Paste it as the server's API token in Admin > Hosting servers.
   The token acts as the panel's admin user; keep the IP constraint.
5. Port **8888** must be reachable from the app's server. A fresh panel has a self-signed certificate: set the server's TLS
   check to **skip** until the panel has a real certificate (FASTPANEL > Settings > panel certificate), then **verify**.

How it maps:

- Each hosting account is a FASTPANEL user named like the panel username, owning one website for the domain (PHP 8.3,
  PHP-FPM) on the server's shared IP.
- The plan's **Panel package** is the limit template's name. Its **Disk space (GB)** becomes the user's disk quota.
- Suspending disables the FASTPANEL user (websites, mail, FTP and SSH stop); restoring enables it. Removing deletes the
  user with its websites, mail, databases and files.
- FASTPANEL does not email customers their login. In the client area, **Hosting > Control panel login** makes a new password
  and shows it once (the old one stops working; at most 5 an hour; recorded in the audit log, the password never is).
- FASTPANEL administrators (`ROLE_SUPER_ADMIN`, resellers) are never changed or removed by the app.

## Several servers (cPanel, Plesk and FASTPANEL side by side)

With `HOSTING_PROVIDER=servers`, the servers are listed in **Admin > Hosting servers** instead of the `.env` file:

1. A Super Admin adds each server: a name, its address, its shared IPv4, the panel (cPanel/WHM, Plesk or FASTPANEL), the WHM user
   (cPanel), the API token or key, and the most accounts it should hold. The credentials are stored encrypted and never
   shown again; leave them empty when editing to keep the saved ones.
2. Press **Test connection** on each server. The launch checklist stays on "to do" until every active server has
   passed once.
3. A new hosting account goes to the active server with the most room for its size (accounts held compared with its
   limit; a tie goes to the one with fewer accounts). A full server takes no more. If a plan's package exists on only one
   kind of panel, set the plan's **Server type** to cPanel, Plesk or FASTPANEL.
4. The server is recorded on the account before the panel is called, so a retry goes to the same server, and every
   later action (suspend, restore, plan change, removal) goes to the server the account lives on.
5. Set a server to **Maintenance**, **Full** or **Retired** to stop new accounts going there; its existing accounts keep
   working.

If no active server has room, the set-up goes to staff with a reason ("Add a server or raise a server's account limit").
Customer DNS editing still uses the single WHM server in `CPANEL_*` (`DNS_PROVIDER=cpanel`), or set `DNS_PROVIDER=none`.

## Not built yet

Moving an existing account from one server to another. DNS for domains that are registered with us but not hosted on the panel (their DNS lives at the registrar) waits for the registrar adapter.
