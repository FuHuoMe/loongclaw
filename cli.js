#!/usr/bin/env node
import { config } from 'dotenv';
import { createAgent } from './core/agent.js';
import { createToolManager } from './core/tools.js';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';

config();

function parseArgs(argv) {
  const args = {
    repl: false,
    sessionId: 'default',
    json: false,
    noTools: false,
    listPath: null,
    readPath: null,
    writePath: null,
    writeContent: null
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repl') {
      args.repl = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--no-tools') {
      args.noTools = true;
    } else if (arg === '--list') {
      args.listPath = argv[i + 1] || '.';
      i += 1;
    } else if (arg === '--read') {
      args.readPath = argv[i + 1] || '';
      i += 1;
    } else if (arg === '--write') {
      args.writePath = argv[i + 1] || '';
      args.writeContent = argv[i + 2] || '';
      i += 2;
    } else if (arg === '--session') {
      args.sessionId = argv[i + 1] || 'default';
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { args, message: rest.join(' ') };
}

function normalizeModelList(value, fallback) {
  if (Array.isArray(value)) {
    const list = value.map(item => String(item).trim()).filter(Boolean);
    return list.length > 0 ? list : fallback;
  }
  if (typeof value === 'string') {
    const list = value.split(',').map(item => item.trim()).filter(Boolean);
    return list.length > 0 ? list : fallback;
  }
  return fallback;
}

function resolveLanguage(input) {
  const value = (input || '').toLowerCase();
  if (value === 'zh' || value === 'zh-cn' || value === 'cn' || value === '中文' || value === 'chinese') {
    return 'zh';
  }
  if (value === 'en' || value === 'en-us' || value === 'english') {
    return 'en';
  }
  return 'en';
}

function getDefaultLanguage() {
  return resolveLanguage(process.env.CLI_LANG || process.env.LOONGCLAW_LANG);
}

function getDefaultModels(provider) {
  if (provider === 'glm') {
    return normalizeModelList(process.env.GLM_MODEL, ['glm-5', 'glm-4.7']);
  }
  if (provider === 'kimi') {
    return normalizeModelList(process.env.KIMI_MODEL, ['moonshot-v1-8k']);
  }
  return normalizeModelList(process.env.DEEPSEEK_MODEL, ['deepseek-chat']);
}

function buildAgentConfig(overrides = {}) {
  const provider = overrides.llm?.provider || process.env.LLM_PROVIDER || 'deepseek';
  const apiKey = overrides.llm?.apiKey || (provider === 'glm'
    ? process.env.GLM_API_KEY
    : (provider === 'kimi'
      ? process.env.KIMI_API_KEY
      : (process.env.DEEPSEEK_API_KEY || process.env.GLM_API_KEY)));
  const apiUrl = overrides.llm?.apiUrl || (provider === 'glm'
    ? (process.env.GLM_API_URL || 'https://open.bigmodel.cn/api/anthropic')
    : (provider === 'kimi'
      ? (process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1/chat/completions')
      : (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions')));
  const defaultModels = getDefaultModels(provider);
  const model = overrides.llm?.model ?? (provider === 'glm' ? defaultModels : defaultModels[0]);
  const language = resolveLanguage(overrides.system?.language || getDefaultLanguage());
  return {
    llm: {
      provider,
      apiKey,
      apiUrl,
      format: process.env.LLM_FORMAT || (provider === 'glm' ? null : 'openai'),
      model
    },
    memory: {
      memoryDir: process.env.MEMORY_DIR || './memory'
    },
    system: {
      name: '熊大',
      role: '森林守护者',
      vibe: '强壮、聪明、勇敢，保护森林',
      timezone: 'Asia/Shanghai',
      language
    }
  };
}

function getCurrentModel(config) {
  const current = config.llm?.model;
  if (Array.isArray(current)) {
    return current[0] || '';
  }
  if (typeof current === 'string') {
    return current;
  }
  const fallback = getDefaultModels(config.llm?.provider || 'deepseek');
  return fallback[0] || '';
}

function getAvailableModels(provider) {
  return getDefaultModels(provider || 'deepseek');
}

function formatModelStatus(config) {
  const provider = config.llm?.provider || 'deepseek';
  const currentModel = getCurrentModel(config);
  const apiUrl = config.llm?.apiUrl || '';
  return {
    provider,
    model: currentModel,
    apiUrl,
    language: resolveLanguage(config.system?.language || getDefaultLanguage())
  };
}

function outputText(text, options) {
  if (options.json) {
    process.stdout.write(JSON.stringify({ content: text }) + '\n');
    return;
  }
  process.stdout.write(`${text}\n`);
}

function t(lang, key, data = {}) {
  const dict = {
    en: {
      currentProvider: 'Current provider',
      currentModel: 'Current model',
      availableModels: 'Available models',
      usage: 'Usage',
      switchedProvider: 'Switched provider',
      switchedModel: 'Switched model',
      apiUrl: 'API URL',
      missingApiKey: 'Missing API key, cannot switch to',
      unknownCommand: 'Unknown command',
      commands: 'Commands',
      langUsage: 'Usage',
      langCurrent: 'Current language',
      langChanged: 'Language changed',
      langOptions: 'Options',
      langInvalid: 'Unsupported language, fallback to English',
      readPathMissing: 'Missing file path: --read <path>',
      writePathMissing: 'Missing file path: --write <path> <content>',
      writeSuccess: 'Write success',
      internalModelHint: 'This is an internal command. Use /model or /models in CLI'
    },
    zh: {
      currentProvider: '当前提供商',
      currentModel: '当前模型',
      availableModels: '可用模型',
      usage: '用法',
      switchedProvider: '已切换提供商',
      switchedModel: '已切换模型',
      apiUrl: 'API 地址',
      missingApiKey: '缺少 API Key，无法切换到',
      unknownCommand: '未知命令',
      commands: '可用命令',
      langUsage: '用法',
      langCurrent: '当前语言',
      langChanged: '已切换语言',
      langOptions: '可选值',
      langInvalid: '不支持的语言，已回退为英文',
      readPathMissing: '缺少文件路径：--read <path>',
      writePathMissing: '缺少文件路径：--write <path> <content>',
      writeSuccess: '写入成功',
      internalModelHint: '这是内部指令，请在 CLI 中使用 /model 或 /models'
    }
  };
  const base = dict[lang] || dict.en;
  const template = base[key] || dict.en[key] || '';
  return template.replace(/\{(\w+)\}/g, (_, name) => (data[name] ?? ''));
}

function cloneSessionHistory(sourceAgent, targetAgent, sessionId) {
  const history = sourceAgent.getHistory(sessionId);
  if (history.length === 0) {
    return;
  }
  targetAgent.sessions.set(sessionId, {
    id: sessionId,
    messages: history.slice(),
    createdAt: new Date()
  });
}

async function handleSlashCommand(input, agent, state, options) {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false, agent };
  }
  const parts = trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
  const command = (parts[0] || '').toLowerCase();
  const args = parts.slice(1);
  if (!command) {
    return { handled: true, agent };
  }
  if (command === 'models') {
    const targetProvider = args[0] || state.config.llm.provider;
    const models = getAvailableModels(targetProvider);
    const status = formatModelStatus(state.config);
    const lang = status.language;
    const lines = [
      `${t(lang, 'currentProvider')}: ${status.provider}`,
      `${t(lang, 'currentModel')}: ${status.model || '-'}`,
      `${t(lang, 'availableModels')} (${targetProvider}):`,
      ...models.map(item => `- ${item}`)
    ];
    outputText(lines.join('\n'), options);
    return { handled: true, agent };
  }
  if (command === 'model') {
    const status = formatModelStatus(state.config);
    const lang = status.language;
    if (args.length === 0) {
      const lines = [
        `${t(lang, 'currentProvider')}: ${status.provider}`,
        `${t(lang, 'currentModel')}: ${status.model || '-'}`,
        `${t(lang, 'usage')}:`,
        '/models [provider]',
        '/model <provider> [model]',
        '/model <model>'
      ];
      outputText(lines.join('\n'), options);
      return { handled: true, agent };
    }
    const providerList = ['deepseek', 'glm', 'kimi'];
    const first = args[0].toLowerCase();
    let nextProvider = status.provider;
    let nextModel = null;
    if (providerList.includes(first)) {
      nextProvider = first;
      nextModel = args[1] || null;
    } else {
      nextModel = args[0];
    }
    const available = getAvailableModels(nextProvider);
    const resolvedModel = nextModel || available[0] || '';
    const nextConfig = buildAgentConfig({
      llm: {
        provider: nextProvider,
        model: resolvedModel
      },
      system: {
        language: state.config.system?.language || getDefaultLanguage()
      }
    });
    if (!nextConfig.llm.apiKey) {
      outputText(`${t(lang, 'missingApiKey')} ${nextProvider}`, options);
      return { handled: true, agent };
    }
    const nextAgent = await createAgent(nextConfig);
    cloneSessionHistory(agent, nextAgent, state.sessionId);
    state.config = nextConfig;
    const updated = formatModelStatus(state.config);
    const updatedLang = updated.language;
    const lines = [
      `${t(updatedLang, 'switchedProvider')}: ${updated.provider}`,
      `${t(updatedLang, 'switchedModel')}: ${updated.model || '-'}`,
      `${t(updatedLang, 'apiUrl')}: ${updated.apiUrl || '-'}`
    ];
    outputText(lines.join('\n'), options);
    return { handled: true, agent: nextAgent };
  }
  if (command === 'lang') {
    const status = formatModelStatus(state.config);
    const lang = status.language;
    if (args.length === 0) {
      const lines = [
        `${t(lang, 'langCurrent')}: ${lang}`,
        `${t(lang, 'langUsage')}:`,
        '/lang en',
        '/lang zh',
        `${t(lang, 'langOptions')}: en | zh`
      ];
      outputText(lines.join('\n'), options);
      return { handled: true, agent };
    }
    const raw = (args[0] || '').toLowerCase();
    const supported = ['en', 'en-us', 'english', 'zh', 'zh-cn', 'cn', '中文', 'chinese'];
    const nextLang = resolveLanguage(raw);
    const nextConfig = buildAgentConfig({
      llm: {
        provider: state.config.llm?.provider,
        model: getCurrentModel(state.config)
      },
      system: {
        language: nextLang
      }
    });
    if (!nextConfig.llm.apiKey) {
      outputText(`${t(lang, 'missingApiKey')} ${state.config.llm?.provider || 'deepseek'}`, options);
      return { handled: true, agent };
    }
    const nextAgent = await createAgent(nextConfig);
    cloneSessionHistory(agent, nextAgent, state.sessionId);
    state.config = nextConfig;
    const lines = [
      `${t(nextLang, 'langChanged')}: ${nextLang}`
    ];
    outputText(lines.join('\n'), options);
    if (!supported.includes(raw)) {
      outputText(t(nextLang, 'langInvalid'), options);
    }
    return { handled: true, agent: nextAgent };
  }
  if (command === 'help') {
    const status = formatModelStatus(state.config);
    const lang = status.language;
    const lines = [
      `${t(lang, 'commands')}:`,
      '/model <provider> [model]',
      '/model <model>',
      '/models [provider]',
      '/lang en|zh'
    ];
    outputText(lines.join('\n'), options);
    return { handled: true, agent };
  }
  const status = formatModelStatus(state.config);
  const lang = status.language;
  outputText(`${t(lang, 'unknownCommand')}: /${command}`, options);
  return { handled: true, agent };
}

async function runOnce(agent, message, options, state) {
  const handled = await handleSlashCommand(message, agent, state, options);
  if (handled.handled) {
    return;
  }
  const output = await handled.agent.process(message, options.sessionId);
  outputText(output, options);
}

async function runRepl(agent, options, state) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const ask = () => new Promise(resolve => rl.question('> ', resolve));
  let currentAgent = agent;
  while (true) {
    const message = await ask();
    if (!message || message.trim().toLowerCase() === 'exit') {
      rl.close();
      break;
    }
    const handled = await handleSlashCommand(message, currentAgent, state, options);
    if (handled.handled) {
      currentAgent = handled.agent;
      continue;
    }
    await runOnce(currentAgent, message, options, state);
  }
}

async function runList(listPath, options) {
  const workspaceDir = './workspace';
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
  }
  const tools = createToolManager();
  const result = await tools.call('list_directory', { path: listPath || '.' });
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  if (!Array.isArray(result)) {
    process.stdout.write(`${String(result)}\n`);
    return;
  }
  for (const entry of result) {
    const label = entry.type === 'directory' ? 'dir' : 'file';
    process.stdout.write(`${label}\t${entry.name}\n`);
  }
}

async function runRead(readPath, options) {
  const lang = getDefaultLanguage();
  const workspaceDir = './workspace';
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
  }
  if (!readPath) {
    process.stderr.write(`${t(lang, 'readPathMissing')}\n`);
    process.exit(1);
  }
  const tools = createToolManager();
  const result = await tools.call('read_file', { path: readPath });
  if (options.json) {
    process.stdout.write(JSON.stringify({ content: result }) + '\n');
    return;
  }
  process.stdout.write(`${String(result)}\n`);
}

async function runWrite(writePath, writeContent, options) {
  const lang = getDefaultLanguage();
  const workspaceDir = './workspace';
  if (!existsSync(workspaceDir)) {
    await mkdir(workspaceDir, { recursive: true });
  }
  if (!writePath) {
    process.stderr.write(`${t(lang, 'writePathMissing')}\n`);
    process.exit(1);
  }
  const tools = createToolManager();
  const result = await tools.call('write_file', { path: writePath, content: writeContent || '' });
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  if (result?.success) {
    process.stdout.write(`${t(lang, 'writeSuccess')}: ${result.path}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

async function main() {
  const { args, message } = parseArgs(process.argv.slice(2));
  if (args.listPath) {
    await runList(args.listPath, args);
    return;
  }
  if (args.readPath !== null) {
    await runRead(args.readPath, args);
    return;
  }
  if (args.writePath !== null) {
    await runWrite(args.writePath, args.writeContent, args);
    return;
  }
  const initialConfig = buildAgentConfig();
  const state = {
    config: initialConfig,
    sessionId: args.sessionId
  };
  const agent = await createAgent(initialConfig);
  if (args.repl || !message) {
    await runRepl(agent, args, state);
    return;
  }
  await runOnce(agent, message, args, state);
}

main();
