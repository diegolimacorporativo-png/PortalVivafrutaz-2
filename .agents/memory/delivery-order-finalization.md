---
name: Delivery-based order finalization
description: Business rule for automatically moving a multi-delivery order to DELIVERED.
---

A multi-delivery order may transition to `DELIVERED` only after every linked delivery is `entregue` or `cancelado`. Any other delivery status keeps the order open.

**Why:** The product owner selected this completion rule.

**How to apply:** Check all deliveries linked to the order whenever one becomes terminal; a cancelled delivery counts as closed.
