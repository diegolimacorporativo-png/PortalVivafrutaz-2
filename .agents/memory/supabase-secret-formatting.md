---
name: Supabase secret formatting
description: Secure secret entry can preserve harmless wrapping whitespace or quotes around a PostgreSQL URL.
---

Normalize the Supabase PostgreSQL connection value before applying strict protocol and host validation: trim whitespace and remove only wrapping quotes.

**Why:** The imported project's secure secret was present but failed its PostgreSQL protocol check after confirmation, indicating formatting introduced during secret entry rather than a missing credential.

**How to apply:** Keep the validation fail-closed and never fall back to a local or Replit-managed database; normalization should only remove accidental outer formatting.