#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from '@aws-cdk/core'
import { ProductsFunctionStack } from '../lib/stacks/productsFunction-stack'
import { ECommerceApiStack } from '../lib/stacks/ecommerceApi-stack'
import { ProductsDdbStack } from '../lib/stacks/productsDdb-stack'
import { EventsDdbStack } from '../lib/stacks/eventsDdb-stack'
import { ProductEventsFunctionStack } from '../lib/stacks/productEventsFunction-stack'
import { OrdersApplicationStack } from '../lib/stacks/ordersApplication-stack'
import { InvoiceWSApiStack } from '../lib/stacks/invoiceWSApi-stack'
import { InvoiceAppLayersStack } from '../lib/stacks/invoiceAppLayers-stack'
import { AuditEventBusStack } from '../lib/stacks/auditEventBus-stack'

const app = new cdk.App()

const tags = {
   cost: 'ECommerce',
   team: 'SiecolaCode',
}

const productsDdbStack = new ProductsDdbStack(app, 'ProductsDdb', {
   tags: tags,
})

const eventsDdbStack = new EventsDdbStack(app, 'EventsDdb', {
   tags: tags,
})

const productEventsFunctionStack = new ProductEventsFunctionStack(
   app,
   'ProductEventsFunction',
   {
      eventsDdb: eventsDdbStack.table,
      tags: tags,
   }
)
productEventsFunctionStack.addDependency(eventsDdbStack)

const productsFunctionStack = new ProductsFunctionStack(
   app,
   'ProductsFunction',
   {
      productsDdb: productsDdbStack.table,
      productEventsFunction: productEventsFunctionStack.handler,
      tags: tags,
   }
)
productsFunctionStack.addDependency(productsDdbStack)
productsFunctionStack.addDependency(productEventsFunctionStack)

const auditEventBusStack = new AuditEventBusStack(app, 'AuditEvents', {
   tags: {
      cost: 'AuditEvents',
      team: 'SiecolaCode',
   },
})

const ordersApplicationStack = new OrdersApplicationStack(
   app,
   'OrdersApplication',
   {
      productsDdb: productsDdbStack.table,
      eventsDdb: eventsDdbStack.table,
      auditBus: auditEventBusStack.bus,
      tags: tags,
   }
)
ordersApplicationStack.addDependency(productsDdbStack)
ordersApplicationStack.addDependency(eventsDdbStack)
ordersApplicationStack.addDependency(auditEventBusStack)

const eCommerceApiStack = new ECommerceApiStack(app, 'ECommerceApi', {
   productsHandler: productsFunctionStack.handler,
   ordersHandler: ordersApplicationStack.ordersHandler,
   orderEventsFetchHandler: ordersApplicationStack.orderEventsFetchHandler,
   tags: tags,
})
eCommerceApiStack.addDependency(productsFunctionStack)
eCommerceApiStack.addDependency(ordersApplicationStack)

const invoiceAppLayersStack = new InvoiceAppLayersStack(app, 'InvoiceAppLayers')

const invoiceWSApiStack = new InvoiceWSApiStack(app, 'InvoiceApi', {
   eventsDdb: eventsDdbStack.table,
   auditBus: auditEventBusStack.bus,
   tags: {
      cost: 'InvoiceApp',
      team: 'SiecolaCode',
   },
})
invoiceWSApiStack.addDependency(invoiceAppLayersStack)
invoiceWSApiStack.addDependency(eventsDdbStack)
invoiceWSApiStack.addDependency(auditEventBusStack)
