import { createHmac, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import Fastify from "fastify";
import { beforeEach, afterEach, expect, it } from "vitest";
import { createPgliteClient } from "./helpers/db.js";
import {
  users,
  billingCheckoutAttempts,
  billingCustomers,
  billingProviderCustomers,
  billingWebhookInbox,
} from "../src/db/schema.js";
import { creemBillingWebhookRoutes } from "../src/modules/billing/webhook.route.js";

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
  await handle.db
    .insert(billingCheckoutAttempts)
    .values({
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
  expect(response.statusCode).toBe(202);
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
  ).toBe(202);
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
  ).toBe(202);
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
