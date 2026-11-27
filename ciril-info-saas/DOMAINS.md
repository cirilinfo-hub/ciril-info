# Selling domains with ResellerClub

With `REGISTRAR_PROVIDER=resellerclub`, domain searches go to ResellerClub, and once a customer has paid, the worker registers,
renews or transfers the name in **your** ResellerClub reseller account by itself. Each order is paid from the reseller account's
funds (the API places it with `invoice-option=NoInvoice`, so ResellerClub never bills your customer), so the customer's payment to
you and your payment to ResellerClub are separate. Keep the reseller account topped up, or orders are refused and handed to staff.

ResellerClub also tells the site what it charges you for each ending, so **Admin > Domain prices > Import purchase prices >
Fetch prices** fills in your purchase prices, and you import them with your markup (for example 5%).

Without it (`rdap` or `mock`), every paid order is a task for staff, who do it by hand at the registrar, and purchase prices are
pasted from the registrar's price sheet.

## 1. Set up the reseller account

1. Sign up as a reseller at resellerclub.com and finish their verification. Choose **INR** as the selling currency: purchase
   prices are fetched in the account's currency and the site sells in rupees.
2. Add funds (the account is prepaid).
3. In the reseller control panel, create **one customer account** for CirilInfo (for example "CirilInfo Domains"). Every domain
   sold on the site is held under it; each domain's legal owner (registrant) is its own contact, made from the customer's
   details. Note its numeric **customer id**.
4. Optional: set that customer's default nameservers, used when `REGISTRAR_NAMESERVERS` is empty.

## 2. API access

1. In the reseller panel open **Settings > API**. Note your **reseller id** (auth-userid) and create an **API key**.
2. Add this server's IP address (**187.127.158.18**) to the API's allowed IP list. Calls from any other address are refused.
3. Put the values in the server's `.env` only. Never paste them into chat, git, a ticket or a screenshot.

```
REGISTRAR_PROVIDER=resellerclub
RESELLERCLUB_ENV=test             # live when you go live
RESELLERCLUB_RESELLER_ID=...
RESELLERCLUB_API_KEY=...
RESELLERCLUB_CUSTOMER_ID=...      # the customer account from step 1.3 (a number)
REGISTRAR_NAMESERVERS=ns1.yourhost.com,ns2.yourhost.com   # optional: your hosting server's nameservers
REGISTRAR_MAX_YEARLY_COST=5000    # rupees a year; dearer endings go to staff
```

The API and the worker both need these settings; restart both after changing them. Production refuses to start with
`RESELLERCLUB_ENV=test`, because the test environment never buys anything.

## 3. Try it on the test environment first

ResellerClub runs a separate test system (test.httpapi.com) with its own test reseller account (ask ResellerClub support for
one, or use the demo credentials they give). This adapter was built against ResellerClub's HTTP API and tested against a
**pretend** ResellerClub only, so run through this before going live:

1. **Admin > Launch checklist**: the Domain registrar line says ResellerClub's test environment is connected.
2. **Admin > Domain prices > Import purchase prices > Fetch prices** for `com, in`: the price sheet fills with your cost prices.
3. As a test customer with a phone number (Organisation) and a billing address, order a domain and pay. Within a minute
   **Admin > Domains** shows it Active, with ResellerClub's order id as Ref, and the customer is emailed.
4. Renew it from the customer's Domains page and pay: the new end date is shown.
5. Change its nameservers, ask for a transfer code (transfer away), and withdraw it.

Report anything that fails with the message shown in Admin > Domains.

## Purchase prices

**Fetch prices** asks ResellerClub for your reseller cost of one year (register, renew, transfer) for each ending you list.
Nothing is saved until you press Import, so you can check the figures and set the markup first. Endings ResellerClub does not
sell, or has no price for, are listed and left out. If the transfer price is missing, the register price is used.

**Daily update.** Once a day the worker asks ResellerClub for the cost of every ending in your list (samples excepted) and
stores it as the purchase price. Endings on a markup get new selling prices worked out from it; endings priced by hand keep
their selling prices and only their purchase price changes. Staff who manage domains get a notice listing what changed, and,
if ResellerClub cannot be asked, one alert a day with the reason. Admin > Domain prices shows when it last ran and has **Update
now**. Every run is in the audit log (`tld.cost_sync`, `tld.cost_sync_failed`). Turn it off with `REGISTRAR_PRICE_SYNC=off`.

Prices change on your website the moment the update runs. A customer who already has an unpaid invoice keeps that invoice's
price.

## What happens to an order

| Situation | What the site does |
| --- | --- |
| Paid registration, renewal or transfer | Placed at ResellerClub by the worker within about a minute. The customer is told. |
| ResellerClub busy or unreachable | Tried again automatically for about 20 minutes, then handed to staff. |
| A person must fix something: no phone number, the name has gone, the code is wrong, no funds, access refused | Handed to staff at once, with ResellerClub's reason. It shows in red in Admin > Domains. |
| An ending dearer than `REGISTRAR_MAX_YEARLY_COST` a year | Not bought. Handed to staff with the price. |
| Transfer started | The customer approves it with their old registrar. The worker checks every 10 minutes and marks it transferred when it arrives. |

Staff fix the cause (for example, ask the customer to add a phone number, or top up the reseller account) and press **Try at
registrar** on the domain, or do it by hand in the ResellerClub panel and use **Mark registered** / **Mark renewed** / **Mark
transferred** as before. If a domain was refused for good, use **Can't register** and refund the invoice.

A retry never pays twice: before buying or renewing, the site asks ResellerClub what the account already holds, and records that
instead. A renewal also sends the current end date, which ResellerClub checks, so the same renewal cannot be placed twice.

## Registrant details

The customer's organisation is the registrant (the legal owner): the owner's name, the organisation name (or "N A" for a
person), the billing email, the organisation phone (or the owner's), and the default billing address. A new contact is made for
each registration and used for all four roles (registrant, admin, technical, billing). Have your lawyer check that your terms
of service cover registering domains on the customer's behalf.

Privacy protection is not bought, and auto-renew at ResellerClub is off: renewals are invoiced to the customer first.

Some endings have extra registry rules (for example .us, .eu, .uk, .ca). ResellerClub refuses an order that does not meet them,
and it goes to staff with the reason. .com, .net, .org, .in and .co.in need nothing extra.

## Transfer away

A customer can move an active domain to another registrar from their Domains page (not within 60 days of it being registered
or transferred, which registries forbid). The worker removes ResellerClub's theft protection (the transfer lock) and stores the
domain's authorisation code; the customer is emailed that the code is ready and reads it in their client area. When the domain
leaves the account, it is marked Transferred away automatically. If the customer withdraws, the lock is put back. Without
automation, staff unlock it by hand, enter the code with **Enter code**, and use **Mark transferred away** once it has gone.

## Nameservers

A customer can point an active domain at other nameservers from their Domains page (for example a website builder's), or
back to yours with **Use our nameservers** (the ones in `REGISTRAR_NAMESERVERS`). The list is checked first: two to thirteen
valid names, and none inside the domain itself (those need glue records, which staff set up by hand). The worker makes
the change at ResellerClub and the customer is emailed. Without automation, or if ResellerClub refuses (for example the domain is
not in your account), staff get a task, change them by hand, and use **Mark changed**, or **Can't change** with a reason
the customer sees. A change can be withdrawn until it has been made.

## Contact details

A customer can change an active domain's contact details from their Domains page. The form starts from what is on record, or
the organisation's details, and warns first: changing the name, organisation or email is a change of owner under ICANN's rules,
so the registry may email the old and new addresses to confirm it, and the domain may not be transferable for 60 days. The
customer must tick that they understand. The worker makes a new contact at ResellerClub, sets it for all four roles, and the
owners are emailed (also as a security notice). Without automation, or if ResellerClub refuses, staff see the new details in
**Admin > Domains**, set them by hand and press **Mark changed**, or **Can't change contacts** with a reason.
