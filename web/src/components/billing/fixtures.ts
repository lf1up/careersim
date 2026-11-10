import type { PlanCatalogResponse, BillingAccount } from '@/lib/billing';
export const paidLimits = { sessionsCreateMax: 100, sessionsWindowMs: 21600000, chatMessagesMax: 3000, chatWindowMs: 21600000, customSimulationsMax: 250, customPersonasMax: 250, voiceDailyMinutes: 720 };
export const catalog: PlanCatalogResponse = {
  currency: 'USD', contactUrl: '/contact?reason=higher-limits', higherLimitsMessage: 'Need higher limits? Contact us to discuss your needs.', planChangesAvailable: false,
  plans: [
    { tier: 'free', name: 'Free', availability: 'available', prices: [], limits: { ...paidLimits, sessionsCreateMax: 4, chatMessagesMax: 420, customSimulationsMax: 7, customPersonasMax: 15, voiceDailyMinutes: 90 }, benefits: ['Core scenarios', 'Feedback', 'Saved practice history'] },
    { tier: 'plus', name: 'Plus', availability: 'available', limits: paidLimits, prices: [{ interval: 'month', amountCents: 900, discountLabel: null }, { interval: 'year', amountCents: 9000, discountLabel: '2 months free' }], benefits: ['Core scenarios', 'Feedback', 'Saved practice history'] },
    { tier: 'supporter', name: 'Supporter', availability: 'coming_soon', limits: paidLimits, prices: [{ interval: 'month', amountCents: 10000, discountLabel: null }, { interval: 'year', amountCents: 100000, discountLabel: '2 months free' }], benefits: ['Core scenarios', 'Feedback', 'Saved practice history', 'Guidance and support from the development team', 'Chat directly with the developers', "Help decide the project's future together"] },
  ],
};
export const freeAccount: BillingAccount = { tier: 'free', limits: catalog.plans[0].limits, supporterAccess: false, reason: 'free', interval: null, paidThrough: null, accessThrough: null, status: 'none', cancelAtPeriodEnd: false, renews: false, pendingChange: null, pendingCheckout: false, confirmationPending: false, usage: { sessions: null, chatMessages: null, customSimulations: null, customPersonas: null, voice: null }, planChangesAvailable: false, contactUrl: '/contact?reason=higher-limits' };
