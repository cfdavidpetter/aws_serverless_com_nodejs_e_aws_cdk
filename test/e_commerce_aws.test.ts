import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as ECommerceAws from '../lib/e_commerce_aws-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new ECommerceAws.ECommerceAwsStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
