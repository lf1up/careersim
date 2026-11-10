import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createPgliteClient } from "../src/db/client.js";
import { users, billingWebhookInbox } from "../src/db/schema.js";
import { billingWebhookRoutes } from "../src/modules/billing/webhook.route.js";
const secret =
  "whsec_" + Buffer.from("test-billing-signing-key").toString("base64");
describe("signed Polar webhook inbox", () => {
  let handle: ReturnType<typeof createPgliteClient>;
  let app: FastifyInstance;
  let userId: string;
  let calls: number;
  let fail: boolean;
  beforeEach(async () => {
    handle = createPgliteClient(new PGlite());
    await migrate(handle.db, { migrationsFolder: "src/db/migrations" });
    userId = randomUUID();
    await handle.db
      .insert(users)
      .values({ id: userId, email: `${userId}@test.com` });
    calls = 0;
    fail = false;
    app = Fastify();
    await app.register(billingWebhookRoutes, {
      db: handle.db,
      secret,
      syncCustomer: async () => {
        calls++;
        if (fail) throw new Error("provider timeout");
      },
    });
  });
  afterEach(async () => {
    await app.close();
    await handle.close();
  });
  function delivery(id: string, forged = false) {
    const payload = JSON.stringify({
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: { id: "order", customer: { id: "customer", external_id: userId } },
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
    app.post("/ordinary", async (request) => request.body);
    const response = await app.inject({
      method: "POST",
      url: "/ordinary",
      payload: { ok: true },
    });
    expect(response.json()).toEqual({ ok: true });
  });
});
