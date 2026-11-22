CREATE TYPE "public"."billing_provider" AS ENUM('creem', 'polar');--> statement-breakpoint
CREATE TABLE "billing_provider_customers" (
	"user_id" uuid NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"customer_id" text,
	"snapshot" jsonb,
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "billing_provider_customers_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "billing_orders" DROP CONSTRAINT "billing_orders_subscription_id_billing_subscriptions_subscription_id_fk";
--> statement-breakpoint
DROP INDEX "billing_customer_provider_unique";--> statement-breakpoint
DROP INDEX "billing_checkout_provider_unique";--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD COLUMN "provider" "billing_provider" DEFAULT 'polar' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD COLUMN "billing_country" text;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "provider" "billing_provider" DEFAULT 'polar';--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "billing_conflict" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "provider" "billing_provider" DEFAULT 'polar' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "provider" "billing_provider" DEFAULT 'polar' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" ADD COLUMN "provider" "billing_provider" DEFAULT 'polar' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_orders" DROP CONSTRAINT "billing_orders_pkey";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" DROP CONSTRAINT "billing_subscriptions_pkey";--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" DROP CONSTRAINT "billing_webhook_inbox_pkey";--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_provider_order_id_pk" PRIMARY KEY("provider","order_id");--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_provider_subscription_id_pk" PRIMARY KEY("provider","subscription_id");--> statement-breakpoint
ALTER TABLE "billing_webhook_inbox" ADD CONSTRAINT "billing_webhook_inbox_provider_event_id_pk" PRIMARY KEY("provider","event_id");--> statement-breakpoint
ALTER TABLE "billing_provider_customers" ADD CONSTRAINT "billing_provider_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_customer_unique" ON "billing_provider_customers" USING btree ("provider","customer_id");--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_provider_subscription_id_billing_subscriptions_provider_subscription_id_fk" FOREIGN KEY ("provider","subscription_id") REFERENCES "public"."billing_subscriptions"("provider","subscription_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_provider_unique" ON "billing_checkout_attempts" USING btree ("provider","checkout_id");--> statement-breakpoint
INSERT INTO billing_provider_customers (user_id, provider, customer_id, snapshot, last_synced_at)
SELECT user_id, 'polar', customer_id, snapshot, last_synced_at FROM billing_customers;
--> statement-breakpoint
ALTER TABLE "billing_customers" DROP COLUMN "customer_id";