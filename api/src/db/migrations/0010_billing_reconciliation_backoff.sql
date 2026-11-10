DROP INDEX "billing_customers_sync_idx";--> statement-breakpoint
DROP INDEX "billing_inbox_pending_idx";--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "next_sync_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "sync_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" ADD COLUMN "next_sync_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" ADD COLUMN "sync_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_customers_sync_idx" ON "billing_customers" USING btree ("next_sync_at");--> statement-breakpoint
CREATE INDEX "billing_inbox_pending_idx" ON "billing_webhook_inbox" USING btree ("processed_at","next_sync_at");