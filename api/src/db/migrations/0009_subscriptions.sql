CREATE TABLE "billing_checkout_attempts" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"interval" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"checkout_id" text,
	"url" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text,
	"snapshot" jsonb,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_orders" (
	"order_id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"product_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"total_amount" integer NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"dispute" text DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"paid_through" timestamp with time zone,
	"revoke_pending" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_inbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"customer_id" text,
	"user_id" uuid,
	"order_id" text,
	"dispute" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"room" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"last_checkpoint_at" timestamp with time zone NOT NULL,
	"processed_sequence" integer DEFAULT -1 NOT NULL,
	"cumulative_seconds" integer DEFAULT 0 NOT NULL,
	"charged_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_subscription_id_billing_subscriptions_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("subscription_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" ADD CONSTRAINT "billing_webhook_inbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_provider_unique" ON "billing_checkout_attempts" USING btree ("checkout_id");--> statement-breakpoint
CREATE INDEX "billing_checkout_user_idx" ON "billing_checkout_attempts" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customer_provider_unique" ON "billing_customers" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "billing_customers_sync_idx" ON "billing_customers" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "billing_orders_subscription_period_idx" ON "billing_orders" USING btree ("subscription_id","period_end");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_idx" ON "billing_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_revoke_idx" ON "billing_subscriptions" USING btree ("revoke_pending");--> statement-breakpoint
CREATE INDEX "billing_inbox_pending_idx" ON "billing_webhook_inbox" USING btree ("processed_at","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_calls_active_user_unique" ON "voice_calls" USING btree ("user_id") WHERE "voice_calls"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "voice_calls_session_idx" ON "voice_calls" USING btree ("session_id");