---
name: Public tracking tokens
description: Security boundary and payload rules for anonymous delivery and route tracking links.
---

Public tracking links are opaque, encrypted, signed, expiring capabilities. They
must carry a fixed purpose and resource type, use a random nonce, and be
verified before any resource lookup; public DTOs must be separate from
operational payloads and GPS precision must be reduced.

**Why:** Numeric tracking IDs exposed delivery, customer, address, and
telemetry data; a base64-encoded claims payload would still reveal internal
identifiers, and full tokens in rate-limit logs could become replay material.

**How to apply:** Reuse the existing server root secret through domain-separated
keys, keep anonymous responses minimal, preserve numeric compatibility only for
authenticated internal consumers, and redact tracking tokens from security logs.
For numeric route compatibility, resolve the actor before querying and constrain
the route by `logistics_routes.empresa_id`; only unbound MASTER/DIRECTOR actors
are global. Driver accounts must also match the route's assigned driver.