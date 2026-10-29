DELETE FROM "chat_messages" WHERE "kind" = 'nearby';--> statement-breakpoint
CREATE TABLE "activity_reports" (
	"user_id" text NOT NULL,
	"period_key" date NOT NULL,
	"now_kind" text,
	"now_ref_hash" char(32),
	"now_until" timestamp with time zone,
	"schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"oauth_client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_reports_pk" PRIMARY KEY("user_id","period_key"),
	CONSTRAINT "activity_now_kind_chk" CHECK ("activity_reports"."now_kind" is null or "activity_reports"."now_kind" in ('work','docs','review','collab')),
	CONSTRAINT "activity_now_pair_chk" CHECK (("activity_reports"."now_kind" is null) = ("activity_reports"."now_until" is null)),
	CONSTRAINT "activity_now_ref_chk" CHECK ("activity_reports"."now_ref_hash" is null or "activity_reports"."now_kind" is not null),
	CONSTRAINT "activity_schedule_chk" CHECK (jsonb_typeof("activity_reports"."schedule") = 'array' and jsonb_array_length("activity_reports"."schedule") <= 16),
	CONSTRAINT "activity_source_chk" CHECK ("activity_reports"."source" in ('cowork_scheduled','claude_interactive','claude_code'))
);
--> statement-breakpoint
ALTER TABLE "chat_message_recipients" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_presence" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "chat_message_recipients" CASCADE;--> statement-breakpoint
DROP TABLE "user_presence" CASCADE;--> statement-breakpoint
ALTER TABLE "privacy_consents" DROP CONSTRAINT "privacy_consents_scope_chk";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "share_activity" boolean;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "show_live" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "manual_status" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "manual_status_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_reports" ADD CONSTRAINT "activity_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_reports_period_idx" ON "activity_reports" USING btree ("period_key");--> statement-breakpoint
ALTER TABLE "chat_messages" DROP COLUMN "zone_id";--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_no_nearby_chk" CHECK ("chat_messages"."kind" <> 'nearby');--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_scope_chk" CHECK ("privacy_consents"."scope" in ('service','claude_chat_summary','activity_sharing'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manual_status_chk" CHECK ("profiles"."manual_status" is null or "profiles"."manual_status" in ('available','focus','meeting','break','away'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manual_status_pair_chk" CHECK (("profiles"."manual_status" is null) = ("profiles"."manual_status_until" is null));