# Northstar Checkout

Northstar Checkout is a demo software service for showing how DeltaDotta turns scattered team knowledge into a portable AI operating role.

Use this workspace to demonstrate three things:

- The product and runbook context lives in ordinary repo files.
- DeltaDotta discovers owners, boundaries, handoffs, and escalation paths from those files.
- The generated DevOps / Platform Engineer role can answer an incident prompt without inventing authority.

Demo incident:

> A deployment failed its health check. Give me the allowed next step, required handoff, and escalation boundary.

Expected answer:

- Start with read-only assessment and cite source context.
- Stop or roll back an unsafe deployment if needed.
- Hand off follow-up evidence to Product Engineering.
- Escalate production risk to Maya Chen.
