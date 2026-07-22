# Product and tribal knowledge

Northstar Checkout helps merchants recover failed payments before churn.

## Product details
- The checkout API is customer-facing and must keep authorization latency under 400ms.
- Failed deployment checks usually mean webhook delivery or payment-intent creation is degraded.
- Enterprise merchants expect a plain-English incident note within 30 minutes.

## Team memory
- Maya Chen owns production-risk escalation.
- Product Engineering receives the follow-up handoff after failed health checks.
- The Platform team may stop or roll back an unsafe deployment, but does not change product scope.
- Any customer-facing incident must preserve the timeline, source evidence, owner, and next action.

