CREATE TYPE "public"."chat_kind" AS ENUM('dm', 'room', 'nearby');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'company');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "oauth_access_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertion" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_consent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp,
	"created_at" timestamp,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resource_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"google_sub" text,
	"hd" text,
	"status" text DEFAULT 'active' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"tokens_revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"oauth_client_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	CONSTRAINT "audit_actor_type_chk" CHECK ("audit_events"."actor_type" in ('user','claude','admin','system'))
);
--> statement-breakpoint
CREATE TABLE "chat_message_recipients" (
	"message_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "chat_message_recipients_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "chat_kind" NOT NULL,
	"zone_id" text,
	"sender_id" text NOT NULL,
	"dm_low" text,
	"dm_high" text,
	"body" text NOT NULL,
	"client_msg_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chat_messages_body_len_chk" CHECK (char_length("chat_messages"."body") between 1 and 500),
	CONSTRAINT "chat_messages_dm_chk" CHECK (("chat_messages"."kind" = 'dm') = ("chat_messages"."dm_low" is not null and "chat_messages"."dm_high" is not null))
);
--> statement-breakpoint
CREATE TABLE "claude_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text,
	"client_kind" text DEFAULT 'other' NOT NULL,
	"redirect_host" text,
	"consented_at" timestamp with time zone NOT NULL,
	"first_tool_call_at" timestamp with time zone,
	"last_tool_call_at" timestamp with time zone,
	"last_tool_name" text,
	"last_write_at" timestamp with time zone,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "claude_links_kind_chk" CHECK ("claude_links"."client_kind" in ('claude_ai','claude_code','other'))
);
--> statement-breakpoint
CREATE TABLE "desks" (
	"desk_id" text PRIMARY KEY NOT NULL,
	"label_name" text,
	"avatar" jsonb,
	"pet_species" text,
	"pet_name" text,
	"user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desks_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "dm_read_state" (
	"user_id" text NOT NULL,
	"peer_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dm_read_state_user_id_peer_id_pk" PRIMARY KEY("user_id","peer_id")
);
--> statement-breakpoint
CREATE TABLE "kr_holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nudge_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"nudge_id" uuid,
	"todo_id" uuid,
	"trigger" text NOT NULL,
	"due_key" text,
	"shown_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"outcome_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pet_nudges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text NOT NULL,
	"kind" text DEFAULT 'reminder' NOT NULL,
	"todo_id" uuid,
	"priority" smallint DEFAULT 2 NOT NULL,
	"show_after" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"dedupe_key" varchar(64),
	"status" text DEFAULT 'pending' NOT NULL,
	"show_count" smallint DEFAULT 0 NOT NULL,
	"max_shows" smallint DEFAULT 2 NOT NULL,
	"last_shown_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"acked_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"oauth_client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pet_nudges_text_len_chk" CHECK (char_length("pet_nudges"."text") between 1 and 120),
	CONSTRAINT "pet_nudges_status_chk" CHECK ("pet_nudges"."status" in ('pending','shown','snoozed','acked','dismissed','expired','superseded')),
	CONSTRAINT "pet_nudges_kind_chk" CHECK ("pet_nudges"."kind" in ('reminder','checkin')),
	CONSTRAINT "pet_nudges_time_chk" CHECK ("pet_nudges"."expires_at" > "pet_nudges"."show_after")
);
--> statement-breakpoint
CREATE TABLE "privacy_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"notice_version" text NOT NULL,
	"scope" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "privacy_consents_scope_chk" CHECK ("privacy_consents"."scope" in ('service','claude_chat_summary'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" varchar(40) NOT NULL,
	"avatar" jsonb NOT NULL,
	"pet_species" text DEFAULT 'cat' NOT NULL,
	"pet_name" varchar(20) DEFAULT '펫' NOT NULL,
	"title" varchar(60),
	"status_text" varchar(80),
	"timezone" text DEFAULT 'Asia/Seoul' NOT NULL,
	"default_log_visibility" "visibility" DEFAULT 'company' NOT NULL,
	"default_chat_summary_visibility" "visibility",
	"share_dms_with_my_claude" boolean DEFAULT false NOT NULL,
	"nudges_enabled" boolean DEFAULT true NOT NULL,
	"nudge_min_interval_min" smallint DEFAULT 25 NOT NULL,
	"max_bubbles_per_day" smallint DEFAULT 8 NOT NULL,
	"quiet_start" text DEFAULT '19:30' NOT NULL,
	"quiet_end" text DEFAULT '08:30' NOT NULL,
	"link_state" text DEFAULT 'not_linked' NOT NULL,
	"link_state_changed_at" timestamp with time zone,
	"last_work_log_at" timestamp with time zone,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_link_state_chk" CHECK ("profiles"."link_state" in ('not_linked','linked','stale')),
	CONSTRAINT "profiles_interval_chk" CHECK ("profiles"."nudge_min_interval_min" between 10 and 240)
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"external_ref" varchar(200) NOT NULL,
	"title" varchar(120) NOT NULL,
	"note" varchar(300),
	"due_at" timestamp with time zone,
	"due_date" date,
	"priority" smallint DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"status_source" text DEFAULT 'claude' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"oauth_client_id" text,
	"last_seen_by_claude_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "todos_status_chk" CHECK ("todos"."status" in ('open','done','dismissed','snoozed')),
	CONSTRAINT "todos_status_source_chk" CHECK ("todos"."status_source" in ('claude','user','system')),
	CONSTRAINT "todos_priority_chk" CHECK ("todos"."priority" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "user_presence" (
	"user_id" text PRIMARY KEY NOT NULL,
	"x" smallint NOT NULL,
	"y" smallint NOT NULL,
	"dir" smallint DEFAULT 0 NOT NULL,
	"zone_id" text,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period_key" date NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" text,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claude_chat_summary" text,
	"visibility" "visibility" NOT NULL,
	"visibility_set_by" text DEFAULT 'claude' NOT NULL,
	"chat_summary_visibility" "visibility" DEFAULT 'private' NOT NULL,
	"chat_summary_visibility_set_by" text DEFAULT 'claude' NOT NULL,
	"source" text NOT NULL,
	"oauth_client_id" text,
	"claude_written_at" timestamp with time zone NOT NULL,
	"claude_revision" integer DEFAULT 1 NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"user_edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_logs_summary_len_chk" CHECK ("work_logs"."summary" is null or char_length("work_logs"."summary") <= 2000),
	CONSTRAINT "work_logs_chat_summary_len_chk" CHECK ("work_logs"."claude_chat_summary" is null or char_length("work_logs"."claude_chat_summary") <= 1000),
	CONSTRAINT "work_logs_set_by_chk" CHECK ("work_logs"."visibility_set_by" in ('claude','user') and "work_logs"."chat_summary_visibility_set_by" in ('claude','user')),
	CONSTRAINT "work_logs_source_chk" CHECK ("work_logs"."source" in ('cowork_scheduled','claude_interactive','claude_code'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_oauth_refresh_token_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_oauth_resource_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resource"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_recipients" ADD CONSTRAINT "chat_message_recipients_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_recipients" ADD CONSTRAINT "chat_message_recipients_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_links" ADD CONSTRAINT "claude_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desks" ADD CONSTRAINT "desks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_read_state" ADD CONSTRAINT "dm_read_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_read_state" ADD CONSTRAINT "dm_read_state_peer_id_user_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudge_deliveries" ADD CONSTRAINT "nudge_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudge_deliveries" ADD CONSTRAINT "nudge_deliveries_nudge_id_pet_nudges_id_fk" FOREIGN KEY ("nudge_id") REFERENCES "public"."pet_nudges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudge_deliveries" ADD CONSTRAINT "nudge_deliveries_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_nudges" ADD CONSTRAINT "pet_nudges_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet_nudges" ADD CONSTRAINT "pet_nudges_todo_id_todos_id_fk" FOREIGN KEY ("todo_id") REFERENCES "public"."todos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_clientId_idx" ON "oauth_access_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_sessionId_idx" ON "oauth_access_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_userId_idx" ON "oauth_access_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauth_access_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauthAccessToken_refreshId_idx" ON "oauth_access_token" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauthClient_userId_idx" ON "oauth_client" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_uidx" ON "oauth_client_resource" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauth_client_resource" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauth_client_resource" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_clientId_idx" ON "oauth_consent" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthConsent_userId_idx" ON "oauth_consent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_clientId_idx" ON "oauth_refresh_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_sessionId_idx" ON "oauth_refresh_token" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_userId_idx" ON "oauth_refresh_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauth_refresh_token" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "chat_recipients_user_idx" ON "chat_message_recipients" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_sender_client_uidx" ON "chat_messages" USING btree ("sender_id","client_msg_id");--> statement-breakpoint
CREATE INDEX "chat_messages_dm_idx" ON "chat_messages" USING btree ("dm_low","dm_high","created_at") WHERE "chat_messages"."kind" = 'dm';--> statement-breakpoint
CREATE INDEX "chat_messages_room_idx" ON "chat_messages" USING btree ("created_at") WHERE "chat_messages"."kind" = 'room';--> statement-breakpoint
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_links_user_client_uidx" ON "claude_links" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "nudge_deliveries_user_shown_idx" ON "nudge_deliveries" USING btree ("user_id","shown_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pet_nudges_user_dedupe_uidx" ON "pet_nudges" USING btree ("user_id","dedupe_key") WHERE "pet_nudges"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "pet_nudges_active_idx" ON "pet_nudges" USING btree ("user_id","status","show_after") WHERE "pet_nudges"."status" in ('pending','shown','snoozed');--> statement-breakpoint
CREATE INDEX "pet_nudges_expires_idx" ON "pet_nudges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_consents_user_version_scope_uidx" ON "privacy_consents" USING btree ("user_id","notice_version","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "todos_user_ref_uidx" ON "todos" USING btree ("user_id","external_ref");--> statement-breakpoint
CREATE INDEX "todos_user_status_due_idx" ON "todos" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "work_logs_user_period_uidx" ON "work_logs" USING btree ("user_id","period_key");--> statement-breakpoint
CREATE INDEX "work_logs_feed_idx" ON "work_logs" USING btree ("visibility","updated_at") WHERE "work_logs"."deleted_at" is null;