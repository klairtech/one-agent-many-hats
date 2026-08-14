/**
 * Provider presets. ADR-0002: every vendor below is a base URL + an auth style + an
 * env var. Only four adapters exist; this table is data.
 *
 * Every `baseUrl` here was probed on 2026-08-14 and answered an unauthenticated
 * chat-completions POST with 401 (or 400 for xai/gemini, which validate the body before
 * the key). That proves the host and path exist. It does not prove any particular model
 * id exists — which is why this table deliberately carries **no model ids**. Model lists
 * are fetched live by `hats models`, so the runtime never asserts a model that may have
 * been renamed or retired.
 */

export type ProviderKind = 'openai-compat' | 'anthropic' | 'gemini' | 'ollama' | 'mock';

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Environment variable the key is read from. Keys are never written to config.json. */
  apiKeyEnv?: string;
  /** Path appended to baseUrl to list models, when the vendor offers one. */
  modelsPath?: string;
  docs?: string;
  note?: string;
}

export const PRESETS: Record<string, ProviderPreset> = {
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    docs: 'https://ollama.com',
    note: 'No key needed. Tool calling depends on the model: qwen2.5 has it, gemma3 does not — hats falls back to the text tool protocol automatically.',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local, OpenAI-compatible)',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelsPath: '/models',
    note: 'Start the LM Studio local server first.',
  },
  vllm: {
    id: 'vllm',
    label: 'vLLM / any OpenAI-compatible server',
    kind: 'openai-compat',
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelsPath: '/models',
    apiKeyEnv: 'VLLM_API_KEY',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    modelsPath: '/models',
    docs: 'https://docs.anthropic.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    modelsPath: '/models',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    modelsPath: '/models',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    modelsPath: '/models',
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen / Alibaba DashScope (international)',
    kind: 'openai-compat',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    modelsPath: '/models',
    note: 'Mainland China endpoint: https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  kimi: {
    id: 'kimi',
    label: 'Moonshot / Kimi',
    kind: 'openai-compat',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    modelsPath: '/models',
    note: 'Mainland China endpoint: https://api.moonshot.cn/v1',
  },
  glm: {
    id: 'glm',
    label: 'Zhipu GLM',
    kind: 'openai-compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    modelsPath: '/models',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    modelsPath: '/models',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (many vendors behind one key)',
    kind: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    modelsPath: '/models',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compat',
    baseUrl: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    modelsPath: '/models',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compat',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    modelsPath: '/models',
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai-compat',
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    modelsPath: '/models',
  },
  mock: {
    id: 'mock',
    label: 'Mock (scripted, offline — used by the test suite)',
    kind: 'mock',
    baseUrl: '',
  },
};

export function presetIds(): string[] {
  return Object.keys(PRESETS);
}
