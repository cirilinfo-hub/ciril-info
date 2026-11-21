# Payments: how they work and how to switch Razorpay on

Written for whoever runs the Razorpay account and the server. Nothing here needs code changes.

## What is built

- **Test mode (default).** `PAYMENT_PROVIDER=mock` pays instantly and moves no money. The invoice page says "Test mode". The app **refuses to start in production** with this setting.
- **Razorpay.** `PAYMENT_PROVIDER=razorpay`. The customer pays in Razorpay's own window (UPI, card, net banking), so card and bank details never reach our site or server.
- **Stripe.** Not built yet. `PAYMENT_PROVIDER=stripe` is refused with a clear message. The code is organised so Stripe can be added as one more provider without touching billing.

## How a Razorpay payment flows

1. The customer clicks **Pay**. Our server creates a Razorpay *order* for the exact invoice amount and returns only the public key id and the order id.
2. The customer pays in Razorpay's window.
3. Success reaches us **twice**, and either one alone is enough:
   - **The browser** reports the payment. Our server checks Razorpay's signature (made with your key secret), then asks Razorpay for the payment itself. It never trusts the browser for the amount or status.
   - **Razorpay's webhook** calls us, signed with your webhook secret. This is what makes a payment count if the customer closes the tab.
4. Money is recorded **only** after a signature has been verified **and** the order, amount and currency match what we asked for.
5. A job in the worker runs every 10 minutes and asks Razorpay about any payment still waiting after 10 minutes, so a lost webhook cannot leave a paid customer unpaid.
6. A checkout nobody completes is closed after 3 days; the invoice stays payable.

Things that need a person are flagged to staff with billing access (bell in the admin portal, and the audit log):
- a payment whose amount or order does not match,
- money that arrived for an invoice that was already voided or paid (refund it from the invoice).

## Setting it up (test first, always)

1. Create a Razorpay account and finish its onboarding. In the dashboard, switch to **Test mode**.
2. **Settings → API Keys → Generate Test Key.** You get a *Key Id* (`rzp_test_...`) and a *Key Secret*.
3. **Settings → Payment Capture:** set to **Automatic**. (The app also captures an authorised-only payment, but automatic is simpler.)
4. **Settings → Webhooks → Add new webhook**
   - URL: `https://<your API address>/api/v1/webhooks/razorpay` (for example `https://api.cirilinfo.com/api/v1/webhooks/razorpay`)
   - Secret: invent a long random one. This is `RAZORPAY_WEBHOOK_SECRET`.
   - Events: **payment.captured**, **payment.failed**, **order.paid**.
5. Put the values in the **server's `.env` file only**:

   ```
   PAYMENT_PROVIDER=razorpay
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ```

   **Never paste these into chat, an email, a screenshot, git or a support ticket.** If one is ever exposed, regenerate it in the Razorpay dashboard straight away.
6. Restart the API and the worker. Place a test order and pay with Razorpay's test UPI or test cards (listed in their docs).
7. Check: the invoice becomes **Paid**, the subscription becomes **Active**, and the bell shows "Payment received".

### Going live

- Complete Razorpay's KYC and get live mode switched on.
- Generate **Live** keys (`rzp_live_...`) and a **live** webhook with its own secret.
- The app enforces the split for you: a live key is refused outside production, and a test key is refused in production.
- Before taking real money, fill in the **Company profile** (legal name, GSTIN, address with its GST state) so invoices and credit notes carry the seller's details, and have your accountant confirm the invoice and credit note format.
- Do one small real payment and one refund of it yourself first.

## Saved cards and automatic renewal payments

A customer can tick **Save this card and pay renewals automatically** when paying an invoice. They then pay by card in
Razorpay's window, and Razorpay keeps the card (we store only its token id, the network, the last four digits and the
expiry, never the card number). After that:

- Only **renewal invoices** are charged, never a new order. The renewal invoice email names the card, the amount and the
  date of the charge, which is a day before the invoice is due and never sooner than a day after that email.
- A declined charge is tried again once a day, **three times in all**, and the customer is emailed each time with
  Razorpay's reason and a link to pay it themselves. A charge that goes through is confirmed by email.
- An invoice above `CARD_AUTOPAY_MAX_AMOUNT` (₹15,000 by default, the RBI limit for charges without the customer) is
  not charged; the customer is asked once to pay it.
- Under **Invoices**, the customer sees the card, can switch automatic payments off, or remove the card (it is deleted
  at Razorpay too). A card the bank rejects or cancels stops automatic payments and the owner is told.
- A charge's result is settled exactly like any other payment: by Razorpay's webhook, or by the 10-minute lookup if the
  webhook is lost. The same invoice is never charged twice at once.
- Saving a card needs a phone number on the organisation (banks require one for standing instructions).

To switch it on with Razorpay:

1. Ask Razorpay support to enable **Recurring Payments (cards)** on your account. This is not on by default.
2. Add these events to your Razorpay webhook: **token.confirmed**, **token.rejected**, **token.paused**, **token.cancelled**.
3. Set `RAZORPAY_SAVED_CARDS=true` in the server's `.env` (and `CARD_AUTOPAY_MAX_AMOUNT` if you want a lower limit), then
   restart the API and the worker.
4. Test it with Razorpay's test cards for recurring payments before going live.

Ask Razorpay how the advance (pre-debit) notice the RBI requires is handled for your account. Our renewal email gives
the card, amount and date at least a day ahead, but confirm whether Razorpay or the card network must also send one.
In test mode, saved cards always work and the card is a pretend Visa ending 4242.

Tested against a pretend Razorpay only, like the rest of the Razorpay adapter.

## Refunds

Staff with refund permission refund from the invoice. With Razorpay this calls Razorpay's refund API; Razorpay returns the money to the customer's original payment method on its own schedule. A refused refund (for example, insufficient balance) shows Razorpay's reason and records nothing. Every successful refund also issues a GST credit note.

## Keeping it safe

- The webhook address is public by necessity. The **signature** is the protection: anything not signed with your webhook secret is rejected without being read.
- Secrets exist only in the server `.env`. They are not sent to the browser, not logged, and not stored in the database.
- Every verified webhook is stored once (by Razorpay's event id), so a repeated delivery changes nothing.
- All amounts are handled in paise. A mismatch is never recorded as paid.

## Not built yet

- Stripe.
- Saving a card without paying an invoice (a card is saved while paying one).
- Disputes and chargebacks handling (they arrive as events we currently record but do not act on).
