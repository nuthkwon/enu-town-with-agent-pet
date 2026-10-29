CREATE TABLE "pet_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pet_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"day_key" date NOT NULL,
	"visibility" "visibility" NOT NULL,
	"visibility_set_by" text NOT NULL,
	"source" text,
	"client_msg_id" varchar(64),
	"in_reply_to" uuid,
	"reply_part" smallint,
	"answer_state" text,
	"answered_lane" text,
	"reply_count" smallint DEFAULT 0 NOT NULL,
	"claimed_by" uuid,
	"claim_until" timestamp with time zone,
	"unread" boolean DEFAULT false NOT NULL,
	"oauth_client_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pet_messages_author_chk" CHECK ("pet_messages"."author" in ('owner','pet')),
	CONSTRAINT "pet_messages_body_len_chk" CHECK (char_length("pet_messages"."body") between 1 and 1000),
	CONSTRAINT "pet_messages_set_by_chk" CHECK ("pet_messages"."visibility_set_by" in ('owner','claude')),
	CONSTRAINT "pet_messages_source_chk" CHECK (("pet_messages"."author" = 'pet') = ("pet_messages"."source" is not null) and ("pet_messages"."source" is null or "pet_messages"."source" in ('claude_code_channel','cowork_scheduled','claude_interactive','claude_code'))),
	CONSTRAINT "pet_messages_owner_fields_chk" CHECK (("pet_messages"."author" = 'owner') = ("pet_messages"."client_msg_id" is not null) and ("pet_messages"."author" = 'owner') = ("pet_messages"."answer_state" is not null)),
	CONSTRAINT "pet_messages_pet_fields_chk" CHECK (("pet_messages"."author" = 'pet') = ("pet_messages"."in_reply_to" is not null) and ("pet_messages"."author" = 'pet') = ("pet_messages"."reply_part" is not null) and ("pet_messages"."reply_part" is null or "pet_messages"."reply_part" between 1 and 3)),
	CONSTRAINT "pet_messages_answer_chk" CHECK ("pet_messages"."answer_state" is null or "pet_messages"."answer_state" in ('pending','claimed','answered')),
	CONSTRAINT "pet_messages_lane_chk" CHECK ("pet_messages"."answered_lane" is null or "pet_messages"."answered_lane" in ('channel','connector')),
	CONSTRAINT "pet_messages_claim_chk" CHECK (("pet_messages"."claimed_by" is null) = ("pet_messages"."claim_until" is null) and ("pet_messages"."claim_until" is null or "pet_messages"."answer_state" = 'claimed')),
	CONSTRAINT "pet_messages_unread_chk" CHECK (not ("pet_messages"."author" = 'owner' and "pet_messages"."unread"))
);
--> statement-breakpoint
ALTER TABLE "pet_messages" ADD CONSTRAINT "pet_messages_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_messages" ADD CONSTRAINT "pet_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_messages" ADD CONSTRAINT "pet_messages_in_reply_to_pet_messages_id_fk" FOREIGN KEY ("in_reply_to") REFERENCES "public"."pet_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pet_messages_owner_client_uidx" ON "pet_messages" USING btree ("user_id","client_msg_id") WHERE "pet_messages"."client_msg_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pet_messages_reply_part_uidx" ON "pet_messages" USING btree ("in_reply_to","reply_part") WHERE "pet_messages"."in_reply_to" is not null;--> statement-breakpoint
CREATE INDEX "pet_messages_thread_idx" ON "pet_messages" USING btree ("pet_id","created_at","id");--> statement-breakpoint
CREATE INDEX "pet_messages_colleague_idx" ON "pet_messages" USING btree ("pet_id","created_at","id") WHERE "pet_messages"."visibility" = 'company';--> statement-breakpoint
CREATE INDEX "pet_messages_inbox_idx" ON "pet_messages" USING btree ("user_id","created_at") WHERE "pet_messages"."answer_state" in ('pending','claimed');--> statement-breakpoint
CREATE INDEX "pet_messages_unread_idx" ON "pet_messages" USING btree ("user_id","pet_id") WHERE "pet_messages"."unread";--> statement-breakpoint
CREATE INDEX "pet_messages_day_idx" ON "pet_messages" USING btree ("day_key");