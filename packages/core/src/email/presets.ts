export type RelaySecurity = 'tls' | 'starttls' | 'none';
export interface RelayPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  security: RelaySecurity;
  /** SPF `include:` the provider usually asks for, when it asks for one. The provider's own dashboard is the reference. */
  spfInclude: string | null;
  /** Typical SMTP user name when it is fixed. */
  username?: string;
}

/** Common SMTP relays (host and port are the providers' SMTP endpoints; the exact values are in the provider's dashboard). */
export const RELAY_PRESETS: readonly RelayPreset[] = [
  { id: 'brevo', name: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls', spfInclude: 'spf.brevo.com' },
  { id: 'postmark', name: 'Postmark', host: 'smtp.postmarkapp.com', port: 587, security: 'starttls', spfInclude: null },
  { id: 'ses', name: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, security: 'starttls', spfInclude: 'amazonses.com' },
  { id: 'mailgun', name: 'Mailgun', host: 'smtp.mailgun.org', port: 587, security: 'starttls', spfInclude: 'mailgun.org' },
  { id: 'resend', name: 'Resend', host: 'smtp.resend.com', port: 465, security: 'tls', spfInclude: 'amazonses.com', username: 'resend' },
  { id: 'zoho', name: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'tls', spfInclude: 'zoho.com' },
  { id: 'generic', name: 'SMTP', host: '', port: 587, security: 'starttls', spfInclude: null },
];
export const relayPreset = (id: string | null | undefined) => RELAY_PRESETS.find((p) => p.id === id);
