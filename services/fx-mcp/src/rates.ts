// Static demo rates. Every currency is priced against USD, so any pair goes through USD.
// `minor` is the number of decimals the currency uses (JPY has none).
export const AS_OF = "2026-10-01";

const TABLE: Record<string, { perUsd: number; minor: number }> = {
  USD: { perUsd: 1, minor: 2 },
  EUR: { perUsd: 0.92, minor: 2 },
  GBP: { perUsd: 0.79, minor: 2 },
  JPY: { perUsd: 150, minor: 0 },
  INR: { perUsd: 83, minor: 2 },
  AUD: { perUsd: 1.52, minor: 2 },
  CAD: { perUsd: 1.36, minor: 2 },
  CHF: { perUsd: 0.88, minor: 2 },
};

function entry(code: string) {
  const e = TABLE[code];
  if (!e) throw new Error(`Unknown currency ${code}. Supported: ${Object.keys(TABLE).join(", ")}`);
  return e;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// The rate is returned as is; only the result is rounded, to the target currency's decimals.
export function convert(amount: number, from: string, to: string) {
  const rate = entry(to).perUsd / entry(from).perUsd;
  return { amount, from, to, rate, result: roundTo(amount * rate, entry(to).minor), as_of: AS_OF };
}

export function ratesFor(base: string) {
  const baseUsd = entry(base).perUsd;
  const rates: Record<string, number> = {};
  for (const [code, e] of Object.entries(TABLE)) {
    if (code !== base) rates[code] = e.perUsd / baseUsd;
  }
  return { base, rates, as_of: AS_OF };
}
