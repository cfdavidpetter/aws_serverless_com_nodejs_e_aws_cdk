import * as cdk from '@aws-cdk/core'
import * as apigateway from '@aws-cdk/aws-apigateway'
import * as cwlogs from '@aws-cdk/aws-logs'
import * as lambdaNodeJS from '@aws-cdk/aws-lambda-nodejs'
import * as lambda from '@aws-cdk/aws-lambda'

interface ECommerceApiStackProps extends cdk.StackProps {
   productsHandler: lambdaNodeJS.NodejsFunction
   ordersHandler: lambdaNodeJS.NodejsFunction
   orderEventsFetchHandler: lambdaNodeJS.NodejsFunction
}

export class ECommerceApiStack extends cdk.Stack {
   public readonly urlOutput: cdk.CfnOutput

   constructor(
      scope: cdk.Construct,
      id: string,
      props: ECommerceApiStackProps
   ) {
      super(scope, id, props)

      const logGroup = new cwlogs.LogGroup(this, 'ECommerceApiLogs')
      const api = new apigateway.RestApi(this, 'ecommerce-api', {
         restApiName: 'ECommerce Service',
         description: 'This is the ECommerce service',
         deployOptions: {
            accessLogDestination: new apigateway.LogGroupLogDestination(
               logGroup
            ),
            methodOptions: {
               '/*/*': {
                  throttlingRateLimit: 4,
                  throttlingBurstLimit: 2,
               },
            },
            accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
               caller: true,
               httpMethod: true,
               ip: true,
               protocol: true,
               requestTime: true,
               resourcePath: true,
               responseLength: true,
               status: true,
               user: true,
            }),
         },
      })

      const productsFunctionIntegration = new apigateway.LambdaIntegration(
         props.productsHandler
      )

      const productRequestValidator = new apigateway.RequestValidator(
         this,
         'ProductRequestValidator',
         {
            restApi: api,
            requestValidatorName: `Product request validator`,
            validateRequestBody: true,
         }
      )
      const productModel = new apigateway.Model(this, 'productModel', {
         modelName: 'ProductModel',
         restApi: api,
         contentType: 'application/json',
         schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
               productName: {
                  type: apigateway.JsonSchemaType.STRING,
               },
               code: {
                  type: apigateway.JsonSchemaType.STRING,
               },
               price: {
                  type: apigateway.JsonSchemaType.NUMBER,
               },
               model: {
                  type: apigateway.JsonSchemaType.STRING,
               },
               productUrl: {
                  type: apigateway.JsonSchemaType.STRING,
               },
            },
            required: ['productName', 'code'],
         },
      })

      const productsResource = api.root.addResource('products')
      productsResource.addMethod('GET', productsFunctionIntegration)
      productsResource.addMethod('POST', productsFunctionIntegration, {
         requestValidator: productRequestValidator,
         requestModels: { 'application/json': productModel },
      })

      const productIdResource = productsResource.addResource('{id}')
      productIdResource.addMethod('GET', productsFunctionIntegration)
      productIdResource.addMethod('PUT', productsFunctionIntegration, {
         requestValidator: productRequestValidator,
         requestModels: { 'application/json': productModel },
      })
      productIdResource.addMethod('DELETE', productsFunctionIntegration)

      const ordersFunctionIntegration = new apigateway.LambdaIntegration(
         props.ordersHandler
      )

      //resource - /orders
      const ordersResource = api.root.addResource('orders')

      //GET /orders
      //GET /orders?email=matilde@siecola.com.br
      //GET /orders?email=matilde@siecola.com.br&orderId=123
      ordersResource.addMethod('GET', ordersFunctionIntegration)

      //DELETE /orders?email=matilde@siecola.com.br&orderId=123
      ordersResource.addMethod('DELETE', ordersFunctionIntegration, {
         requestParameters: {
            'method.request.querystring.email': true,
            'method.request.querystring.orderId': true,
         },
         requestValidatorOptions: {
            requestValidatorName: 'Email and OrderId parameters validator',
            validateRequestParameters: true,
         },
      })

      const orderRequestValidator = new apigateway.RequestValidator(
         this,
         'OrderRequestValidator',
         {
            restApi: api,
            requestValidatorName: `Order request validator`,
            validateRequestBody: true,
         }
      )
      const orderModel = new apigateway.Model(this, 'OrderModel', {
         modelName: 'OrderModel',
         restApi: api,
         contentType: 'application/json',
         schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
               email: {
                  type: apigateway.JsonSchemaType.STRING,
               },
               productIds: {
                  type: apigateway.JsonSchemaType.ARRAY,
                  minItems: 1,
                  items: {
                     type: apigateway.JsonSchemaType.STRING,
                  },
               },
               payment: {
                  type: apigateway.JsonSchemaType.STRING,
                  enum: ['CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'PIX'],
               },
            },
            required: ['email', 'productIds', 'payment'],
         },
      })

      //POST /orders
      const postOrder = ordersResource.addMethod(
         'POST',
         ordersFunctionIntegration,
         {
            requestValidator: orderRequestValidator,
            requestModels: { 'application/json': orderModel },
            apiKeyRequired: true,
         }
      )

      const key = api.addApiKey('ApiKey')
      const plan = api.addUsagePlan('UsagePlan', {
         name: 'Low rate limit',
         // throttle: {
         //    rateLimit: 4,
         //    burstLimit: 2,
         // },
         // quota: {
         //    limit: 5,
         //    period: apigateway.Period.DAY,
         // },
      })
      plan.addApiKey(key)

      plan.addApiStage({
         stage: api.deploymentStage,
         // throttle: [
         //    {
         //       method: postOrder,
         //       throttle: {
         //          rateLimit: 4,
         //          burstLimit: 2,
         //       },
         //    },
         // ],
      })

      const orderEventsFunctionIntegration = new apigateway.LambdaIntegration(
         props.orderEventsFetchHandler
      )

      //resource - /orders/events
      const orderEventsResource = ordersResource.addResource('events')

      //GET /orders/events?email=matilde@siecola.com.br
      //GET /orders/events?email=matilde@siecola.com.br&eventType=ORDER_CREATED
      orderEventsResource.addMethod('GET', orderEventsFunctionIntegration)

      this.urlOutput = new cdk.CfnOutput(this, 'url', {
         exportName: 'url',
         value: api.url,
      })
   }
}
