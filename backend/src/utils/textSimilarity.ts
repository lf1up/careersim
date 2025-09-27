/**
 * Lightweight text similarity helpers to reduce duplicate AI follow-ups.
 */

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Jaccard similarity over token sets in [0,1].
 */
export function jaccardTokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Character n-gram Jaccard similarity (n=3 by default).
 */
export function jaccardCharSimilarity(a: string, b: string, n = 3): number {
  const grams = (s: string) => {
    const clean = (s || '').toLowerCase();
    const res: string[] = [];
    for (let i = 0; i <= clean.length - n; i++) {
      res.push(clean.slice(i, i + n));
    }
    return new Set(res);
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  const intersection = [...ga].filter(g => gb.has(g)).length;
  const union = new Set([...ga, ...gb]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Composite similarity in [0,1] using tokens and char-grams.
 */
export function compositeSimilarity(a: string, b: string): number {
  const tokenSim = jaccardTokenSimilarity(a, b);
  const charSim = jaccardCharSimilarity(a, b, 3);
  return (tokenSim * 0.6) + (charSim * 0.4);
}


