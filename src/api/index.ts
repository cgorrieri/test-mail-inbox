import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { buildPK } from "../shared/types";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod;
  const sessionId = event.pathParameters?.sessionId;
  const messageId = event.pathParameters?.messageId;

  if (!sessionId) {
    return response(400, { error: "Missing sessionId" });
  }

  try {
    // GET /mailbox/{sessionId}/messages
    if (method === "GET" && !messageId) {
      return await listMessages(sessionId);
    }

    // GET /mailbox/{sessionId}/messages/{messageId}
    if (method === "GET" && messageId) {
      return await getMessage(sessionId, messageId);
    }

    // DELETE /mailbox/{sessionId}
    if (method === "DELETE") {
      return await deleteMailbox(sessionId);
    }

    return response(404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    return response(500, { error: "Internal server error" });
  }
};

async function listMessages(sessionId: string): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": buildPK(sessionId),
        ":prefix": "EMAIL#",
      },
      ScanIndexForward: false, // newest first
    })
  );

  const messages = (result.Items ?? []).map((item) => ({
    messageId: item.messageId,
    from: item.from,
    subject: item.subject,
    receivedAt: item.receivedAt,
    bodyText: item.bodyText,
    bodyHtml: item.bodyHtml,
  }));

  return response(200, { messages });
}

async function getMessage(sessionId: string, messageId: string): Promise<APIGatewayProxyResult> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      FilterExpression: "messageId = :mid",
      ExpressionAttributeValues: {
        ":pk": buildPK(sessionId),
        ":skPrefix": "EMAIL#",
        ":mid": messageId,
      },
    })
  );

  const item = result.Items?.[0];
  if (!item) {
    return response(404, { error: "Message not found" });
  }

  return response(200, {
    messageId: item.messageId,
    from: item.from,
    subject: item.subject,
    bodyText: item.bodyText,
    bodyHtml: item.bodyHtml,
    s3Key: item.s3Key,
    receivedAt: item.receivedAt,
  });
}

async function deleteMailbox(sessionId: string): Promise<APIGatewayProxyResult> {
  // Query all items for this mailbox
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": buildPK(sessionId) },
      ProjectionExpression: "PK, SK",
    })
  );

  // Delete each item
  const deletes = (result.Items ?? []).map((item) =>
    ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }))
  );
  await Promise.all(deletes);

  return response(200, { deleted: deletes.length });
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(body),
  };
}
