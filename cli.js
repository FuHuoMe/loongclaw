#!/usr/bin/env node
import { config } from 'dotenv';
import { createAgent } from './core/agent.js';
import { createToolManager } from './core/tools.js';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';

config();

function parseArgs(argv) {
  const args = { repl: false, sessionId: 'default', json: false, noTools: false, listPath: null };
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
    } else if (arg === '--session') {
      args.sessionId = argv[i + 1] || 'default';
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { args, message: rest.join(' ') };
}

function buildAgentConfig() {
  return {
    llm: {
      provider: process.env.LLM_PROVIDER || 'deepseek',
      apiKey: process.env.LLM_PROVIDER === 'glm'
        ? process.env.GLM_API_KEY
        : (process.env.DEEPSEEK_API_KEY || process.env.GLM_API_KEY),
      apiUrl: process.env.LLM_PROVIDER === 'glm'
        ? (process.env.GLM_API_URL || 'https://open.bigmodel.cn/api/anthropic')
        : (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'),
      format: process.env.LLM_FORMAT || (process.env.LLM_PROVIDER === 'glm' ? null : 'openai'),
      model: process.env.LLM_PROVIDER === 'glm'
        ? (process.env.GLM_MODEL
          ? process.env.GLM_MODEL.split(',').map(item => item.trim()).filter(Boolean)
          : ['glm-5', 'glm-4.7'])
        : (process.env.DEEPSEEK_MODEL || 'deepseek-chat')
    },
    memory: {
      memoryDir: process.env.MEMORY_DIR || './memory'
    },
    system: {
      name: '熊大',
      role: '森林守护者',
      vibe: '强壮、聪明、勇敢，保护森林',
      timezone: 'Asia/Shanghai'
    }
  };
}

async function runOnce(agent, message, options) {
  const output = await agent.process(message, options.sessionId);
  if (options.json) {
    process.stdout.write(JSON.stringify({ content: output }) + '\n');
  } else {
    process.stdout.write(`${output}\n`);
  }
}

async function runRepl(agent, options) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const ask = () => new Promise(resolve => rl.question('> ', resolve));
  while (true) {
    const message = await ask();
    if (!message || message.trim().toLowerCase() === 'exit') {
      rl.close();
      break;
    }
    await runOnce(agent, message, options);
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

async function main() {
  const { args, message } = parseArgs(process.argv.slice(2));
  if (args.listPath) {
    await runList(args.listPath, args);
    return;
  }
  const agent = await createAgent(buildAgentConfig());
  if (args.repl || !message) {
    await runRepl(agent, args);
    return;
  }
  await runOnce(agent, message, args);
}

main();
