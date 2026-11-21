import { createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import Fastify from "fastify";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createPgliteClient } from "./helpers/db.js";
import {
  users,
  billingCheckoutAttempts,
  billingCustomers,
  billingProviderCustomers,
  billingWebhookInbox,
} from "../src/db/schema.js";
import { creemBillingWebhookRoutes } from "../src/modules/billing/webhook.route.js";
import { eq } from "drizzle-orm";

const secret = "test-creem-webhook";
let handle: ReturnType<typeof createPgliteClient>;
let app: ReturnType<typeof Fastify>;
let userId: string;
let attemptId: string;
let calls: number;
beforeEach(async () => {
  handle = createPgliteClient(new PGlite());
  await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
  userId = randomUUID();
  attemptId = randomUUID();
  calls = 0;
  await handle.db
    .insert(users)
    .values({ id: userId, email: `${userId}@test.local` });
  await handle.db.insert(billingCheckoutAttempts).values({
    provider: "creem",
    attemptId,
    userId,
    tier: "plus",
    interval: "month",
  });
  app = Fastify();
  await app.register(creemBillingWebhookRoutes, {
    db: handle.db,
    secret,
    enabled: true,
    syncCustomer: async () => {
      calls++;
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  await handle.close();
});
function delivery(
  object: unknown,
  signature = true,
  eventType = "checkout.completed",
) {
  const payload = JSON.stringify({ id: "evt_same", eventType, object });
  return app.inject({
    method: "POST",
    url: "/billing/webhook/creem",
    headers: {
      "content-type": "application/json",
      "creem-signature": signature
        ? createHmac("sha256", secret).update(payload).digest("hex")
        : "bad",
    },
    payload,
  });
}
it("binds an ambiguous checkout only through its server-created intent and signed provider evidence", async () => {
  const response = await delivery({
    id: "ch_1",
    customer: { id: "cust_1" },
    metadata: { careersim_user_id: userId, careersim_attempt_id: attemptId },
    request_id: attemptId,
  });
  expect(response.statusCode).toBe(200);
  expect(
    (await handle.db.select().from(billingCheckoutAttempts))[0]?.checkoutId,
  ).toBe("ch_1");
  expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
    { provider: "creem", eventId: "evt_same", userId, customerId: "cust_1" },
  ]);
  expect(calls).toBe(1);
});
it("rejects a forged signature before storing any event or checkout identity", async () => {
  expect((await delivery({ id: "ch_bad" }, false)).statusCode).toBe(403);
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  expect(
    (await handle.db.select().from(billingCheckoutAttempts))[0]?.checkoutId,
  ).toBeNull();
});
it("does not bind arbitrary UUID metadata without a matching stored intent", async () => {
  expect(
    (
      await delivery({
        id: "ch_bad",
        metadata: {
          careersim_user_id: userId,
          careersim_attempt_id: randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await handle.db.select().from(billingWebhookInbox))[0]?.userId,
  ).toBeNull();
  expect(calls).toBe(0);
});
it("scopes customer lookup and dispute transaction evidence to Creem", async () => {
  await handle.db.insert(billingCustomers).values({ userId });
  await handle.db
    .insert(billingProviderCustomers)
    .values({ provider: "creem", userId, customerId: "cust_same" });
  expect(
    (
      await delivery(
        { transaction: { id: "tran_1", customer: "cust_same" } },
        true,
        "dispute.created",
      )
    ).statusCode,
  ).toBe(200);
  expect((await handle.db.select().from(billingWebhookInbox))[0]).toMatchObject(
    { provider: "creem", orderId: "tran_1", dispute: "open", userId },
  );
});
it("does not acknowledge or process a disabled provider webhook", async () => {
  await app.close();
  app = Fastify();
  await app.register(creemBillingWebhookRoutes, {
    db: handle.db,
    secret,
    enabled: false,
    syncCustomer: async () => {
      calls++;
    },
  });
  expect((await delivery({})).statusCode).toBe(503);
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  expect(calls).toBe(0);
});
it("rejects a well-formed signature that does not authenticate the raw body", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/billing/webhook/creem",
    headers: {
      "content-type": "application/json",
      "creem-signature": "0".repeat(64),
    },
    payload: JSON.stringify({
      id: "forged",
      eventType: "checkout.completed",
      object: {},
    }),
  });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toEqual({ error: "billing_invalid_signature" });
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
});
it.each(["not-json", JSON.stringify({ object: {} })])(
  "rejects a signed malformed envelope %s without persisting it",
  async (payload) => {
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook/creem",
      headers: {
        "content-type": "application/json",
        "creem-signature": createHmac("sha256", secret)
          .update(payload)
          .digest("hex"),
      },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "billing_invalid_body" });
    expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  },
);
it("rejects a non-JSON body before storing a webhook", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/billing/webhook/creem",
    headers: { "content-type": "text/plain" },
    payload: "event",
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({ error: "billing_invalid_body" });
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
});
it("recovers checkout identity from nested signed checkout metadata", async () => {
  const response = await delivery(
    {
      checkout: {
        id: "nested-checkout",
        request_id: attemptId,
        metadata: { careersim_user_id: userId },
      },
      customer: "customer",
    },
    true,
    "subscription.paid",
  );
  expect(response.statusCode).toBe(200);
  expect(
    (await handle.db.select().from(billingCheckoutAttempts))[0],
  ).toMatchObject({
    userId,
    checkoutId: "nested-checkout",
  });
  expect((await handle.db.select().from(billingWebhookInbox))[0]).toMatchObject(
    {
      userId,
      eventType: "subscription.paid",
    },
  );
  expect(calls).toBe(1);
});
it("refuses to replace an already bound checkout with a different signed identity", async () => {
  await handle.db
    .update(billingCheckoutAttempts)
    .set({ checkoutId: "original" })
    .where(eq(billingCheckoutAttempts.attemptId, attemptId));
  const response = await delivery({
    id: "replacement",
    metadata: { careersim_user_id: userId, careersim_attempt_id: attemptId },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({ error: "billing_identity_mismatch" });
  expect(
    (await handle.db.select().from(billingCheckoutAttempts))[0]?.checkoutId,
  ).toBe("original");
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  expect(calls).toBe(0);
});

it("acknowledges durable evidence with 200 while failed synchronization stays pending", async () => {
  await app.close();
  app = Fastify();
  await app.register(creemBillingWebhookRoutes, {
    db: handle.db,
    secret,
    enabled: true,
    syncCustomer: async () => {
      throw new Error("Provider offline");
    },
  });
  const response = await delivery({
    id: "checkout",
    metadata: { careersim_user_id: userId, careersim_attempt_id: attemptId },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ received: true, pending: true });
  expect((await handle.db.select().from(billingWebhookInbox))[0]).toMatchObject(
    { userId, processedAt: null, attempts: 1 },
  );
});

it("does not acknowledge evidence when the inbox write fails", async () => {
  vi.spyOn(handle.db, "insert").mockImplementationOnce(() => {
    throw new Error("Database offline");
  });
  expect((await delivery({})).statusCode).toBe(500);
  expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  expect(calls).toBe(0);
});
