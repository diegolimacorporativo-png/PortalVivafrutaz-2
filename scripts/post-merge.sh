#!/usr/bin/env bash
set -euo pipefail

# Keep post-merge setup deterministic and non-interactive. This repository's
# authoritative lockfile is pnpm-lock.yaml; package-lock.json is retained for
# deployment compatibility but is not complete enough for `npm ci`.
# Database migrations are intentionally not run here: schema changes must be
# applied deliberately.
rm -rf node_modules
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build