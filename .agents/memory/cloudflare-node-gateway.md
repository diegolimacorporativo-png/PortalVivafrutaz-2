---
name: Cloudflare Node gateway
description: Decision for publishing the full ERP behind a Cloudflare Worker without replacing its Node backend.
---

The Cloudflare deployment uses a same-origin Worker gateway: static Vite assets are served by the Worker, while API and user-session requests are proxied to the published Node/Express backend.

**Why:** The ERP backend depends on Express middleware, express-session with a PostgreSQL pool, filesystem-backed fiscal tooling, and long-running workers. Publishing only the static asset directory produces empty 404s for `/api/*`; migrating only login would be a false implementation and would remove the rest of the ERP.

**How to apply:** Publish the Node backend first, then configure the Worker secret `API_ORIGIN` with that HTTPS origin and deploy the Worker. Keep `API_ORIGIN` out of source control and never replace the proxy with mock authentication.