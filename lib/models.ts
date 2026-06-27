// Client-safe provider/model metadata (no server SDK imports — safe to import
// from React components).

export type Provider = "anthropic" | "gemini";

export interface ProviderMeta {
  label: string;
  models: string[];
  defaultModel: string;
  keyHint: string;
  keysUrl: string;
}

export const PROVIDERS: Record<Provider, ProviderMeta> = {
  anthropic: {
    label: "Anthropic — Claude",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    defaultModel: "claude-opus-4-8",
    keyHint: "sk-ant-…",
    keysUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    label: "Google — Gemini",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    defaultModel: "gemini-2.5-pro",
    keyHint: "AIza…",
    keysUrl: "https://aistudio.google.com/apikey",
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as Provider[];
