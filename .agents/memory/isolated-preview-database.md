---
name: Isolated preview database safety
description: Verify the temporary PostgreSQL target before schema setup or API-test fixtures.
---

Before any DDL or fixture write in isolated preview, pass only the disposable loopback database target and verify `current_database()`, `current_user`, server address and port, and `data_directory`. PostgreSQL may render `inet_server_addr()::text` as `127.0.0.1/32`; normalize or accept the CIDR rather than comparing only to `127.0.0.1`. Never inherit a shared Supabase/Render URL into the test process, and do not apply historical SQL migrations wholesale to an empty database; prepare the current application schema only on a verified disposable database.

**Why:** A strict host-string comparison stopped a safe test before writing because PostgreSQL included the `/32` mask. The earlier logo 500 also came from querying a blank temporary schema, not from an authentication requirement.

**How to apply:** For isolated-preview integration testing, verify the exact local database identity and temporary data directory before schema or fixture writes; keep shared databases read-only.
