CREATE TYPE "public"."message_source" AS ENUM('text', 'voice');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "source" "message_source" DEFAULT 'text' NOT NULL;