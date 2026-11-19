/** Transactional emails. Each template gets exactly the data it renders — nothing more. */
export type EmailMessage =
  | { template: 'verify-email'; to: string; data: { firstName: string; link: string } }
  | { template: 'password-reset'; to: string; data: { firstName: string; link: string } }
  | { template: 'password-changed'; to: string; data: { firstName: string } }
  | { template: 'account-exists'; to: string; data: { firstName: string; loginLink: string; resetLink: string } }
  | { template: 'invitation'; to: string; data: { inviterName: string; organisation: string; roleName: string; link: string } }
  | { template: 'staff-invitation'; to: string; data: { inviterName: string; roleName: string; link: string } }
  | { template: 'mfa-enabled'; to: string; data: { firstName: string } }
  | { template: 'renewal-invoice'; to: string; data: { number: string; total: string; dueDate: string; link: string } }
  | { template: 'ticket-reply'; to: string; data: { firstName: string; ref: string; subject: string; link: string } }
  | { template: 'new-sign-in'; to: string; data: { firstName: string; when: string; ip: string; device: string } };

export const EMAIL_SEND_EVENT = 'email.send';
