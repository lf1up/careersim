import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { createPgliteClient } from './helpers/db.js';
import { loadEnv } from '../src/config/env.js';
import { billingSnapshotSchema } from '../src/modules/billing/billing.schema.js';
import { buildPlanCatalog } from '../src/modules/billing/catalog.js';
import { deriveEntitlement } from '../src/modules/billing/entitlements.js';
import { billingCheckoutAttempts, billingCustomers, users } from '../src/db/schema.js';

it('migrates stored high-tier choices and checkouts while preserving Plus and paid periods', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'careersim-tier-upgrade-'));
  const migrationsFolder = resolve('src/db/migrations');
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 12);
  mkdirSync(join(directory, 'meta'));
  writeFileSync(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
  const handle = createPgliteClient(new PGlite());
  const legacy = 'supporter';
  const records = [
    { choice: { tier: legacy, interval: 'year' }, pendingChange: null },
    { choice: { tier: 'plus', interval: 'month' }, pendingChange: { choice: { tier: legacy, interval: 'year' }, effectiveAt: '2027-01-01T00:00:00.000Z' } },
    { choice: { tier: legacy, interval: 'month' }, pendingChange: { choice: { tier: 'plus', interval: 'year' }, effectiveAt: '2027-01-01T00:00:00.000Z' } },
    { choice: null, pendingChange: null },
  ].map((selection) => ({
    userId: randomUUID(),
    snapshot: { kind: 'subscription', customerId: 'existing-customer', subscriptionId: 'existing-subscription', productId: 'existing-polar-product', status: 'active', paidPeriod: { orderId: 'existing-order', productId: 'existing-polar-product', start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z', totalAmount: 4900, refundedAmount: 0, dispute: 'none' }, orders: [], cancelAtPeriodEnd: false, failedRenewal: false, revoked: false, ...selection },
  }));
  try {
    await migrate(handle.db, { migrationsFolder: directory });
    await handle.db.insert(users).values(records.map(({ userId }) => ({ id: userId, email: `${userId}@test.local` })));
    for (const record of records) {
      await handle.db.execute(sql`INSERT INTO billing_customers (user_id, snapshot) VALUES (${record.userId}, ${JSON.stringify(record.snapshot)}::jsonb)`);
    }
    const attempts = [legacy, 'plus'].map((tier) => ({ attemptId: randomUUID(), userId: records[0]!.userId, tier, interval: 'month', status: 'pending', checkoutId: randomUUID() }));
    await handle.db.insert(billingCheckoutAttempts).values(attempts);
    await migrate(handle.db, { migrationsFolder });
    const migrated = await handle.db.select().from(billingCustomers);
    const catalog = buildPlanCatalog(loadEnv({ DATABASE_URL: 'postgres://test', AGENT_API_URL: 'http://test', JWT_SECRET: 'test-secret-test-secret', ALTCHA_HMAC_KEY: 'test-secret-test-secret' }));
    for (const [index, original] of records.entries()) {
      const expected = structuredClone(original.snapshot);
      if (expected.choice?.tier === legacy) expected.choice.tier = 'pro';
      if (expected.pendingChange?.choice.tier === legacy) expected.pendingChange.choice.tier = 'pro';
      const snapshot = migrated.find(({ userId }) => userId === original.userId)?.snapshot;
      expect(snapshot, `snapshot ${index}`).toEqual(expected);
      const entitlement = deriveEntitlement(billingSnapshotSchema.parse(snapshot), catalog, new Date('2026-11-15Z'));
      const tier = expected.choice?.tier ?? 'free';
      expect(entitlement).toMatchObject({ tier, proAccess: tier === 'pro' });
      if (tier === 'pro') expect(entitlement.limits.voiceDailyMinutes).toBe(720);
      if (tier === 'plus') expect(entitlement.limits.voiceDailyMinutes).toBe(360);
    }
    const updatedAttempts = await handle.db.select().from(billingCheckoutAttempts);
    for (const attempt of attempts) {
      expect(updatedAttempts.find(({ attemptId }) => attemptId === attempt.attemptId)).toMatchObject({ ...attempt, tier: attempt.tier === legacy ? 'pro' : 'plus' });
    }
    // Re-running the actual data update is safe and leaves already-migrated facts intact.
    const updated = await handle.db.select().from(billingCustomers);
    const migration = readFileSync(join(migrationsFolder, '0012_rename_supporter_to_pro.sql'), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await handle.db.execute(statement);
    }
    expect(await handle.db.select().from(billingCustomers)).toEqual(updated);
  } finally {
    await handle.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
