ALTER TABLE "messages" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "actor_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_session_event_unique" ON "messages" USING btree ("session_id","event_id");