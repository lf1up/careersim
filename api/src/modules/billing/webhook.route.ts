import { webhooks } from "@polar-sh/sdk/2026-10";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { AppDatabase } from "../../db/client.js";
import {
  billingCustomers,
  billingWebhookInbox,
  users,
} from "../../db/schema.js";
import type { SyncCustomer } from "./sync.js";

const referenceSchema = z.object({
  id: z.string().optional(),
  external_id: z.uuid().nullish(),
  external_customer_id: z.uuid().nullish(),
  customer_id: z.string().nullish(),
  customer: z
    .object({ id: z.string(), external_id: z.uuid().nullish() })
    .nullish(),
});
interface WebhookOptions {
  db: AppDatabase;
  secret: string;
  syncCustomer: SyncCustomer;
}
/** Register in its own Fastify scope: the parent JSON parser remains untouched. */
export const billingWebhookRoutes: FastifyPluginAsync<WebhookOptions> = async (
  app,
  options,
) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: 1_048_576 },
    (_request, body, done) => done(null, body),
  );
  app.post(
    "/billing/webhook",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
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
        if (error instanceof webhooks.PolarWebhookUnknownTypeError)
          return reply.code(400).send({ error: "billing_unsupported_event" });
        return reply.code(403).send({ error: "billing_invalid_signature" });
      }
      const parsed = referenceSchema.safeParse(event.data);
      const reference = parsed.success ? parsed.data : null;
      let userId =
        reference?.customer?.external_id ??
        reference?.external_customer_id ??
        (event.type.startsWith("customer.") ? reference?.external_id : null) ??
        null;
      const customerId =
        reference?.customer?.id ??
        reference?.customer_id ??
        (event.type.startsWith("customer.") ? reference?.id : null) ??
        null;
      if (userId) {
        // Provider UUID claims must refer to a real immutable account, never email.
        const [user] = await options.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId));
        if (!user) userId = null;
      }
      if (!userId && customerId) {
        const [customer] = await options.db
          .select()
          .from(billingCustomers)
          .where(eq(billingCustomers.customerId, customerId));
        userId = customer?.userId ?? null;
      }
      const eventId = headers["webhook-id"]!;
      await options.db
        .insert(billingWebhookInbox)
        .values({
          eventId,
          eventType: event.type,
          userId,
          customerId,
          orderId: event.type.startsWith("order.") ? reference?.id : null,
        })
        .onConflictDoNothing();
      const [inbox] = await options.db
        .select()
        .from(billingWebhookInbox)
        .where(eq(billingWebhookInbox.eventId, eventId));
      if (inbox?.processedAt) return reply.code(200).send({ received: true });
      if (userId) {
        await options.db
          .update(billingWebhookInbox)
          .set({ attempts: sql`${billingWebhookInbox.attempts}+1` })
          .where(
            and(
              eq(billingWebhookInbox.eventId, eventId),
              isNull(billingWebhookInbox.processedAt),
            ),
          );
        try {
          await options.syncCustomer({
            userId,
            reason: `webhook:${event.type}`,
          });
        } catch {
          // The acknowledged inbox remains pending and reconciliation retries it.
          request.log.warn(
            { eventId, eventType: event.type },
            "Billing synchronization pending",
          );
          return reply.code(202).send({ received: true, pending: true });
        }
      }
      return reply.code(202).send({ received: true });
    },
  );
};
