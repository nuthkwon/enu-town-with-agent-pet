-- Bubble deliveries no longer record their trigger: 'join' / 'glance' rows were a history of when each
-- person opened the town or came back to the tab (ADR 0004 P4). due_key keeps what the policy needs.
ALTER TABLE "nudge_deliveries" DROP COLUMN "trigger";--> statement-breakpoint
-- Work-log ids are random UUIDv4 from now on (newOpaqueId): colleagues receive them, and the first 48 bits of
-- a UUIDv7 are the owner-only time of the day's first Claude write. Nothing references work_logs.id.
-- gen_random_uuid() is built in since PostgreSQL 13.
UPDATE "work_logs" SET "id" = gen_random_uuid();
