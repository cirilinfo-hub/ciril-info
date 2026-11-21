/** Transactional emails. Each template gets exactly the data it renders — nothing more. */
export type EmailMessage =
  | { template: 'verify-email'; to: string; data: { firstName: string; link: string } }
  | { template: 'password-reset'; to: string; data: { firstName: string; link: string } }
  | { template: 'password-changed'; to: string; data: { firstName: string } }
  | { template: 'account-exists'; to: string; data: { firstName: string; loginLink: string; resetLink: string } }
  | { template: 'invitation'; to: string; data: { inviterName: string; organisation: string; roleName: string; link: string } }
  | { template: 'staff-invitation'; to: string; data: { inviterName: string; roleName: string; link: string } }
  | { template: 'mfa-enabled'; to: string; data: { firstName: string } }
  | { template: 'hosting-ready'; to: string; data: { domain: string; link: string } }
  | { template: 'domain-registered'; to: string; data: { domain: string; link: string } }
  | { template: 'domain-transferred'; to: string; data: { domain: string; expiresOn: string; link: string } }
  | { template: 'domain-transfer-code'; to: string; data: { domain: string; link: string } }
  | { template: 'domain-transferred-out'; to: string; data: { domain: string; link: string } }
  | { template: 'domain-nameservers-changed'; to: string; data: { domain: string; nameservers: string; link: string } }
  | { template: 'domain-renewed'; to: string; data: { domain: string; expiresOn: string; link: string } }
  | { template: 'domain-expiring'; to: string; data: { domain: string; when: string; link: string } }
  | { template: 'renewal-invoice'; to: string; data: { number: string; total: string; dueDate: string; link: string; autoPay?: { card: string; date: string } } }
  | { template: 'autopay-succeeded'; to: string; data: { number: string; total: string; card: string; link: string } }
  | { template: 'autopay-failed'; to: string; data: { number: string; total: string; card: string; reason: string; retry: boolean; link: string } }
  | { template: 'ticket-reply'; to: string; data: { firstName: string; ref: string; subject: string; link: string } }
  | { template: 'new-sign-in'; to: string; data: { firstName: string; when: string; ip: string; device: string } };

export const EMAIL_SEND_EVENT = 'email.send';
