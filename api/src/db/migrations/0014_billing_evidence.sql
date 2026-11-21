ALTER TABLE "billing_orders" ALTER COLUMN "refunded_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "checkout_id" text;--> statement-breakpoint
ALTER TABLE "billing_provider_customers" ADD COLUMN "billing_conflict" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE billing_orders AS orders
SET checkout_id = evidence->>'checkoutId'
FROM billing_provider_customers AS customers,
LATERAL jsonb_array_elements(COALESCE(customers.snapshot->'orders', '[]'::jsonb)) AS evidence
WHERE orders.provider = customers.provider
  AND orders.order_id = evidence->>'orderId'
  AND evidence->>'checkoutId' IS NOT NULL;
