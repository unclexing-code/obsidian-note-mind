export type LlmProvider = "deepseek" | "openai" | "ollama" | "custom";

export interface MindmapPluginSettings {
  llmProvider: LlmProvider;
  apiKey: string;
  deepseekModel: string;
  openaiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  customBaseUrl: string;
  customModel: string;
  minChildCount: number;
  maxChildCount: number;
}

export const DEFAULT_SETTINGS: MindmapPluginSettings = {
  llmProvider: "deepseek",
  apiKey: "",
  deepseekModel: "deepseek-chat",
  openaiModel: "gpt-4o-mini",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  customBaseUrl: "",
  customModel: "",
  minChildCount: 1,
  maxChildCount: 3
};

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  ollama: "Ollama（本地）",
  custom: "自定义"
};

export const llmProviderRequiresApiKey = (provider: LlmProvider): boolean => {
  return provider !== "ollama";
};

export interface MindmapPluginApi {
  settings: MindmapPluginSettings;
  saveSettings(): Promise<void>;
}

export const MINDMAP_PLUGIN_ID = "mindmap-notes";

export const getMindmapPlugin = (app: { plugins?: { plugins?: Record<string, unknown> } }): MindmapPluginApi | null => {
  const plugin = app.plugins?.plugins?.[MINDMAP_PLUGIN_ID];
  if (!plugin || typeof plugin !== "object" || !("settings" in plugin)) {
    return null;
  }
  return plugin as MindmapPluginApi;
};
