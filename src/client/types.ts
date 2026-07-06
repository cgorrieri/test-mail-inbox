/** A parsed email as returned by the mailbox API list/get endpoints. */
export interface MailMessage {
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  bodyText?: string;
  bodyHtml?: string;
}

/** Connection settings for a deployed test-inbox stack. */
export interface MailboxConfig {
  /** API Gateway base URL, e.g. https://xxx.execute-api.eu-west-1.amazonaws.com/prod */
  apiUrl: string;
  /** API Gateway key value, sent as the `x-api-key` header. */
  apiKey: string;
  /** Receiving subdomain, e.g. test-mail.powershelter.com */
  subdomain: string;
}

/** Options controlling how {@link Mailbox.waitForMessage} polls. */
export interface WaitOptions {
  /** Give up after this many milliseconds (default 30000). */
  timeoutMs?: number;
  /** Delay between polls in milliseconds (default 2000). */
  intervalMs?: number;
  /** Only resolve on a message matching this predicate (e.g. by subject/sender). */
  match?: (message: MailMessage) => boolean;
}
