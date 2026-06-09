// Hypergeometric probability helpers for the sample-hand simulator.

// C(n, k) computed in log space to stay finite for deck-sized inputs.
function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  let s = 0;
  for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1);
  return s;
}

// P(exactly k successes in a draw of n, from a population N containing K successes).
export function hypergeometric(N: number, K: number, n: number, k: number): number {
  if (N <= 0 || n > N || k > K || n - k > N - K) return 0;
  return Math.exp(lnChoose(K, k) + lnChoose(N - K, n - k) - lnChoose(N, n));
}

// P(at least k successes).
export function hypergeometricAtLeast(N: number, K: number, n: number, k: number): number {
  let p = 0;
  for (let i = k; i <= Math.min(K, n); i++) p += hypergeometric(N, K, n, i);
  return Math.min(1, p);
}

// Fisher-Yates shuffle (non-mutating).
export function shuffled<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
