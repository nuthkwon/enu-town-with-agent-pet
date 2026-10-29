CREATE TABLE "work_log_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"log_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"day_key" date NOT NULL,
	"seq" integer NOT NULL,
	"written_at" timestamp with time zone,
	"in_office_hours" boolean NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb NOT NULL,
	CONSTRAINT "work_log_entries_kind_chk" CHECK ("work_log_entries"."kind" in ('created','updated','day')),
	CONSTRAINT "work_log_entries_changes_chk" CHECK (jsonb_typeof("work_log_entries"."changes") = 'array' and jsonb_array_length("work_log_entries"."changes") between 1 and 64),
	CONSTRAINT "work_log_entries_day_time_chk" CHECK ("work_log_entries"."kind" <> 'day' or "work_log_entries"."written_at" is null)
);
--> statement-breakpoint
ALTER TABLE "work_log_entries" ADD CONSTRAINT "work_log_entries_log_id_work_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."work_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_log_entries" ADD CONSTRAINT "work_log_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_log_entries_log_seq_uidx" ON "work_log_entries" USING btree ("log_id","seq");--> statement-breakpoint
CREATE INDEX "work_log_entries_day_idx" ON "work_log_entries" USING btree ("day_key");