import type { MailboxConfig } from "./types";

/**
 * Build a {@link MailboxConfig} from environment variables.
 *
 * Requires MAIL_API_URL, MAIL_API_KEY and MAIL_SUBDOMAIN to be set.
 * Throws with a clear message if any are missing so tests fail fast.
 */
export function mailboxConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MailboxConfig {
  const apiUrl = env.MAIL_API_URL;
  const apiKey = env.MAIL_API_KEY;
  const subdomain = env.MAIL_SUBDOMAIN;

  const missing = [
    ["MAIL_API_URL", apiUrl],
    ["MAIL_API_KEY", apiKey],
    ["MAIL_SUBDOMAIN", subdomain],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required mailbox env vars: ${missing.join(", ")}`,
    );
  }

  return {
    apiUrl: apiUrl as string,
    apiKey: apiKey as string,
    subdomain: subdomain as string,
  };
}
