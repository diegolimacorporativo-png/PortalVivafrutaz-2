---
name: Isolated preview database safety
description: Verify the temporary PostgreSQL target before schema setup or API-test fixtures.
---

Before any DDL or fixture write in isolated preview, pass only the disposable loopback database target and verify `current_database()`, `current_user`, server address and port, and `data_directory`. PostgreSQL may render `inet_server_addr()::text` as `127.0.0.1/32`; normalize or accept the CIDR rather than comparing only to `127.0.0.1`. Never inherit a shared Supabase/Render URL into the test process, and do not apply historical SQL migrations wholesale to an empty database; prepare the current application schema only on a verified disposable database. A workflow restart may leave a stale marked temp directory even after PostgreSQL stops, so do not infer cleanup from restart alone.

**Why:** A strict host-string comparison stopped a safe test before writing because PostgreSQL included the `/32` mask. The earlier logo 500 also came from querying a blank temporary schema, not from an authentication requirement. A workflow restart left a stopped cluster's marked directory behind, so cleanup must confirm the marker and absence of a live PostgreSQL process before removing that exact temp root.

**How to apply:** For isolated-preview integration testing, verify the exact local database identity and temporary data directory before schema or fixture writes; keep shared databases read-only. After stopping or restarting the workflow, verify the old cluster is not running and remove only a marked, validated temp root; confirm the new database has no test fixtures.
