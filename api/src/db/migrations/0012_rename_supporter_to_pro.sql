UPDATE "billing_customers"
SET "snapshot" = jsonb_set("snapshot", '{choice,tier}', '"pro"'::jsonb, false)
WHERE "snapshot" #>> '{choice,tier}' = 'supporter';
--> statement-breakpoint
UPDATE "billing_customers"
SET "snapshot" = jsonb_set("snapshot", '{pendingChange,choice,tier}', '"pro"'::jsonb, false)
WHERE "snapshot" #>> '{pendingChange,choice,tier}' = 'supporter';
--> statement-breakpoint
UPDATE "billing_checkout_attempts"
SET "tier" = 'pro'
WHERE "tier" = 'supporter';
