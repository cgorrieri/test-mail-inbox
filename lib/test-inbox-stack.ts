import * as cdk from "aws-cdk-lib/core";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambdaRuntime from "aws-cdk-lib/aws-lambda";
import * as ses from "aws-cdk-lib/aws-ses";
import * as sesActions from "aws-cdk-lib/aws-ses-actions";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import * as path from "path";

export interface TestInboxStackProps extends cdk.StackProps {
  subdomain: string;
}

export class TestInboxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TestInboxStackProps) {
    super(scope, id, props);

    const { subdomain } = props;

    // S3 Bucket for raw emails
    const emailBucket = new s3.Bucket(this, "EmailStore", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(7) }],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // DynamoDB table
    const emailTable = new dynamodb.Table(this, "Emails", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Parser Lambda
    const parserFn = new lambda.NodejsFunction(this, "ParserFunction", {
      entry: path.join(__dirname, "../src/parser/index.ts"),
      handler: "handler",
      runtime: lambdaRuntime.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: emailTable.tableName,
        BUCKET_NAME: emailBucket.bucketName,
        SUBDOMAIN: subdomain,
      },
      bundling: {
        format: lambda.OutputFormat.CJS,
        externalModules: ["@aws-sdk/*"],
      },
    });

    emailBucket.grantRead(parserFn);
    emailTable.grantWriteData(parserFn);

    // SES Receipt Rule Set
    const ruleSet = new ses.ReceiptRuleSet(this, "EmailRuleSet", {
      receiptRuleSetName: "test-inbox-rules",
    });

    ruleSet.addRule("InboxRule", {
      recipients: [subdomain],
      actions: [
        new sesActions.S3({ bucket: emailBucket }),
        new sesActions.Lambda({ function: parserFn }),
      ],
    });

    // API Lambda
    const apiFn = new lambda.NodejsFunction(this, "ApiFunction", {
      entry: path.join(__dirname, "../src/api/index.ts"),
      handler: "handler",
      runtime: lambdaRuntime.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        TABLE_NAME: emailTable.tableName,
      },
      bundling: {
        format: lambda.OutputFormat.ESM,
        mainFields: ["module", "main"],
        externalModules: ["@aws-sdk/*"],
      },
    });

    emailTable.grantReadWriteData(apiFn);

    // API Gateway
    const api = new apigateway.RestApi(this, "EmailApi", {
      restApiName: "Test Inbox API",
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const apiKey = api.addApiKey("TestInboxApiKey");
    const usagePlan = api.addUsagePlan("UsagePlan", {
      name: "TestInboxUsagePlan",
      throttle: { rateLimit: 10, burstLimit: 5 },
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    const lambdaIntegration = new apigateway.LambdaIntegration(apiFn);

    const mailbox = api.root.addResource("mailbox");
    const session = mailbox.addResource("{sessionId}");
    session.addMethod("DELETE", lambdaIntegration, { apiKeyRequired: true });

    const messages = session.addResource("messages");
    messages.addMethod("GET", lambdaIntegration, { apiKeyRequired: true });

    const singleMessage = messages.addResource("{messageId}");
    singleMessage.addMethod("GET", lambdaIntegration, { apiKeyRequired: true });

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
      description: "Run: aws apigateway get-api-key --api-key <id> --include-value",
    });
    new cdk.CfnOutput(this, "DnsSetup", {
      value: `Add MX record: ${subdomain} MX 10 inbound-smtp.${this.region}.amazonaws.com`,
    });
  }
}
