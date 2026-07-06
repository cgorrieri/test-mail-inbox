#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { TestInboxStack } from "../lib/test-inbox-stack";

const app = new cdk.App();

const subdomain = app.node.tryGetContext("subdomain");
if (!subdomain) {
  throw new Error('Missing required context: subdomain. Use -c subdomain=mail.yourdomain.com');
}

new TestInboxStack(app, "TestInboxStack", {
  subdomain,
  env: {
    region: app.node.tryGetContext("region") ?? "eu-west-1",
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
});
