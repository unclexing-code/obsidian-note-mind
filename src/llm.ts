import type { MindmapDocument, MindmapNode } from "./types";
import type { LlmProvider, MindmapPluginSettings } from "./settings";
import { llmProviderRequiresApiKey } from "./settings";

export interface GenerateChildNodesContext {
  parentTitle: string;
  parentNote?: string;
  existingChildren: string[];
  userPrompt: string;
  mindmapContext: string;
  minCount: number;
  maxCount: number;
}

export interface GeneratedMindmapNode {
  title: string;
  children: GeneratedMindmapNode[];
}

const MAX_NOTE_LENGTH = 300;

export const serializeMindmapContext = (
  doc: MindmapDocument,
  targetNodeId: string
): string => {
  const lines: string[] = [];

  const appendNode = (node: MindmapNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    const marker = node.id === targetNodeId ? " [目标父节点]" : "";
    lines.push(`${indent}- ${node.title.trim() || "未命名节点"}${marker}`);

    const note = node.note?.trim();
    if (note) {
      const truncated = note.length > MAX_NOTE_LENGTH
        ? `${note.slice(0, MAX_NOTE_LENGTH)}...`
        : note;
      lines.push(`${indent}  笔记: ${truncated}`);
    }

    node.children.forEach((child) => appendNode(child, depth + 1));
  };

  appendNode(doc.root, 0);
  return lines.join("\n");
};

interface LlmEndpoint {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

const getEndpoint = (settings: MindmapPluginSettings): LlmEndpoint => {
  const apiKey = settings.apiKey.trim();
  switch (settings.llmProvider) {
    case "openai":
      return {
        baseUrl: "https://api.openai.com/v1",
        model: settings.openaiModel.trim() || "gpt-4o-mini",
        apiKey
      };
    case "ollama": {
      const baseUrl = normalizeBaseUrl(settings.ollamaBaseUrl) || "http://127.0.0.1:11434";
      const model = settings.ollamaModel.trim();
      if (!model) {
        throw new Error("请先在设置中选择 Ollama 模型");
      }
      return {
        baseUrl: `${baseUrl}/v1`,
        model,
        apiKey: ""
      };
    }
    case "custom": {
      const baseUrl = normalizeBaseUrl(settings.customBaseUrl);
      if (!baseUrl) {
        throw new Error("请先在设置中填写自定义 API 地址");
      }
      return {
        baseUrl,
        model: settings.customModel.trim() || "deepseek-chat",
        apiKey
      };
    }
    case "deepseek":
    default:
      return {
        baseUrl: "https://api.deepseek.com",
        model: settings.deepseekModel.trim() || "deepseek-chat",
        apiKey
      };
  }
};

export const fetchOllamaModels = async (baseUrl: string): Promise<string[]> => {
  const normalized = normalizeBaseUrl(baseUrl) || "http://127.0.0.1:11434";
  const response = await fetch(`${normalized}/api/tags`);
  if (!response.ok) {
    throw new Error(`无法连接 Ollama (${response.status})，请确认服务已启动`);
  }

  const data = await response.json() as {
    models?: Array<{ name?: string }>;
  };
  const models = (data.models ?? [])
    .map((item) => item.name?.trim() ?? "")
    .filter((name) => name.length > 0)
    .sort((a, b) => a.localeCompare(b));

  if (models.length === 0) {
    throw new Error("Ollama 未返回可用模型，请先执行 ollama pull 下载模型");
  }

  return models;
};

const buildPrompt = (context: GenerateChildNodesContext): string => {
  const existing = context.existingChildren.length > 0
    ? context.existingChildren.map((title) => `- ${title}`).join("\n")
    : "（无）";

  return [
    "你是一个思维导图助手。请结合完整导图上下文、目标父节点和用户要求，生成适合作为其子主题的标题。",
    "",
    "完整导图结构：",
    context.mindmapContext,
    "",
    `目标父节点标题：${context.parentTitle}`,
    context.parentNote?.trim() ? `目标父节点笔记：\n${context.parentNote.trim()}` : "",
    `目标父节点已有子节点：\n${existing}`,
    "",
    "用户生成要求：",
    context.userPrompt.trim(),
    "",
    `请生成 ${context.minCount} 到 ${context.maxCount} 个子主题标题。`,
    "要求：",
    "1. 标题简洁，每个不超过 20 个汉字或 40 个英文字符",
    "2. 结合导图整体语境与用户要求，与目标父节点主题相关",
    "3. 彼此不重复，且不与目标父节点已有子节点重复",
    "4. 只返回 JSON 数组，数组元素格式为 {\"title\":\"子主题\",\"children\":[{\"title\":\"孙主题\",\"children\":[]}]}",
    "5. 可以根据用户要求生成多层子主题；如果没有下级主题，children 返回空数组",
    "6. 不要输出任何解释、代码块标记或其他文字"
  ].filter(Boolean).join("\n");
};

const extractJsonArray = (content: string): GeneratedMindmapNode[] => {
  const trimmed = content.trim();
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型返回格式无效，未找到 JSON 数组");
  }

  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("模型返回格式无效，期望 JSON 数组");
  }

  const normalizeNodes = (items: unknown[]): GeneratedMindmapNode[] => items
    .map((item) => {
      if (typeof item === "string") {
        return { title: item.trim(), children: [] };
      }
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as { title?: unknown; children?: unknown };
      const title = typeof record.title === "string" ? record.title.trim() : "";
      return title.length > 0
        ? { title, children: Array.isArray(record.children) ? normalizeNodes(record.children) : [] }
        : null;
    })
    .filter((node): node is GeneratedMindmapNode => node !== null);

  const nodes = normalizeNodes(parsed);
  if (nodes.length === 0) {
    throw new Error("模型未返回有效的子节点标题");
  }
  return nodes;
};

export const generateChildNodeTitles = async (
  settings: MindmapPluginSettings,
  context: GenerateChildNodesContext
): Promise<GeneratedMindmapNode[]> => {
  const endpoint = getEndpoint(settings);
  if (llmProviderRequiresApiKey(settings.llmProvider) && !endpoint.apiKey) {
    throw new Error("请先在插件设置中填写 API Key");
  }

  const minCount = Math.max(1, context.minCount);
  const maxCount = Math.max(minCount, context.maxCount);
  const prompt = buildPrompt({ ...context, minCount, maxCount });

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (endpoint.apiKey) {
    headers.Authorization = `Bearer ${endpoint.apiKey}`;
  }

  const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: endpoint.model,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "你只输出 JSON 字符串数组，不输出其他任何内容。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败 (${response.status})：${errorText.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error("模型返回内容为空");
  }

  const nodes = extractJsonArray(content);
  const seenTitles = new Set<string>();
  const uniqueNodes = nodes.filter((node) => {
    const normalized = node.title.toLowerCase();
    if (seenTitles.has(normalized)) {
      return false;
    }
    seenTitles.add(normalized);
    return true;
  });
  return uniqueNodes.slice(0, maxCount);
};

export const getProviderLabel = (provider: LlmProvider): string => {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "ollama":
      return "Ollama";
    case "custom":
      return "自定义";
    case "deepseek":
    default:
      return "DeepSeek";
  }
};
