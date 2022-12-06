import * as cdk from '@aws-cdk/core'
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2'
import * as apigatewayv2_integrations from '@aws-cdk/aws-apigatewayv2-integrations'
import * as lambdaNodeJS from '@aws-cdk/aws-lambda-nodejs'
import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as lambda from '@aws-cdk/aws-lambda'
import * as s3 from '@aws-cdk/aws-s3'
import * as iam from '@aws-cdk/aws-iam'
import * as s3n from '@aws-cdk/aws-s3-notifications'
import * as ssm from '@aws-cdk/aws-ssm'
import * as sqs from '@aws-cdk/aws-sqs'
import { DynamoEventSource, SqsDlq } from '@aws-cdk/aws-lambda-event-sources'
import * as events from '@aws-cdk/aws-events'

interface InvoiceWSApiStackProps extends cdk.StackProps {
   eventsDdb: dynamodb.Table
   auditBus: events.EventBus
}

export class InvoiceWSApiStack extends cdk.Stack {
   constructor(
      scope: cdk.Construct,
      id: string,
      props: InvoiceWSApiStackProps
   ) {
      super(scope, id, props)

      //Invoice and invoice transaction DDB
      const invoicesDdb = new dynamodb.Table(this, 'InvoicesDdb', {
         tableName: 'pcs-invoices',
         billingMode: dynamodb.BillingMode.PROVISIONED,
         readCapacity: 1,
         writeCapacity: 1,
         partitionKey: {
            name: 'pk',
            type: dynamodb.AttributeType.STRING,
         },
         sortKey: {
            name: 'sk',
            type: dynamodb.AttributeType.STRING,
         },
         timeToLiveAttribute: 'ttl',
         removalPolicy: cdk.RemovalPolicy.DESTROY,
         stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      })

      //Invoice bucket
      const bucket = new s3.Bucket(this, 'InvoiceBucket', {
         bucketName: 'pcs-invoices',
         removalPolicy: cdk.RemovalPolicy.DESTROY,
      })

      //WebSocket connection handler
      const connectionHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceConnectionFunction',
         {
            functionName: 'InvoiceConnectionFunction',
            entry: 'lambda/invoices/invoiceConnectionFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
         }
      )

      //WebSocket disconnection handler
      const disconnectionHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceDisconnectionFunction',
         {
            functionName: 'InvoiceDisconnectionFunction',
            entry: 'lambda/invoices/invoiceDisconnectionFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
         }
      )

      //WebSocket API
      const webSocketApi = new apigatewayv2.WebSocketApi(this, 'InvoiceWSApi', {
         apiName: 'InvoiceWSApi',
         description: 'This is the Invoice WebSocket API',

         // connectRouteOptions: {
         //    integration:
         //       new apigatewayv2_integrations.LambdaWebSocketIntegration({
         //          handler: connectionHandler,
         //       }),
         // },
         connectRouteOptions: {
            integration: ,
         },
         disconnectRouteOptions: {
            integration:
               new apigatewayv2_integrations.LambdaWebSocketIntegration({
                  handler: disconnectionHandler,
               }),
         },
      })

      const stage = 'prod'
      const wsApiEndpoint = `${webSocketApi.apiEndpoint}/${stage}`

      new apigatewayv2.WebSocketStage(this, 'InvoiceWSApiStage', {
         webSocketApi,
         stageName: stage,
         autoDeploy: true,
      })

      const resourcePost = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/POST/@connections/*`
      const resourceGet = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/GET/@connections/*`
      const resourceDelete = `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${stage}/DELETE/@connections/*`
      const wsApiPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['execute-api:ManageConnections'],
         resources: [resourcePost, resourceGet, resourceDelete],
      })

      //Invoice Transaction Layer
      const invoiceTransactionLayerArn =
         ssm.StringParameter.valueForStringParameter(
            this,
            'InvoiceTransactionLayerVersionArn'
         )
      const invoiceTransactionLayer = lambda.LayerVersion.fromLayerVersionArn(
         this,
         'InvoiceTransactionLayerArn',
         invoiceTransactionLayerArn
      )

      //Invoice Connection Layer
      const invoiceWSConnectionLayerArn =
         ssm.StringParameter.valueForStringParameter(
            this,
            'InvoiceWSConnectionLayerVersionArn'
         )
      const invoiceWSConnectionLayer = lambda.LayerVersion.fromLayerVersionArn(
         this,
         'InvoiceWSConnectionLayerArn',
         invoiceWSConnectionLayerArn
      )

      //Invoice URL handler
      const getUrlHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceGetUrlFunction',
         {
            functionName: 'InvoiceGetUrlFunction',
            entry: 'lambda/invoices/invoiceGetUrlFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            environment: {
               INVOICES_DDB: invoicesDdb.tableName,
               BUCKET_NAME: bucket.bucketName,
               INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
            },
            layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
         }
      )
      const invoicesDdbWriteTransactionPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['dynamodb:PutItem'],
         resources: [invoicesDdb.tableArn],
         conditions: {
            ['ForAllValues:StringLike']: {
               'dynamodb:LeadingKeys': ['#transaction'],
            },
         },
      })
      const invoicesBucketPutObjectPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['s3:PutObject'],
         resources: [`${bucket.bucketArn}/*`],
      })
      getUrlHandler.addToRolePolicy(invoicesBucketPutObjectPolicy)
      getUrlHandler.addToRolePolicy(invoicesDdbWriteTransactionPolicy)
      getUrlHandler.addToRolePolicy(wsApiPolicy)

      //Invoice import handler
      const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceWSImportFunction',
         {
            functionName: 'InvoiceWSImportFunction',
            entry: 'lambda/invoices/invoiceWSImportFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            environment: {
               INVOICES_DDB: invoicesDdb.tableName,
               INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
               AUDIT_BUS_NAME: props.auditBus.eventBusName,
            },
            layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
         }
      )
      invoicesDdb.grantReadWriteData(invoiceImportHandler)
      props.auditBus.grantPutEventsTo(invoiceImportHandler)

      bucket.addEventNotification(
         s3.EventType.OBJECT_CREATED_PUT,
         new s3n.LambdaDestination(invoiceImportHandler)
      )

      const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['s3:DeleteObject', 's3:GetObject'],
         resources: [`${bucket.bucketArn}/*`],
      })
      invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy)
      invoiceImportHandler.addToRolePolicy(wsApiPolicy)

      //Cancel import handler
      const cancelImportHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceCancelImportFunction',
         {
            functionName: 'InvoiceCancelImportFunction',
            entry: 'lambda/invoices/invoiceCancelImportFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            environment: {
               INVOICES_DDB: invoicesDdb.tableName,
               INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
            },
            layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
         }
      )
      const invoicesDdbReadWriteTransactionPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['dynamodb:UpdateItem', 'dynamodb:GetItem'],
         resources: [invoicesDdb.tableArn],
         conditions: {
            ['ForAllValues:StringLike']: {
               'dynamodb:LeadingKeys': ['#transaction'],
            },
         },
      })
      cancelImportHandler.addToRolePolicy(invoicesDdbReadWriteTransactionPolicy)
      cancelImportHandler.addToRolePolicy(wsApiPolicy)

      //WebSocket API routes

      webSocketApi.addRoute('getImportUrl', {
         integration: new apigatewayv2_integrations.LambdaWebSocketIntegration({
            handler: getUrlHandler,
         }),
      })

      webSocketApi.addRoute('cancelImport', {
         integration: new apigatewayv2_integrations.LambdaWebSocketIntegration({
            handler: cancelImportHandler,
         }),
      })

      const invoiceEventsHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceEventsFunction',
         {
            functionName: 'InvoiceEventsFunction',
            entry: 'lambda/invoices/invoiceEventsFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            environment: {
               EVENTS_DDB: props.eventsDdb.tableName,
               INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
               AUDIT_BUS_NAME: props.auditBus.eventBusName,
            },
            layers: [invoiceWSConnectionLayer],
         }
      )
      props.auditBus.grantPutEventsTo(invoiceEventsHandler)

      const invoicesDdbPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['dynamodb:PutItem'],
         resources: [props.eventsDdb.tableArn],
         conditions: {
            ['ForAllValues:StringLike']: {
               'dynamodb:LeadingKeys': ['#invoice_*'],
            },
         },
      })
      invoiceEventsHandler.addToRolePolicy(invoicesDdbPolicy)
      invoiceEventsHandler.addToRolePolicy(wsApiPolicy)

      const invoiceEventsDlq = new sqs.Queue(this, 'InvoiceEventsDlq', {
         queueName: 'invoice-events-dlq',
      })

      invoiceEventsHandler.addEventSource(
         new DynamoEventSource(invoicesDdb, {
            startingPosition: lambda.StartingPosition.TRIM_HORIZON,
            batchSize: 5,
            bisectBatchOnError: true,
            onFailure: new SqsDlq(invoiceEventsDlq),
            retryAttempts: 3,
         })
      )
   }
}
