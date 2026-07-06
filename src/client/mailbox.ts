import { randomUUID } from "node:crypto";
import type { MailMessage, MailboxConfig, WaitOptions } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 2_000;

interface ListResponse {
  messages: MailMessage[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A disposable mailbox bound to a single session id.
 *
 * Create one per test for isolation:
 *
 * ```ts
 * const mailbox = new Mailbox(mailboxConfigFromEnv());
 * await signUp(mailbox.address);
 * const code = await mailbox.waitForCode();
 * await mailbox.cleanup();
 * ```
 */
export class Mailbox {
  readonly sessionId: string;
  readonly address: string;
  private readonly cfg: MailboxConfig;

  constructor(cfg: MailboxConfig, sessionId: string = randomUUID()) {
    this.cfg = cfg;
    this.sessionId = sessionId;
    this.address = `${sessionId}@${cfg.subdomain}`;
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.cfg.apiKey };
  }

  private url(path: string): string {
    const base = this.cfg.apiUrl.replace(/\/$/, "");
    return `${base}${path}`;
  }

  /** GET /mailbox/{id}/messages — returns messages newest first. */
  async list(): Promise<MailMessage[]> {
    const res = await fetch(this.url(`/mailbox/${this.sessionId}/messages`), {
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Inbox list failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as ListResponse;
    return data.messages ?? [];
  }

  /**
   * Poll until at least one message (optionally matching `match`) arrives.
   * Throws on timeout so the calling test fails with a clear message.
   */
  async waitForMessage(options: WaitOptions = {}): Promise<MailMessage> {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      intervalMs = DEFAULT_INTERVAL_MS,
      match,
    } = options;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const messages = await this.list();
      const hit = match ? messages.find(match) : messages[0];
      if (hit) return hit;

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for email to ${this.address}`,
        );
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Wait for a message and extract the first N-digit code from its text body.
   * Defaults to 6 digits (a typical OTP).
   */
  async waitForCode(digits = 6, options: WaitOptions = {}): Promise<string> {
    const codePattern = new RegExp(`\\b\\d{${digits}}\\b`);
    const message = await this.waitForMessage({
      ...options,
      match: (m) =>
        (options.match?.(m) ?? true) && codePattern.test(m.bodyText ?? ""),
    });

    const code = message.bodyText?.match(codePattern)?.[0];
    if (!code) {
      throw new Error(
        `No ${digits}-digit code found in message "${message.subject}"`,
      );
    }
    return code;
  }

  /** DELETE /mailbox/{id} — remove all messages for this session. */
  async cleanup(): Promise<void> {
    const res = await fetch(this.url(`/mailbox/${this.sessionId}`), {
      method: "DELETE",
      headers: this.headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Inbox cleanup failed: ${res.status} ${body}`);
    }
  }
}
