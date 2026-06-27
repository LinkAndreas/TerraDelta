// Client-safe provider/model metadata (no server SDK imports — safe to import
// from React components).

export type Provider = "anthropic";

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
};

export const PROVIDER_KEYS = Object.keys(PROVIDERS) as Provider[];
