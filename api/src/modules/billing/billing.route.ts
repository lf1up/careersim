import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  billingAccountSchema,
  billingChoiceSchema,
  planCatalogSchema,
  type PlanCatalog,
} from "./billing.schema.js";
import type { createBillingService } from "./billing.service.js";

interface BillingRouteOptions {
  service: ReturnType<typeof createBillingService>;
  catalog: PlanCatalog;
}
const destinationSchema = z.object({ url: z.url() });
const emptyBody = z.strictObject({}).nullish();
const billingRateLimit = (operation: string) => ({
  max: 6,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) =>
    `billing:${operation}:${request.user.sub}`,
});

export const billingRoutes: FastifyPluginAsyncZod<BillingRouteOptions> = async (
  app,
  { service, catalog },
) => {
  app.get(
    "/billing/catalog",
    { schema: { tags: ["billing"], response: { 200: planCatalogSchema } } },
    async () => catalog,
  );
  app.get(
    "/billing/account",
    {
      onRequest: [app.authenticate],
      schema: { tags: ["billing"], response: { 200: billingAccountSchema } },
    },
    async (request) => service.getAccount(request.user.sub),
  );
  app.post(
    "/billing/checkout",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: billingRateLimit("checkout") },
      schema: {
        tags: ["billing"],
        body: billingChoiceSchema,
        response: { 200: destinationSchema },
      },
    },
    async (request) =>
      service.startCheckout({ userId: request.user.sub, choice: request.body }),
  );
  app.post(
    "/billing/refresh",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: billingRateLimit("refresh") },
      schema: {
        tags: ["billing"],
        body: emptyBody,
        response: { 200: billingAccountSchema },
      },
    },
    async (request) => service.refresh(request.user.sub),
  );
  app.post(
    "/billing/portal",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: billingRateLimit("portal") },
      schema: {
        tags: ["billing"],
        body: emptyBody,
        response: { 200: destinationSchema },
      },
    },
    async (request) => service.portal(request.user.sub),
  );
  app.post(
    "/billing/change",
    {
      onRequest: [app.authenticate],
      config: { rateLimit: billingRateLimit("change") },
      schema: {
        tags: ["billing"],
        body: billingChoiceSchema,
        response: {
          200: z.object({
            choice: billingChoiceSchema,
            effectiveAt: z.string(),
          }),
        },
      },
    },
    async (request) =>
      service.scheduleChange({
        userId: request.user.sub,
        choice: request.body,
      }),
  );
  app.get(
    "/billing/supporter",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["billing"],
        response: {
          200: z.object({ channelUrl: z.url(), instructions: z.string() }),
        },
      },
    },
    async (request) => service.supporterAccess(request.user.sub),
  );
};
