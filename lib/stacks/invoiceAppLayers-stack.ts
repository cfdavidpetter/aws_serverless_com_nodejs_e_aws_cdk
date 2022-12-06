import * as cdk from '@aws-cdk/core'
import * as lambda from '@aws-cdk/aws-lambda'
import * as ssm from '@aws-cdk/aws-ssm'
import { RemovalPolicy } from '@aws-cdk/core'

export class InvoiceAppLayersStack extends cdk.Stack {
   readonly invoiceTransactionLayer: lambda.LayerVersion
   readonly invoiceWSConnectionLayer: lambda.LayerVersion

   constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
      super(scope, id, props)

      this.invoiceTransactionLayer = new lambda.LayerVersion(
         this,
         'InvoiceTransaction',
         {
            code: lambda.Code.fromAsset(
               'lambda/invoices/layers/invoiceTransaction'
            ),
            compatibleRuntimes: [lambda.Runtime.NODEJS_14_X],
            layerVersionName: 'InvoiceTransaction',
            removalPolicy: RemovalPolicy.RETAIN,
         }
      )
      new ssm.StringParameter(this, 'InvoiceTransactionLayerVersionArn', {
         parameterName: 'InvoiceTransactionLayerVersionArn',
         stringValue: this.invoiceTransactionLayer.layerVersionArn,
      })

      this.invoiceWSConnectionLayer = new lambda.LayerVersion(
         this,
         'InvoiceWSConnection',
         {
            code: lambda.Code.fromAsset(
               'lambda/invoices/layers/invoiceWSConnection'
            ),
            compatibleRuntimes: [lambda.Runtime.NODEJS_14_X],
            layerVersionName: 'InvoiceWSConnection',
            removalPolicy: RemovalPolicy.RETAIN,
         }
      )
      new ssm.StringParameter(this, 'InvoiceWSConnectionLayerVersionArn', {
         parameterName: 'InvoiceWSConnectionLayerVersionArn',
         stringValue: this.invoiceWSConnectionLayer.layerVersionArn,
      })
   }
}
