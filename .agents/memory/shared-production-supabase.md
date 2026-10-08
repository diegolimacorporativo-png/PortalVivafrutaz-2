---
name: Shared production Supabase
description: Replit and Render use the same production Supabase database.
---

Replit and Render use the same production Supabase database.

**Why:** The user explicitly confirmed this while authorizing a production migration and controlled end-to-end tests.

**How to apply:** Treat writes through either runtime as production writes. Do not assume Replit is a staging database; require explicit authorization for production changes and clearly label any approved test records.
