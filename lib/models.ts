import { SupportedModels } from "./types";

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
