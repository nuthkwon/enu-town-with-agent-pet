ALTER TABLE "desks" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "desks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "desks" ADD COLUMN "role_note" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "team" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "role_note" varchar(80);