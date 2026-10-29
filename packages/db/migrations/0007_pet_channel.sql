CREATE TABLE "pet_channel_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"link_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"label" varchar(40) NOT NULL,
	"platform" text NOT NULL,
	"plugin_version" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pet_channel_tokens_platform_chk" CHECK ("pet_channel_tokens"."platform" in ('darwin','linux','win32','other'))
);
--> statement-breakpoint
ALTER TABLE "claude_links" DROP CONSTRAINT "claude_links_kind_chk";--> statement-breakpoint
ALTER TABLE "pet_channel_tokens" ADD CONSTRAINT "pet_channel_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_channel_tokens" ADD CONSTRAINT "pet_channel_tokens_link_id_claude_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."claude_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pet_channel_tokens_link_uidx" ON "pet_channel_tokens" USING btree ("link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pet_channel_tokens_hash_uidx" ON "pet_channel_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pet_channel_tokens_user_idx" ON "pet_channel_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "claude_links" ADD CONSTRAINT "claude_links_kind_chk" CHECK ("claude_links"."client_kind" in ('claude_ai','claude_code','claude_code_channel','other'));