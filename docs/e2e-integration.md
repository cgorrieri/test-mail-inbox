# E2E Integration Guide

How to use this disposable-inbox service to verify email flows (OTP, signup
confirmation, magic links) from an end-to-end test suite.

The examples use **Playwright + TypeScript** to match this repo, but the client
([`src/client`](../src/client)) only uses the global `fetch`, so it works from
Cypress, Vitest, or plain Node just as well. It has **no runtime dependencies**
(session ids come from Node's built-in `crypto.randomUUID()`).

## How it works

Each test picks a unique `sessionId` and sends mail to
`{sessionId}@{subdomain}`. The service parses whatever arrives and exposes it at
`GET /mailbox/{sessionId}/messages`. No mailbox pre-creation is needed — it
exists implicitly the moment mail is received. See the top-level
[README](../README.md) for the full architecture.

## 1. Configuration

Never hardcode the API key. Provide connection details via environment
variables (e.g. an `.env.test` file that is gitignored, plus your CI secret
store):

```bash
MAIL_API_URL=https://xxx.execute-api.eu-west-1.amazonaws.com/prod
MAIL_API_KEY=<your-api-key>
MAIL_SUBDOMAIN=test-mail.yourdomain.com
```

Retrieve the key value from the deploy output's `ApiKeyId`:

```bash
aws apigateway get-api-key --api-key <API_KEY_ID> --include-value \
  --query 'value' --output text
```

## 2. The client

The reusable client lives at [`src/client`](../src/client) and exports:

| Export | Purpose |
|--------|---------|
| `Mailbox` | A disposable mailbox bound to one `sessionId`. |
| `mailboxConfigFromEnv()` | Builds config from `MAIL_*` env vars; throws if any are missing. |
| `MailMessage`, `MailboxConfig`, `WaitOptions` | Types. |

`Mailbox` methods:

- `mailbox.address` — the `{sessionId}@{subdomain}` address to use in the app.
- `list()` — current messages, newest first.
- `waitForMessage(opts?)` — poll until a message (optionally matching a
  predicate) arrives; throws on timeout.
- `waitForCode(digits?, opts?)` — wait for a message and extract the first
  N-digit code (default 6) from its text body.
- `cleanup()` — delete all messages for the session.

If your test suite lives in a separate repo, either publish this package or copy
the `src/client` directory into your test support folder.

## 3. Playwright fixture

Give each test its own fresh mailbox that auto-cleans afterward:

```typescript
// tests/support/fixtures.ts
import { test as base } from "@playwright/test";
import { Mailbox, mailboxConfigFromEnv } from "../../src/client";

export const test = base.extend<{ mailbox: Mailbox }>({
  mailbox: async ({}, use) => {
    const mailbox = new Mailbox(mailboxConfigFromEnv());
    await use(mailbox);
    await mailbox.cleanup(); // runs even if the test failed
  },
});

export { expect } from "@playwright/test";
```

Load the env file once in `playwright.config.ts`:

```typescript
import "dotenv/config"; // or dotenv.config({ path: ".env.test" })
```

## 4. Example — OTP signup flow

```typescript
import { test, expect } from "./support/fixtures";

test("user completes signup with emailed OTP", async ({ page, mailbox }) => {
  // 1. Use the disposable address in the app's signup form
  await page.goto("/signup");
  await page.getByLabel("Email").fill(mailbox.address);
  await page.getByRole("button", { name: "Sign up" }).click();

  // 2. Wait for the OTP email and pull the code
  const code = await mailbox.waitForCode(6, {
    match: (m) => /verify|otp|code/i.test(m.subject),
    timeoutMs: 45_000,
  });

  // 3. Enter it and assert success
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Welcome")).toBeVisible();
});
```

Link-based confirmation instead of a code:

```typescript
const msg = await mailbox.waitForMessage({
  match: (m) => /confirm/i.test(m.subject),
});
const link = msg.bodyText?.match(/https?:\/\/\S+\/confirm\/\S+/)?.[0];
await page.goto(link!);
```

## Best practices & gotchas

- **One mailbox per test.** The default random `sessionId` guarantees
  isolation, so parallel tests never see each other's mail. The fixture handles
  this for you.
- **Poll, don't sleep.** Delivery runs SES → S3 → Lambda → DynamoDB, usually
  2–10s. Use `waitForMessage`/`waitForCode` with a generous `timeoutMs`
  (30–45s in CI) and keep `intervalMs` around 2s.
- **Always filter with `match`.** If the app can send more than one email,
  match on subject/sender so you assert against the right one.
- **Messages expire after 24h** (DynamoDB TTL); raw `.eml` files in S3 after
  7 days. Don't rely on a mailbox across runs — `cleanup()` clears it
  immediately.
- **Protect the API key.** It's a shared secret for the whole service. Keep it
  in your CI secret store, never commit it, and rotate it via API Gateway if
  leaked.
- **Rate limits.** The key sits behind an API Gateway usage plan. If large
  parallel suites see `429`s, add a small backoff or raise the plan limits.
- **Deliverability.** Only mail passing SES checks lands, so send from a domain
  with proper SPF/DKIM (your transactional provider already does this).
