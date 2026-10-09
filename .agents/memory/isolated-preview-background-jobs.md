---
name: Isolated preview background jobs
description: Keep all scheduled database and external work disabled in isolated preview mode.
---

Any database-writing or externally connected scheduled job that starts during module import must check isolated preview mode itself. A boot-level branch that skips explicit worker startup does not prevent timers created by imported services.

**Why:** An alert-log cleanup timer was scheduled at import time despite the isolated boot reporting that schedulers were disabled. Its database connection was local in preview, but the mismatch weakened the no-side-effects guarantee.

**How to apply:** When adding import-time intervals, cron jobs, or cleanup routines, gate them on `isIsolatedPreviewMode()` and verify isolated startup logs do not show them as scheduled.
