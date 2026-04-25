# infra/

Infrastructure-level concerns that are technology-specific and not
tied to any business module.

## Planned contents

| File / folder              | Purpose                                                    |
|----------------------------|------------------------------------------------------------|
| `server.ts`                | HTTP server bootstrap (extracted from server/index.ts)     |
| `cron/`                    | Scheduled jobs (backups, email-scheduler, outbox worker)   |
| `storage/`                 | S3 / local disk abstraction for file uploads               |
| `push/`                    | Web-push VAPID config and notification dispatch            |
| `queue/`                   | In-process job queue or BullMQ wrapper                     |

Nothing is implemented here yet — this folder is the target for the
infrastructure extraction phase of the migration.
