/**
 * Razorpay's hosted checkout. Card, UPI and bank details are typed into Razorpay's own window, so they never reach
 * our page or our server. We only receive the three values it hands back, which our API verifies by signature.
 */
export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface CheckoutParams {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  description: string;
  name: string;
  prefillEmail?: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { email?: string };
  handler: (r: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void;
}
type RazorpayCtor = new (o: RazorpayOptions) => RazorpayInstance;

const SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<RazorpayCtor> | null = null;

function loadScript(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  loading ??= new Promise<RazorpayCtor>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error('Razorpay did not load')));
    el.onerror = () => {
      loading = null; // allow a retry
      reject(new Error('Razorpay could not be loaded'));
    };
    document.head.appendChild(el);
  });
  return loading;
}

export type CheckoutResult = { kind: 'paid'; payment: RazorpaySuccess } | { kind: 'dismissed' } | { kind: 'failed'; reason: string };

/** Opens the checkout window and resolves when the customer pays, closes it, or the payment fails. */
export async function openRazorpayCheckout(p: CheckoutParams): Promise<CheckoutResult> {
  const Razorpay = await loadScript();
  return new Promise<CheckoutResult>((resolve) => {
    const rzp = new Razorpay({
      key: p.keyId, order_id: p.orderId, amount: p.amountPaise, currency: p.currency, name: p.name, description: p.description,
      prefill: p.prefillEmail ? { email: p.prefillEmail } : undefined,
      handler: (payment) => resolve({ kind: 'paid', payment }),
      modal: { ondismiss: () => resolve({ kind: 'dismissed' }) },
    });
    // A declined card is reported here but the customer may retry inside the window, so it only ends the flow if they close it.
    rzp.on('payment.failed', () => undefined);
    rzp.open();
  });
}
