CREATE TABLE "pets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(20) NOT NULL,
	"species" text NOT NULL,
	"tint" text DEFAULT 'base' NOT NULL,
	"role_instructions" text,
	"reply_route" text DEFAULT 'both' NOT NULL,
	"default_visibility" "visibility",
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pets_reply_route_chk" CHECK ("pets"."reply_route" in ('channel','checkin','both')),
	CONSTRAINT "pets_default_tint_chk" CHECK (("pets"."tint" = 'base') = "pets"."is_default"),
	CONSTRAINT "pets_role_len_chk" CHECK ("pets"."role_instructions" is null or char_length("pets"."role_instructions") between 1 and 1000),
	CONSTRAINT "pets_sort_chk" CHECK ("pets"."sort_order" between 0 and 99)
);
--> statement-breakpoint
ALTER TABLE "privacy_consents" DROP CONSTRAINT "privacy_consents_scope_chk";--> statement-breakpoint
ALTER TABLE "pet_nudges" ADD COLUMN "pet_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "pet_chat_default_visibility" "visibility" DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pets_one_default_uidx" ON "pets" USING btree ("user_id") WHERE "pets"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "pets_owner_look_uidx" ON "pets" USING btree ("user_id","species","tint");--> statement-breakpoint
CREATE INDEX "pets_user_idx" ON "pets" USING btree ("user_id","sort_order");--> statement-breakpoint
ALTER TABLE "pet_nudges" ADD CONSTRAINT "pet_nudges_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_scope_chk" CHECK ("privacy_consents"."scope" in ('service','claude_chat_summary','activity_sharing','pet_chat_sharing'));--> statement-breakpoint
-- Every profile gets its default pet from the old single-pet columns (base look, sort order 0). The columns
-- are dropped by 0005 once every reader uses the pets table. gen_random_uuid() is built in since PostgreSQL 13.
INSERT INTO "pets" ("id", "user_id", "name", "species", "tint", "is_default", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid(), "user_id", "pet_name", "pet_species", 'base', true, 0, now(), now() FROM "profiles";
