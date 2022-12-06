import * as lambda from '@aws-cdk/aws-lambda'
import * as lambdaNodeJS from '@aws-cdk/aws-lambda-nodejs'
import * as dynamodb from '@aws-cdk/aws-dynamodb'
import * as cdk from '@aws-cdk/core'
import * as sns from '@aws-cdk/aws-sns'
import * as sqs from '@aws-cdk/aws-sqs'
import * as subs from '@aws-cdk/aws-sns-subscriptions'
import * as lambdaEventSource from '@aws-cdk/aws-lambda-event-sources'
import * as iam from '@aws-cdk/aws-iam'
import * as events from '@aws-cdk/aws-events'
import * as logs from '@aws-cdk/aws-logs'
import * as cw from '@aws-cdk/aws-cloudwatch'

interface OrdersApplicationStackProps extends cdk.StackProps {
   productsDdb: dynamodb.Table
   eventsDdb: dynamodb.Table
   auditBus: events.EventBus
}

export class OrdersApplicationStack extends cdk.Stack {
   readonly ordersHandler: lambdaNodeJS.NodejsFunction
   readonly orderEventsFetchHandler: lambdaNodeJS.NodejsFunction

   constructor(
      scope: cdk.Construct,
      id: string,
      props: OrdersApplicationStackProps
   ) {
      super(scope, id, props)

      const ordersDdb = new dynamodb.Table(this, 'OrdersDdb', {
         tableName: 'orders',
         removalPolicy: cdk.RemovalPolicy.DESTROY,
         partitionKey: {
            name: 'pk',
            type: dynamodb.AttributeType.STRING,
         },
         sortKey: {
            name: 'sk',
            type: dynamodb.AttributeType.STRING,
         },
         billingMode: dynamodb.BillingMode.PROVISIONED,
         readCapacity: 1,
         writeCapacity: 1,
      })

      const writeScale = ordersDdb.autoScaleWriteCapacity({
         maxCapacity: 4,
         minCapacity: 1,
      })
      writeScale.scaleOnUtilization({
         targetUtilizationPercent: 30,
         scaleInCooldown: cdk.Duration.seconds(60),
         scaleOutCooldown: cdk.Duration.seconds(60),
      })

      const writeThrottleEventsMetric = ordersDdb.metric(
         'WriteThrottleEvents',
         {
            period: cdk.Duration.minutes(2),
            statistic: 'SampleCount',
            unit: cw.Unit.COUNT,
         }
      )
      writeThrottleEventsMetric.createAlarm(this, 'WriteThrottleEventsAlarm', {
         alarmName: 'WriteThrottleEvents',
         alarmDescription: 'Write throttled events alarm in orders DDB',
         actionsEnabled: true,
         evaluationPeriods: 1,
         threshold: 25,
         treatMissingData: cw.TreatMissingData.NOT_BREACHING,
         comparisonOperator:
            cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      })

      const ordersTopic = new sns.Topic(this, 'OrderEventsTopic', {
         displayName: 'Order events topic',
         topicName: 'order-events',
      })

      this.ordersHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'OrdersFunction',
         {
            functionName: 'OrdersFunction',
            entry: 'lambda/orders/ordersFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            environment: {
               PRODUCTS_DDB: props.productsDdb.tableName,
               ORDERS_DDB: ordersDdb.tableName,
               ORDER_EVENTS_TOPIC_ARN: ordersTopic.topicArn,
               AUDIT_BUS_NAME: props.auditBus.eventBusName,
            },
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
         }
      )

      const productNotFoundMetricFilter =
         this.ordersHandler.logGroup.addMetricFilter('ProductNotFoundMetric', {
            filterPattern: logs.FilterPattern.literal(
               'Some product was not found'
            ),
            metricName: 'OrderWithNonValidProduct',
            metricNamespace: 'ProductNotFound',
         })
      const productNotFoundAlarm = productNotFoundMetricFilter
         .metric()
         .with({
            period: cdk.Duration.minutes(2),
            statistic: 'Sum',
         })
         .createAlarm(this, 'ProductNotFoundAlarm', {
            alarmName: 'OrderWithNonValidProduct',
            alarmDescription:
               'Some product was not found while creating a new order',
            evaluationPeriods: 1,
            threshold: 2,
            actionsEnabled: true,
            comparisonOperator:
               cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
         })
      productNotFoundMetricFilter
      const orderAlarmsTopic = new sns.Topic(this, 'OrderAlarmsTopic', {
         displayName: 'Order alarms topic',
         topicName: 'order-alarms',
      })
      orderAlarmsTopic.addSubscription(
         new subs.EmailSubscription('siecola@gmail.com')
      )
      productNotFoundAlarm.addAlarmAction({
         bind(): cw.AlarmActionConfig {
            return { alarmActionArn: orderAlarmsTopic.topicArn }
         },
      })

      props.productsDdb.grantReadData(this.ordersHandler)
      ordersDdb.grantReadWriteData(this.ordersHandler)
      ordersTopic.grantPublish(this.ordersHandler)
      props.auditBus.grantPutEventsTo(this.ordersHandler)

      const orderEventsHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'OrderEventsFunction',
         {
            functionName: 'OrderEventsFunction',
            entry: 'lambda/orders/orderEventsFunction.js',
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
            },
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
         }
      )

      const eventsDdbPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['dynamodb:PutItem'],
         resources: [props.eventsDdb.tableArn],
         conditions: {
            ['ForAllValues:StringLike']: {
               'dynamodb:LeadingKeys': ['#order_*'],
            },
         },
      })

      orderEventsHandler.addToRolePolicy(eventsDdbPolicy)

      ordersTopic.addSubscription(
         new subs.LambdaSubscription(orderEventsHandler)
      )

      const paymentsHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'PaymentsFunction',
         {
            functionName: 'PaymentsFunction',
            entry: 'lambda/orders/paymentsFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
         }
      )
      ordersTopic.addSubscription(
         new subs.LambdaSubscription(paymentsHandler, {
            filterPolicy: {
               eventType: sns.SubscriptionFilter.stringFilter({
                  allowlist: ['ORDER_CREATED'],
               }),
            },
         })
      )

      const orderEventsDlq = new sqs.Queue(this, 'OrderEventsDlq', {
         queueName: 'order-events-dlq',
      })

      const orderEventsQueue = new sqs.Queue(this, 'OrderEventsQueue', {
         queueName: 'order-events',
         deadLetterQueue: {
            maxReceiveCount: 3,
            queue: orderEventsDlq,
         },
      })
      ordersTopic.addSubscription(
         new subs.SqsSubscription(orderEventsQueue, {
            filterPolicy: {
               eventType: sns.SubscriptionFilter.stringFilter({
                  allowlist: ['ORDER_CREATED', 'ORDER_DELETED'],
               }),
            },
         })
      )

      const orderEmailsHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'OrderEmailsFunction',
         {
            functionName: 'OrderEmailsFunction',
            entry: 'lambda/orders/orderEmailsFunction.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
         }
      )
      orderEmailsHandler.addEventSource(
         new lambdaEventSource.SqsEventSource(orderEventsQueue, {
            batchSize: 5,
            enabled: true,
            maxBatchingWindow: cdk.Duration.seconds(10),
         })
      )
      orderEventsQueue.grantConsumeMessages(orderEmailsHandler)

      const orderEmailSesPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['ses:SendEmail', 'ses:SendRawEmail'],
         resources: ['*'],
      })
      orderEmailsHandler.addToRolePolicy(orderEmailSesPolicy)

      this.orderEventsFetchHandler = new lambdaNodeJS.NodejsFunction(
         this,
         'OrderEventsFetchFuncion',
         {
            functionName: 'OrderEventsFetchFuncion',
            entry: 'lambda/orders/orderEventsFetchFuncion.js',
            handler: 'handler',
            bundling: {
               minify: false,
               sourceMap: false,
            },
            tracing: lambda.Tracing.ACTIVE,
            memorySize: 128,
            timeout: cdk.Duration.seconds(30),
            insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
            environment: {
               EVENTS_DDB: props.eventsDdb.tableName,
            },
         }
      )
      const eventsFetchDdbPolicy = new iam.PolicyStatement({
         effect: iam.Effect.ALLOW,
         actions: ['dynamodb:Query'],
         resources: [`${props.eventsDdb.tableArn}/index/emailIndex`],
      })
      this.orderEventsFetchHandler.addToRolePolicy(eventsFetchDdbPolicy)
   }
}
