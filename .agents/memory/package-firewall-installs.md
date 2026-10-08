---
name: Replit package firewall installs
description: Safely restore Node dependencies when Replit's package firewall rejects a vulnerable locked package.
---

When the Replit package firewall rejects an older locked dependency, identify the exact package and security advisory, then use its patched version through the package manager actually declared by the project. A top-level npm `overrides` entry does not replace a `pnpm.overrides` entry. Keep the parent dependency compatible with the configured Node runtime; do not bypass the firewall or fetch a vulnerable tarball.

**Why:** A project can declare its runtime dependencies correctly while an incomplete install leaves packages missing; each blocked transitive dependency can otherwise stop installation at a different point.

**How to apply:** Check the project's package manager, verify the advisory's patched version, update only the affected dependency resolution, complete a frozen install, then restart the relevant workflow and inspect its first runtime error.
