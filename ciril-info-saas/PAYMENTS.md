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

## Refunds

Staff with refund permission refund from the invoice. With Razorpay this calls Razorpay's refund API; Razorpay returns the money to the customer's original payment method on its own schedule. A refused refund (for example, insufficient balance) shows Razorpay's reason and records nothing. Every successful refund also issues a GST credit note.

## Keeping it safe

- The webhook address is public by necessity. The **signature** is the protection: anything not signed with your webhook secret is rejected without being read.
- Secrets exist only in the server `.env`. They are not sent to the browser, not logged, and not stored in the database.
- Every verified webhook is stored once (by Razorpay's event id), so a repeated delivery changes nothing.
- All amounts are handled in paise. A mismatch is never recorded as paid.

## Not built yet

- Stripe.
- Saved cards, automatic charging at renewal (renewals are invoiced and paid by the customer).
- Partial payments of one invoice.
- Disputes and chargebacks handling (they arrive as events we currently record but do not act on).
