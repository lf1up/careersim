import { createHmac, timingSafeEqual } from "node:crypto";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
} from "fastify";
import type { AppDatabase } from "../../db/client.js";
import {
  billingProviderCustomers,
  billingWebhookInbox,
  billingCheckoutAttempts,
  users,
} from "../../db/schema.js";
import type { SyncCustomer } from "./sync.js";
import type { BillingProviderId } from "./routing.js";

interface WebhookOptions {
  db: AppDatabase;
  secret: string;
  enabled: boolean;
  syncCustomer: SyncCustomer;
}
interface Evidence {
  provider: BillingProviderId;
  eventId: string;
  eventType: string;
  userId: string | null;
  customerId: string | null;
  orderId?: string | null;
  dispute?: string | null;
}
function rawParser(app: FastifyInstance) {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: 1_048_576 },
    (_request, body, done) => done(null, body),
  );
}
async function storedUser(
  options: WebhookOptions,
  provider: BillingProviderId,
  customerId: string | null,
): Promise<string | null> {
  if (!customerId) return null;
  const [customer] = await options.db
    .select()
    .from(billingProviderCustomers)
    .where(
      and(
        eq(billingProviderCustomers.provider, provider),
        eq(billingProviderCustomers.customerId, customerId),
      ),
    );
  return customer?.userId ?? null;
}
async function receive(
  options: WebhookOptions,
  evidence: Evidence,
  reply: FastifyReply,
) {
  await options.db
    .insert(billingWebhookInbox)
    .values(evidence)
    .onConflictDoNothing();
  const key = and(
    eq(billingWebhookInbox.provider, evidence.provider),
    eq(billingWebhookInbox.eventId, evidence.eventId),
  );
  const [inbox] = await options.db
    .select()
    .from(billingWebhookInbox)
    .where(key);
  if (inbox?.processedAt) return reply.code(200).send({ received: true });
  // Use persisted evidence after deduplication, never changed duplicate payloads.
  if (inbox?.userId) {
    await options.db
      .update(billingWebhookInbox)
      .set({ attempts: sql`${billingWebhookInbox.attempts}+1` })
      .where(and(key, isNull(billingWebhookInbox.processedAt)));
    try {
      await options.syncCustomer({
        userId: inbox.userId,
        provider: evidence.provider,
        reason: `webhook:${inbox.eventType}`,
      });
    } catch {
      return reply.code(202).send({ received: true, pending: true });
    }
  }
  return reply.code(202).send({ received: true });
}
const polarReference = z.object({
  id: z.string().optional(),
  external_id: z.uuid().nullish(),
  external_customer_id: z.uuid().nullish(),
  customer_id: z.string().nullish(),
  customer: z
    .object({ id: z.string(), external_id: z.uuid().nullish() })
    .nullish(),
});
/** Keep the original Polar URL for future enabled installations. */
export const billingWebhookRoutes: FastifyPluginAsync<WebhookOptions> = async (
  app,
  options,
) => {
  rawParser(app);
  app.post(
    "/billing/webhook",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!options.enabled)
        return reply.code(503).send({ error: "billing_provider_disabled" });
      const body = request.body;
      if (!Buffer.isBuffer(body))
        return reply.code(400).send({ error: "billing_invalid_body" });
      const headers: Record<string, string> = {};
      for (const name of [
        "webhook-id",
        "webhook-timestamp",
        "webhook-signature",
      ]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      let event: Awaited<ReturnType<typeof webhooks.validateEvent>>;
      try {
        event = await webhooks.validateEvent(body, headers, options.secret);
      } catch (error) {
        const unknown = error instanceof webhooks.PolarWebhookUnknownTypeError;
        return reply
          .code(unknown ? 400 : 403)
          .send({
            error: unknown
              ? "billing_unsupported_event"
              : "billing_invalid_signature",
          });
      }
      const parsed = polarReference.safeParse(event.data);
      const ref = parsed.success ? parsed.data : null;
      const customerId =
        ref?.customer?.id ??
        ref?.customer_id ??
        (event.type.startsWith("customer.") ? ref?.id : null) ??
        null;
      let userId =
        ref?.customer?.external_id ??
        ref?.external_customer_id ??
        (event.type.startsWith("customer.") ? ref?.external_id : null) ??
        null;
      if (userId) {
        const [user] = await options.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId));
        if (!user) userId = null;
      }
      const mapped = await storedUser(options, "polar", customerId);
      if (mapped && userId && mapped !== userId)
        return reply.code(409).send({ error: "billing_identity_mismatch" });
      userId ??= mapped;
      return receive(
        options,
        {
          provider: "polar",
          eventId: headers["webhook-id"]!,
          eventType: event.type,
          userId,
          customerId,
          orderId: event.type.startsWith("order.") ? ref?.id : null,
        },
        reply,
      );
    },
  );
};

const remoteRef = z.union([z.string(), z.object({ id: z.string() })]);
const metadata = z.object({
  careersim_user_id: z.uuid().optional(),
  careersim_attempt_id: z.uuid().optional(),
});
const checkoutRef = z.object({
  id: z.string().optional(),
  request_id: z.uuid().optional(),
  metadata: metadata.nullish(),
});
const creemReference = z.object({
  id: z.string().optional(),
  request_id: z.uuid().optional(),
  metadata: metadata.nullish(),
  customer: remoteRef.nullish(),
  checkout: checkoutRef.nullish(),
  transaction: z
    .object({ id: z.string(), customer: remoteRef.nullish() })
    .nullish(),
});
const refId = (value: z.infer<typeof remoteRef> | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);
export const creemBillingWebhookRoutes: FastifyPluginAsync<
  WebhookOptions
> = async (app, options) => {
  rawParser(app);
  app.post(
    "/billing/webhook/creem",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!options.enabled)
        return reply.code(503).send({ error: "billing_provider_disabled" });
      const body = request.body;
      const signature = request.headers["creem-signature"];
      if (!Buffer.isBuffer(body))
        return reply.code(400).send({ error: "billing_invalid_body" });
      if (
        typeof signature !== "string" ||
        !/^[a-f0-9]{64}$/i.test(signature) ||
        !options.secret
      )
        return reply.code(403).send({ error: "billing_invalid_signature" });
      const expected = createHmac("sha256", options.secret)
        .update(body)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
        return reply.code(403).send({ error: "billing_invalid_signature" });
      let data: unknown;
      try {
        data = JSON.parse(body.toString("utf8"));
      } catch {
        return reply.code(400).send({ error: "billing_invalid_body" });
      }
      const event = z
        .object({
          id: z.string().min(1).max(255),
          eventType: z.string().min(1).max(255),
          object: z.unknown(),
        })
        .safeParse(data);
      if (!event.success)
        return reply.code(400).send({ error: "billing_invalid_body" });
      const parsed = creemReference.safeParse(event.data.object);
      const ref = parsed.success ? parsed.data : null;
      const customerId =
        refId(ref?.customer) ?? refId(ref?.transaction?.customer);
      let userId = await storedUser(options, "creem", customerId);
      const claim = ref?.metadata ?? ref?.checkout?.metadata;
      const attemptId =
        claim?.careersim_attempt_id ??
        ref?.request_id ??
        ref?.checkout?.request_id;
      const checkoutId =
        event.data.eventType === "checkout.completed"
          ? ref?.id
          : ref?.checkout?.id;
      if (attemptId && checkoutId) {
        const [attempt] = await options.db
          .select()
          .from(billingCheckoutAttempts)
          .where(
            and(
              eq(billingCheckoutAttempts.provider, "creem"),
              eq(billingCheckoutAttempts.attemptId, attemptId),
            ),
          );
        if (attempt && claim?.careersim_user_id === attempt.userId) {
          if (
            (userId && userId !== attempt.userId) ||
            (attempt.checkoutId && attempt.checkoutId !== checkoutId)
          )
            return reply.code(409).send({ error: "billing_identity_mismatch" });
          userId = attempt.userId;
          // A signed checkout reference makes response-loss recovery possible. A fresh GET still proves payment.
          await options.db
            .update(billingCheckoutAttempts)
            .set({ checkoutId })
            .where(
              and(
                eq(billingCheckoutAttempts.attemptId, attemptId),
                eq(billingCheckoutAttempts.provider, "creem"),
              ),
            );
        }
      }
      return receive(
        options,
        {
          provider: "creem",
          eventId: event.data.id,
          eventType: event.data.eventType,
          userId,
          customerId,
          orderId: ref?.transaction?.id ?? null,
          dispute: event.data.eventType === "dispute.created" ? "open" : null,
        },
        reply,
      );
    },
  );
};
