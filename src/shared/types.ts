export interface EmailItem {
  PK: string; // INBOX#{sessionId}
  SK: string; // EMAIL#{receivedAt}#{messageId}
  messageId: string;
  from: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  s3Key: string;
  receivedAt: string;
  ttl: number;
}

export const TTL_SECONDS = 24 * 60 * 60; // 24 hours

export function buildPK(sessionId: string): string {
  return `INBOX#${sessionId}`;
}

export function buildSK(receivedAt: string, messageId: string): string {
  return `EMAIL#${receivedAt}#${messageId}`;
}

export function parseSessionId(toAddress: string, subdomain: string): string | null {
  const pattern = new RegExp(`^(.+)@${subdomain.replace(/\./g, "\\.")}$`, "i");
  const match = toAddress.match(pattern);
  return match ? match[1] : null;
}
