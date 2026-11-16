import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPgliteClient } from "./helpers/db.js";
import {
  users,
  billingCustomers,
  billingWebhookInbox,
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { billingWebhookRoutes } from "../src/modules/billing/webhook.route.js";
const secret =
  "whsec_" + Buffer.from("test-billing-signing-key").toString("base64");
describe("signed Polar webhook inbox", () => {
  let handle: ReturnType<typeof createPgliteClient>;
  let app: FastifyInstance;
  let userId: string;
  let calls: number;
  let fail: boolean;
  let syncedUsers: string[];
  beforeEach(async () => {
    handle = createPgliteClient(new PGlite());
    await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
    userId = randomUUID();
    await handle.db
      .insert(users)
      .values({ id: userId, email: `${userId}@test.com` });
    calls = 0;
    fail = false;
    syncedUsers = [];
    app = Fastify();
    await app.register(billingWebhookRoutes, {
      db: handle.db,
      secret,
      syncCustomer: async ({
        userId: synchronizedUser,
      }: {
        userId: string;
      }) => {
        calls++;
        syncedUsers.push(synchronizedUser);
        if (fail) throw new Error("provider timeout");
      },
    });
  });
  afterEach(async () => {
    await app.close();
    await handle.close();
  });
  function delivery(
    id: string,
    forged = false,
    data: unknown = {
      id: "order",
      customer: { id: "customer", external_id: userId },
    },
    type = "order.paid",
  ) {
    const payload = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      data,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      "sha256",
      Buffer.from(secret.slice(6), "base64"),
    )
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    return app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${forged ? "Zm9yZ2Vk" : signature}`,
      },
      payload,
    });
  }
  it("verifies real Standard Webhooks signatures on untouched bytes and deduplicates event IDs", async () => {
    expect((await delivery("event")).statusCode).toBe(202);
    expect((await delivery("event")).statusCode).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toHaveLength(1);
    expect(calls).toBe(2);
  });
  it("rejects forged signatures before any writes", async () => {
    expect((await delivery("forged", true)).statusCode).toBe(403);
    expect(await handle.db.select().from(billingWebhookInbox)).toHaveLength(0);
    expect(calls).toBe(0);
  });
  it("acknowledges durable failed processing and retries repeated deliveries", async () => {
    fail = true;
    expect((await delivery("retry")).json()).toMatchObject({ pending: true });
    expect(
      (await handle.db.select().from(billingWebhookInbox))[0]?.processedAt,
    ).toBeNull();
    fail = false;
    await delivery("retry");
    expect(calls).toBe(2);
    expect(
      (await handle.db.select().from(billingWebhookInbox))[0]?.attempts,
    ).toBe(2);
  });
  it("does not change parent JSON parsing outside the scoped route", async () => {
    app.post("/ordinary", async (request) => ({
      ok: (request.body as { ok?: boolean })?.ok === true,
    }));
    const response = await app.inject({
      method: "POST",
      url: "/ordinary",
      payload: { ok: true },
    });
    expect(response.json()).toEqual({ ok: true });
  });
  it("rejects non-JSON bodies before signature processing or inbox writes", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "text/plain" },
      payload: "not a JSON webhook",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "billing_invalid_body" });
    expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
    expect(calls).toBe(0);
  });
  it("rejects a JSON delivery with missing signature headers", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      payload: { type: "order.paid", data: { id: "order" } },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "billing_invalid_signature" });
    expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
  });
  it("rejects a correctly signed event type outside the supported provider contract", async () => {
    const response = await delivery(
      "unknown",
      false,
      { id: "order" },
      "order.invented",
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "billing_unsupported_event" });
    expect(await handle.db.select().from(billingWebhookInbox)).toEqual([]);
    expect(calls).toBe(0);
  });
  it("keeps malformed identity data unresolved instead of syncing an arbitrary account", async () => {
    expect(
      (
        await delivery("malformed", false, {
          id: "order",
          customer: { id: "customer", external_id: "not-a-user-uuid" },
        })
      ).statusCode,
    ).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      { eventId: "malformed", userId: null, customerId: null },
    ]);
    expect(calls).toBe(0);
  });
  it("does not trust a valid UUID unless that account exists", async () => {
    expect(
      (
        await delivery("absent", false, {
          id: "order",
          external_customer_id: randomUUID(),
        })
      ).statusCode,
    ).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      { eventId: "absent", userId: null },
    ]);
    expect(calls).toBe(0);
  });
  it("uses a stored provider customer mapping when the claimed account no longer exists", async () => {
    await handle.db
      .insert(billingCustomers)
      .values({ userId, customerId: "known-customer" });
    expect(
      (
        await delivery("mapped", false, {
          id: "order",
          external_customer_id: randomUUID(),
          customer_id: "known-customer",
        })
      ).statusCode,
    ).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      { userId, customerId: "known-customer", orderId: "order", attempts: 1 },
    ]);
    expect(syncedUsers).toEqual([userId]);
  });
  it("keeps an unknown provider customer pending without inventing an account mapping", async () => {
    expect(
      (
        await delivery("unmapped", false, {
          id: "order",
          customer_id: "unknown-customer",
        })
      ).statusCode,
    ).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      {
        userId: null,
        customerId: "unknown-customer",
        attempts: 0,
        processedAt: null,
      },
    ]);
    expect(calls).toBe(0);
  });
  it("resolves customer events from their top-level external identity and customer ID", async () => {
    expect(
      (
        await delivery(
          "customer",
          false,
          { id: "customer", external_id: userId },
          "customer.updated",
        )
      ).statusCode,
    ).toBe(202);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      { userId, customerId: "customer", orderId: null },
    ]);
    expect(syncedUsers).toEqual([userId]);
  });
  it("acknowledges an already-processed delivery without repeating synchronization", async () => {
    await delivery("processed");
    await handle.db
      .update(billingWebhookInbox)
      .set({ processedAt: new Date() })
      .where(eq(billingWebhookInbox.eventId, "processed"));
    const response = await delivery("processed");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true });
    expect(calls).toBe(1);
    expect(await handle.db.select().from(billingWebhookInbox)).toMatchObject([
      { attempts: 1 },
    ]);
  });
});
