import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { simpleParser } from "mailparser";
import { buildPK, buildSK, parseSessionId, TTL_SECONDS } from "../shared/types";
import type { EmailItem } from "../shared/types";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const SUBDOMAIN = process.env.SUBDOMAIN!;

interface SESEvent {
  Records: Array<{
    ses: {
      mail: {
        messageId: string;
        timestamp: string;
        commonHeaders: {
          to: string[];
          from: string[];
          subject: string;
        };
      };
      receipt: {
        recipients: string[];
      };
    };
  }>;
}

export const handler = async (event: SESEvent): Promise<void> => {
  for (const record of event.Records) {
    const { mail, receipt } = record.ses;
    const messageId = mail.messageId;

    // Extract session ID from the first matching recipient (local part before @)
    const recipient = receipt.recipients.find((r) => parseSessionId(r, SUBDOMAIN) !== null);
    if (!recipient) {
      console.log("No matching recipient for subdomain, skipping");
      return;
    }

    const sessionId = parseSessionId(recipient, SUBDOMAIN)!;

    // Fetch raw email from S3
    const s3Response = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: messageId })
    );
    const rawEmail = await s3Response.Body!.transformToString();

    // Parse the email
    const parsed = await simpleParser(rawEmail);

    const now = new Date(mail.timestamp);
    const item: EmailItem = {
      PK: buildPK(sessionId),
      SK: buildSK(now.toISOString(), messageId),
      messageId,
      from: parsed.from?.text ?? mail.commonHeaders.from[0] ?? "unknown",
      subject: parsed.subject ?? mail.commonHeaders.subject ?? "(no subject)",
      bodyText: parsed.text,
      bodyHtml: parsed.html || undefined,
      s3Key: messageId,
      receivedAt: now.toISOString(),
      ttl: Math.floor(now.getTime() / 1000) + TTL_SECONDS,
    };

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`Stored email ${messageId} for session ${sessionId}`);
  }
};
