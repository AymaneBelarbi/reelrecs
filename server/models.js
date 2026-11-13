import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';

export function createModels(config) {
  const client = {
    apiKey: config.OPENAI_API_KEY,
    maxRetries: config.OPENAI_MAX_RETRIES,
    timeout: config.OPENAI_TIMEOUT_MS,
  };
  return {
    chat: new ChatOpenAI({ ...client, model: config.CHAT_MODEL, temperature: 0.4 }),
    rewriter: new ChatOpenAI({ ...client, model: config.CHAT_MODEL, temperature: 0, maxTokens: 60 }),
    ranker: new ChatOpenAI({ ...client, model: config.RERANK_MODEL, temperature: 0 }),
    embeddings: new OpenAIEmbeddings({ ...client, model: config.EMBEDDING_MODEL }),
  };
}
