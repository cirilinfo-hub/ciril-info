# Selling domains with GoDaddy

With `REGISTRAR_PROVIDER=godaddy`, domain searches go to GoDaddy, and once a customer has paid, the worker registers, renews or
transfers the name in **your** GoDaddy account by itself. GoDaddy charges your account's payment method for each order, so the
customer's payment to you and your payment to GoDaddy are separate. Keep the GoDaddy payment method funded (for example with Good
as Gold), or orders will be refused and handed to staff.

Without it (`rdap` or `mock`), every paid order is a task for staff, who do it by hand at the registrar.

## 1. Check that your GoDaddy account can use the API

GoDaddy limits who may use its production domain API. Its published rules have required a minimum number of domains in the
account, or a Discount Domain Club plan, for the availability and management APIs. Check the current terms at
developer.godaddy.com before you rely on it. If searches are refused, the site answers them from the public registry instead
(RDAP), so the search box keeps working. Orders that GoDaddy refuses go to staff with GoDaddy's reason.

GoDaddy's **test environment (OTE)** has no such limit and buys nothing. Use it first.

## 2. Create the API keys

1. Sign in at developer.godaddy.com, open **API Keys**, and create a key for **OTE** (test). Later, create a separate key for
   **Production**.
2. Put the key and secret in the server's `.env` only. Never paste them into chat, git, a ticket or a screenshot.

```
REGISTRAR_PROVIDER=godaddy
GODADDY_ENV=ote               # production when you go live
GODADDY_API_KEY=...
GODADDY_API_SECRET=...
GODADDY_NAMESERVERS=ns1.yourhost.com,ns2.yourhost.com   # optional: your WHM server's nameservers
GODADDY_MAX_YEARLY_COST=50    # in your GoDaddy account's currency
```

The API and the worker both need these settings; restart both after changing them.

Production refuses to start with `GODADDY_ENV=ote`, because OTE never buys anything.

## 3. Try it on OTE

1. Open **Admin > Launch checklist**. The Domain registrar line says GoDaddy's test environment is connected.
2. As a test customer with a phone number (Organisation) and a billing address, order a domain and pay.
3. Within a minute **Admin > Domains** shows it Active, with GoDaddy's order number as Ref, and the customer is emailed.
4. Renew it from the customer's Domains page and pay. It is renewed at GoDaddy and the new end date is shown.

## What happens to an order

| Situation | What the site does |
| --- | --- |
| Paid registration, renewal or transfer | Placed at GoDaddy by the worker within about a minute. The customer is told. |
| GoDaddy busy or unreachable | Tried again automatically for about 20 minutes, then handed to staff. |
| A person must fix something: no phone number, the name has gone, the code is wrong, no funds, access refused | Handed to staff at once, with GoDaddy's reason. It shows in red in Admin > Domains. |
| Premium name dearer than `GODADDY_MAX_YEARLY_COST` a year | Not bought. Handed to staff with the price. |
| Transfer started | The customer approves it with their old registrar. The worker checks every 10 minutes and marks it transferred when it arrives. |

Staff fix the cause (for example, ask the customer to add a phone number) and press **Try at registrar** on the domain, or do it
by hand at GoDaddy and use **Mark registered** / **Mark renewed** / **Mark transferred** as before. If a domain or price was
refused for good, use **Can't register** and refund the invoice.

A retry never pays twice: before buying or renewing, the site asks GoDaddy what the account already holds, and records that
instead.

## Registrant details

The customer's organisation is the registrant (the legal owner GoDaddy records): the owner's name, the organisation name, the
billing email, the organisation phone (or the owner's), and the default billing address. The customer's agreement to the
registration terms is sent as the IP address and time of their order. Have your lawyer check that your terms of service cover
registering domains on the customer's behalf.

Privacy (WHOIS masking) is not bought, and GoDaddy's own auto-renew is switched off: renewals are invoiced to the customer first.

## Transfer away

A customer can move an active domain to another registrar from their Domains page (not within 60 days of it being registered
or transferred, which registries forbid). The worker unlocks it at GoDaddy and stores its authorisation code; the customer is
emailed that the code is ready and reads it in their client area. When the domain leaves the GoDaddy account, it is marked
Transferred away automatically. If the customer withdraws, the domain is locked again. Without automation, staff unlock it by
hand, enter the code with **Enter code**, and use **Mark transferred away** once it has gone.

## Nameservers

A customer can point an active domain at other nameservers from their Domains page (for example a website builder's), or
back to yours with **Use our nameservers** (the ones in `GODADDY_NAMESERVERS`). The list is checked first: two to thirteen
valid names, and none inside the domain itself (those need glue records, which staff set up by hand). The worker makes
the change at GoDaddy and the customer is emailed. Without automation, or if GoDaddy refuses (for example the domain is
not in your account), staff get a task, change them by hand, and use **Mark changed**, or **Can't change** with a reason
the customer sees. A change can be withdrawn until it has been made.

## Not built yet

- Changing a domain's contacts (registrant details) from the portal. A registrant change can trigger the registry's
  confirmation emails and a 60-day transfer lock, so it is done by staff at the registrar for now.
- Tried against a pretend GoDaddy only. Do the OTE run above before going live.
