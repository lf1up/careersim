import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPgliteClient } from "./helpers/db.js";
import {
  billingCustomers,
  billingProviderCustomers,
  billingSubscriptions,
  billingOrders,
  billingCheckoutAttempts,
  billingWebhookInbox,
  users,
} from "../src/db/schema.js";

it("preserves populated Polar billing records and supports identical Creem IDs after migration", async () => {
  const folder = mkdtempSync(join(tmpdir(), "careersim-billing-migration-"));
  const migrationsFolder = resolve("src/db/migrations");
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx < 13,
  );
  mkdirSync(join(folder, "meta"));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
  const handle = createPgliteClient(new PGlite());
  const userId = randomUUID();
  const attemptId = randomUUID();
  try {
    await migrate(handle.db, { migrationsFolder: folder });
    await handle.db
      .insert(users)
      .values({ id: userId, email: `${userId}@test.local` });
    await handle.db.execute(
      sql`INSERT INTO billing_customers (user_id, customer_id, snapshot) VALUES (${userId}, 'cust_same', '{"kind":"none"}'::jsonb)`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_subscriptions (subscription_id,user_id,product_id,status,paid_through) VALUES ('sub_same',${userId},'polar-product','canceled','2026-12-01T00:00:00Z')`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_orders (order_id,subscription_id,product_id,period_start,period_end,total_amount) VALUES ('order_same','sub_same','polar-product','2026-11-01T00:00:00Z','2026-12-01T00:00:00Z',900)`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_checkout_attempts (attempt_id,user_id,tier,interval,checkout_id,status) VALUES (${attemptId},${userId},'plus','month','checkout_same','pending')`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_webhook_inbox (event_id,event_type,user_id) VALUES ('event_same','order.paid',${userId})`,
    );
    await migrate(handle.db, { migrationsFolder });
    expect((await handle.db.select().from(billingCustomers))[0]).toMatchObject({
      userId,
      provider: "polar",
      snapshot: { kind: "none" },
    });
    expect(
      await handle.db.select().from(billingProviderCustomers),
    ).toMatchObject([
      {
        userId,
        provider: "polar",
        customerId: "cust_same",
        snapshot: { kind: "none" },
      },
    ]);
    expect(
      (await handle.db.select().from(billingSubscriptions))[0],
    ).toMatchObject({
      provider: "polar",
      subscriptionId: "sub_same",
      paidThrough: new Date("2026-12-01T00:00:00Z"),
    });
    expect((await handle.db.select().from(billingOrders))[0]).toMatchObject({
      provider: "polar",
      orderId: "order_same",
      totalAmount: 900,
    });
    expect(
      (await handle.db.select().from(billingCheckoutAttempts))[0],
    ).toMatchObject({ provider: "polar", attemptId, status: "pending" });
    expect(
      (await handle.db.select().from(billingWebhookInbox))[0],
    ).toMatchObject({ provider: "polar", eventId: "event_same" });
    await handle.db
      .insert(billingProviderCustomers)
      .values({ provider: "creem", userId, customerId: "cust_same" });
    await handle.db
      .insert(billingSubscriptions)
      .values({
        provider: "creem",
        subscriptionId: "sub_same",
        userId,
        productId: "prod_pm",
        status: "active",
      });
    await handle.db
      .insert(billingOrders)
      .values({
        provider: "creem",
        orderId: "order_same",
        subscriptionId: "sub_same",
        productId: "prod_pm",
        periodStart: new Date("2026-11-01T00:00:00Z"),
        periodEnd: new Date("2026-12-01T00:00:00Z"),
        totalAmount: 900,
      });
    expect(await handle.db.select().from(billingOrders)).toHaveLength(2);
  } finally {
    await handle.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it("backfills verified checkout linkage and allows unknown refund evidence", async () => {
  const folder = mkdtempSync(join(tmpdir(), "careersim-billing-evidence-"));
  const migrationsFolder = resolve("src/db/migrations");
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
  );
  journal.entries = journal.entries.filter(
    (entry: { idx: number }) => entry.idx < 14,
  );
  mkdirSync(join(folder, "meta"));
  writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(folder, `${entry.tag}.sql`),
    );
  const handle = createPgliteClient(new PGlite());
  const userId = randomUUID();
  try {
    await migrate(handle.db, { migrationsFolder: folder });
    await handle.db
      .insert(users)
      .values({ id: userId, email: `${userId}@test.local` });
    const snapshot = JSON.stringify({
      kind: "subscription",
      customerId: "customer",
      subscriptionId: "subscription",
      productId: "prod_pm",
      choice: { tier: "plus", interval: "month" },
      status: "active",
      paidPeriod: null,
      orders: [
        {
          orderId: "transaction",
          checkoutId: "verified-checkout",
          productId: "prod_pm",
          start: "2026-11-01Z",
          end: "2026-12-01Z",
          totalAmount: 900,
          refundedAmount: 0,
          dispute: "none",
        },
      ],
      cancelAtPeriodEnd: false,
      failedRenewal: false,
      revoked: false,
      pendingChange: null,
    });
    await handle.db.execute(
      sql`INSERT INTO billing_provider_customers (user_id,provider,customer_id,snapshot) VALUES (${userId},'creem','customer',${snapshot}::jsonb)`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_subscriptions (provider,subscription_id,user_id,product_id,status) VALUES ('creem','subscription',${userId},'prod_pm','active')`,
    );
    await handle.db.execute(
      sql`INSERT INTO billing_orders (provider,order_id,subscription_id,product_id,period_start,period_end,total_amount) VALUES ('creem','transaction','subscription','prod_pm','2026-11-01Z','2026-12-01Z',900)`,
    );
    await migrate(handle.db, { migrationsFolder });
    expect((await handle.db.select().from(billingOrders))[0]).toMatchObject({
      checkoutId: "verified-checkout",
      refundedAmount: 0,
    });
    expect(
      (await handle.db.select().from(billingProviderCustomers))[0],
    ).toMatchObject({ billingConflict: 0 });
    await handle.db
      .update(billingOrders)
      .set({ refundedAmount: null, dispute: "open" });
    expect((await handle.db.select().from(billingOrders))[0]).toMatchObject({
      refundedAmount: null,
      dispute: "open",
    });
  } finally {
    await handle.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
