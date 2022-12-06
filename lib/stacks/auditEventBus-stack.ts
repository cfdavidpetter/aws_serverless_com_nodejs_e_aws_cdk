import * as cdk from '@aws-cdk/core'
import * as lambda from '@aws-cdk/aws-lambda'
import * as lambdaNodeJS from '@aws-cdk/aws-lambda-nodejs'
import * as events from '@aws-cdk/aws-events'
import * as targets from '@aws-cdk/aws-events-targets'
import * as sqs from '@aws-cdk/aws-sqs'
import * as cw from '@aws-cdk/aws-cloudwatch'

export class AuditEventBusStack extends cdk.Stack {
   readonly bus: events.EventBus

   constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
      super(scope, id, props)

      this.bus = new events.EventBus(this, 'AuditEventBus', {
         eventBusName: 'AuditEventBus',
      })

      this.bus.archive('BusArchive', {
         eventPattern: {
            source: ['app.order'],
         },
         archiveName: 'auditEvents',
         retention: cdk.Duration.days(10),
      })

      //source: app.order
      //detailType: order
      //reason: PRODUCT_NOT_FOUND
      const nonValidOrderRule = new events.Rule(this, 'NonValidOrderRule', {
         ruleName: 'NonValidOrderRule',
         description: 'Rule matching non valid order',
         eventBus: this.bus,
         eventPattern: {
            source: ['app.order'],
            detailType: ['order'],
            detail: {
               reason: ['PRODUCT_NOT_FOUND'],
            },
         },
      })

      const ordersErrorsFunction = new lambdaNodeJS.NodejsFunction(
         this,
         'OrdersErrorsFunction',
         {
            functionName: 'ordersErrorsFunction',
            entry: 'lambda/audit/ordersErrorsFunction.js',
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

      nonValidOrderRule.addTarget(
         new targets.LambdaFunction(ordersErrorsFunction)
      )

      //source: app.invoice
      //detailType: invoice
      //reason: FAIL_NO_INVOICE_NUMBER
      const nonValidInvoiceRule = new events.Rule(this, 'NonValidInvoiceRule', {
         ruleName: 'NonValidInvoiceRule',
         description: 'Rule matching non valid invoice',
         eventBus: this.bus,
         eventPattern: {
            source: ['app.invoice'],
            detailType: ['invoice'],
            detail: {
               errorDetail: ['FAIL_NO_INVOICE_NUMBER'],
            },
         },
      })

      const invoiceErrorsFunction = new lambdaNodeJS.NodejsFunction(
         this,
         'InvoiceErrorsFunction',
         {
            functionName: 'InvoiceErrorsFunction',
            entry: 'lambda/audit/invoiceErrorsFunction.js',
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
      nonValidInvoiceRule.addTarget(
         new targets.LambdaFunction(invoiceErrorsFunction)
      )

      //source: app.invoice
      //detailType: invoice
      //reason: FAIL_NO_INVOICE_NUMBER
      const timeoutImportInvoiceRule = new events.Rule(
         this,
         'TimeoutImportInvoiceRule',
         {
            ruleName: 'TimeoutImportInvoiceRule',
            description: 'Rule matching timeout import invoice',
            eventBus: this.bus,
            eventPattern: {
               source: ['app.invoice'],
               detailType: ['invoice'],
               detail: {
                  errorDetail: ['TIMEOUT'],
               },
            },
         }
      )
      const invoiceImportTimeoutQueue = new sqs.Queue(
         this,
         'InvoiceImportTimeout',
         {
            queueName: 'invoice-import-timeout',
         }
      )
      timeoutImportInvoiceRule.addTarget(
         new targets.SqsQueue(invoiceImportTimeoutQueue)
      )

      const numberOfMessagesMetric =
         invoiceImportTimeoutQueue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(2),
            statistic: 'Sum',
         })
      numberOfMessagesMetric.createAlarm(this, 'InvoiceImportTimeoutAlarm', {
         alarmName: 'InvoiceImportTimeout',
         alarmDescription:
            'Number of invoice import timeout events in the queue',
         actionsEnabled: true,
         evaluationPeriods: 1,
         threshold: 5,
         comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      })

      const ageOfMessagesMetric =
         invoiceImportTimeoutQueue.metricApproximateAgeOfOldestMessage({
            period: cdk.Duration.minutes(2),
            statistic: 'Maximum',
            unit: cw.Unit.SECONDS,
         })
      ageOfMessagesMetric.createAlarm(this, 'AgeOfMessagesInQueue', {
         alarmName: 'AgeOfMessagesInQueue',
         alarmDescription:
            'Maximum age of messages in invoice import timeout queue',
         actionsEnabled: true,
         evaluationPeriods: 1,
         threshold: 60,
         comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      })
   }
}
