ALTER TABLE "sessions" ADD COLUMN "last_human_message_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_nudge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "nudge_count_since_human" integer DEFAULT 0 NOT NULL;