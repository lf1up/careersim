/** Build-time visibility flag shared by the pricing route and client links. */
export function isPricingEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_PRICING_ENABLED;
  return value === 'true' || value === '1';
}
