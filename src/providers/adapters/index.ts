import { createUnavailableAdapter } from './unavailable';
import { createAnthropicAdapter } from './anthropic';
import { createGmailAdapter } from './gmail';
import { createRedditAdapter } from './reddit';
import {
  createExaAdapter,
  createFirecrawlAdapter,
  createHunterAdapter,
  createOpenAiAdapter,
} from './http';

function readServerEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env[name]) return process.env[name];
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get(key: string): string | undefined } };
  };
  return runtime.Deno?.env?.get(name);
}

const serverOpenAiKey = readServerEnv('SALES_OS_OPENAI_API_KEY');
const serverOpenAiModel = readServerEnv('SALES_OS_OPENAI_MODEL');
export const openAiAdapter =
  serverOpenAiKey && serverOpenAiModel
    ? createOpenAiAdapter({ apiKey: serverOpenAiKey, model: serverOpenAiModel })
    : createUnavailableAdapter('openai', ['reasoning']);
const serverAnthropicApiKey = readServerEnv('SALES_OS_ANTHROPIC_API_KEY');
const serverAnthropicModel = readServerEnv('SALES_OS_ANTHROPIC_MODEL');
const serverAnthropicInputCost = Number(
  readServerEnv('SALES_OS_ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS'),
);
const serverAnthropicOutputCost = Number(
  readServerEnv('SALES_OS_ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS'),
);
export const anthropicAdapter =
  serverAnthropicApiKey &&
  serverAnthropicModel &&
  Number.isFinite(serverAnthropicInputCost) &&
  serverAnthropicInputCost > 0 &&
  Number.isFinite(serverAnthropicOutputCost) &&
  serverAnthropicOutputCost > 0
    ? createAnthropicAdapter({
        apiKey: serverAnthropicApiKey,
        model: serverAnthropicModel,
        inputCostPerMillionTokens: serverAnthropicInputCost,
        outputCostPerMillionTokens: serverAnthropicOutputCost,
      })
    : createUnavailableAdapter('anthropic', ['reasoning']);
const serverExaKey = readServerEnv('SALES_OS_EXA_API_KEY');
export const exaAdapter = serverExaKey
  ? createExaAdapter({ apiKey: serverExaKey })
  : createUnavailableAdapter('exa', [
      'searchWeb',
      'findCompany',
      'findPerson',
      'findContact',
    ]);
const serverFirecrawlKey = readServerEnv('SALES_OS_FIRECRAWL_API_KEY');
export const firecrawlAdapter = serverFirecrawlKey
  ? createFirecrawlAdapter({ apiKey: serverFirecrawlKey })
  : createUnavailableAdapter('firecrawl', ['scrapePage']);
const serverHunterKey = readServerEnv('SALES_OS_HUNTER_API_KEY');
export const hunterAdapter = serverHunterKey
  ? createHunterAdapter({ apiKey: serverHunterKey })
  : createUnavailableAdapter('hunter', ['findContact', 'verifyContact']);
const serverGmailAccessToken = readServerEnv('SALES_OS_GMAIL_ACCESS_TOKEN');
const serverGmailUser = readServerEnv('SALES_OS_GMAIL_USER');
export const gmailAdapter = serverGmailAccessToken
  ? createGmailAdapter({ accessToken: serverGmailAccessToken, userId: serverGmailUser })
  : createUnavailableAdapter('gmail', ['sendEmail']);
const serverRedditClientId = readServerEnv('SALES_OS_REDDIT_CLIENT_ID');
const serverRedditClientSecret = readServerEnv('SALES_OS_REDDIT_CLIENT_SECRET');
const serverRedditUserAgent = readServerEnv('SALES_OS_REDDIT_USER_AGENT');
export const communityAdapter =
  serverRedditClientId && serverRedditClientSecret && serverRedditUserAgent
    ? createRedditAdapter({
        clientId: serverRedditClientId,
        clientSecret: serverRedditClientSecret,
        userAgent: serverRedditUserAgent,
      })
    : createUnavailableAdapter('community', ['searchCommunity']);
