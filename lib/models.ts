import { SupportedModels, type Currency, type TokenUsage } from "./types";

// Client-safe provider/model metadata (no server SDK imports — safe to import
// from React components).

export type Provider = "anthropic";

export interface ProviderMeta {
  label: string;
  keyHint: string;
  keysUrl: string;
  fetchModels: (apiKey?: string) => Promise<SupportedModels>;
}

export const PROVIDERS: Record<Provider, ProviderMeta> = {
  anthropic: {
    label: "Anthropic — Claude",
    keyHint: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
    fetchModels: async (apiKey?: string) => {
      try {
        const res = await fetch("/api/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "anthropic", apiKey }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.models;
      } catch {
        return [];
      }
    },
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as Provider[];

// ── Cost estimation ─────────────────────────────────────────────────────────
// Approximate USD-per-million-token pricing, matched against the selected
// model id by family keyword (checked in order — most specific first). The
// exact figure depends on Anthropic's currently published pricing for
// whichever model the user picked, which can change — so this is always
// presented as an ESTIMATE, not an exact bill.
interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

const PRICE_TABLE: { match: RegExp; price: ModelPrice }[] = [
  { match: /opus/i, price: { inputPerM: 15, outputPerM: 75 } },
  { match: /haiku/i, price: { inputPerM: 0.8, outputPerM: 4 } },
  { match: /sonnet/i, price: { inputPerM: 3, outputPerM: 15 } },
];

// Sonnet-tier — the most commonly used mid-range model — is the safest
// fallback for a model id that doesn't match a known family.
const DEFAULT_PRICE: ModelPrice = { inputPerM: 3, outputPerM: 15 };

export function priceForModel(model: string): ModelPrice {
  return PRICE_TABLE.find((p) => p.match.test(model))?.price ?? DEFAULT_PRICE;
}

// Anthropic's standard prompt-caching multipliers on the base input price:
// writing a new cache entry (5-min ephemeral TTL, what this app uses) costs
// 1.25x; reading a cache hit costs 0.1x. Applied on top of the same
// per-model input price looked up above — see lib/claude.ts cachedSystem for
// where these tokens come from (the repeated system prompt across a run's
// many tile/verify calls).
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = priceForModel(model);
  return (
    (usage.inputTokens / 1e6) * price.inputPerM +
    (usage.outputTokens / 1e6) * price.outputPerM +
    ((usage.cacheWriteTokens ?? 0) / 1e6) * price.inputPerM * CACHE_WRITE_MULTIPLIER +
    ((usage.cacheReadTokens ?? 0) / 1e6) * price.inputPerM * CACHE_READ_MULTIPLIER
  );
}

// Static approximation, not a live FX rate — good enough for a rough
// estimate that's already only accurate to the model's price tier.
const USD_TO_EUR = 0.92;

export function estimateCost(model: string, usage: TokenUsage, currency: Currency): number {
  const usd = estimateCostUsd(model, usage);
  return currency === "EUR" ? usd * USD_TO_EUR : usd;
}

// Most runs land well under $1/€1 — show extra precision there so a cheap
// run doesn't just read as a misleading "0.00".
export function formatCost(amount: number, currency: Currency): string {
  const value = amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2);
  return currency === "EUR" ? `${value} €` : `$${value}`;
}
