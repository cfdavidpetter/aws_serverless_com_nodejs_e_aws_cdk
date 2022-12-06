import * as lambda from '@aws-cdk/aws-lambda'
import * as lambdaNodeJS from '@aws-cdk/aws-lambda-nodejs'
import * as cdk from '@aws-cdk/core'
import * as dynamodb from '@aws-cdk/aws-dynamodb'

interface ProductsFunctionStackProps extends cdk.StackProps {
   productsDdb: dynamodb.Table
   productEventsFunction: lambdaNodeJS.NodejsFunction
}

export class ProductsFunctionStack extends cdk.Stack {
   readonly handler: lambdaNodeJS.NodejsFunction

   constructor(
      scope: cdk.Construct,
      id: string,
      props: ProductsFunctionStackProps
   ) {
      super(scope, id, props)

      this.handler = new lambdaNodeJS.NodejsFunction(this, 'ProductsFunction', {
         functionName: 'ProductsFunction',
         entry: 'lambda/products/productsFunction.js',
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
            PRODUCT_EVENTS_FUNCTION_NAME:
               props.productEventsFunction.functionName,
         },
         insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_98_0,
      })

      props.productsDdb.grantReadWriteData(this.handler)
      props.productEventsFunction.grantInvoke(this.handler)
   }
}
