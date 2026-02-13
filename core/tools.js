/**
 * LoongClaw - 工具系统
 * 
 * 管理和执行工具调用
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const approvalFilePath = './sessions/command-approvals.json';
const approvalWindowMs = 7 * 24 * 60 * 60 * 1000;
const greenCommands = new Set(['ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'grep', 'wc', 'rg', 'which', 'whoami', 'uname', 'date', 'uptime', 'df', 'du']);
const blackCommands = new Set(['rm', 'mv', 'dd', 'truncate', 'mkfs', 'shutdown', 'reboot', 'kill', 'pkill', 'killall', 'chmod', 'chown']);
const grayCommandNames = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'node', 'python', 'python3', 'pip', 'pip3', 'go', 'cargo', 'rustc', 'javac', 'mvn', 'gradle', 'make', 'cmake', 'docker', 'docker-compose', 'kubectl', 'git', 'deno']);

function normalizeCommand(command) {
  return command.trim().replace(/\s+/g, ' ');
}

function getCommandParts(command) {
  const parts = command.split(/\s+/);
  return {
    parts,
    commandName: parts[0] || '',
    subCommand: parts[1] || '',
    subSubCommand: parts[2] || ''
  };
}

function getApprovalSignature(command) {
  return `${process.cwd()}::${command}`;
}

function classifyCommand(command) {
  const normalized = normalizeCommand(command);
  const { commandName, subCommand, subSubCommand } = getCommandParts(normalized);
  if (!commandName) {
    return 'gray';
  }
  if (blackCommands.has(commandName)) {
    return 'black';
  }
  if (greenCommands.has(commandName)) {
    return 'green';
  }
  if (commandName === 'git') {
    if (['status', 'diff', 'log', 'show'].includes(subCommand)) {
      return 'white';
    }
    if (['checkout', 'switch', 'pull', 'fetch', 'merge', 'rebase', 'reset', 'push', 'commit', 'tag', 'branch', 'stash', 'cherry-pick', 'revert', 'clean', 'init', 'clone'].includes(subCommand)) {
      return 'gray';
    }
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(commandName)) {
    if (subCommand === 'run' && ['lint', 'test', 'typecheck', 'format', 'fmt', 'check'].includes(subSubCommand)) {
      return 'white';
    }
    if (['test', 'lint'].includes(subCommand)) {
      return 'white';
    }
    if (['install', 'ci', 'i', 'add', 'remove', 'uninstall', 'update', 'publish', 'run', 'exec'].includes(subCommand)) {
      return 'gray';
    }
    return 'gray';
  }
  if (['pip', 'pip3'].includes(commandName)) {
    return 'gray';
  }
  if (grayCommandNames.has(commandName)) {
    return 'gray';
  }
  return 'white';
}

async function loadApprovals() {
  if (!existsSync(approvalFilePath)) {
    return {};
  }
  const raw = await readFile(approvalFilePath, 'utf-8');
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch (error) {
    data = {};
  }
  const now = Date.now();
  const filtered = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value.expiresAt === 'number' && value.expiresAt > now) {
      filtered[key] = value;
    }
  }
  if (Object.keys(filtered).length !== Object.keys(data || {}).length) {
    await saveApprovals(filtered);
  }
  return filtered;
}

async function saveApprovals(data) {
  if (!existsSync('./sessions')) {
    await mkdir('./sessions', { recursive: true });
  }
  await writeFile(approvalFilePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 工具基类
 */
class Tool {
  /**
   * 创建工具
   * @param {Object} config - 工具配置
   * @param {string} config.name - 工具名称
   * @param {string} config.description - 工具描述
   * @param {Object} config.parameters - 参数 schema (JSON Schema)
   * @param {Function} config.handler - 处理函数
   */
  constructor(config) {
    this.name = config.name;
    this.description = config.description;
    this.parameters = config.parameters || {
      type: 'object',
      properties: {},
      required: []
    };
    this.handler = config.handler;
    
    // 验证配置
    if (!this.name || !this.description) {
      throw new Error('工具必须包含 name 和 description');
    }
  }

  /**
   * 执行工具
   * @param {Object} args - 参数对象
   * @returns {Promise<any>} 执行结果
   */
  async execute(args, manager) {
    try {
      // 验证参数
      this._validateParameters(args);
      
      // 执行处理函数
      return await this.handler(args, manager);
      
    } catch (error) {
      throw new Error(`工具 "${this.name}" 执行失败: ${error.message}`);
    }
  }

  /**
   * 验证参数
   * @private
   */
  _validateParameters(args) {
    const required = this.parameters.required || [];
    
    for (const param of required) {
      if (!(param in args)) {
        throw new Error(`缺少必需参数: ${param}`);
      }
    }
  }

  /**
   * 导出为 API 格式
   */
  toAPIFormat() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters
      }
    };
  }
}

/**
 * 工具管理器
 */
class ToolManager {
  /**
   * 创建工具管理器
   */
  constructor() {
    this.tools = new Map();
    this.allowedPaths = ['./workspace', './memory', './sessions'];
  }

  /**
   * 注册工具
   * @param {Tool} tool - 工具实例
   */
  register(tool) {
    if (!(tool instanceof Tool)) {
      throw new Error('必须注册 Tool 实例');
    }
    
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   * @param {Tool[]} tools - 工具数组
   */
  registerAll(tools) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取工具
   * @param {string} name - 工具名称
   * @returns {Tool|undefined} 工具实例
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   * @param {string} name - 工具名称
   * @returns {boolean} 是否存在
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具
   * @returns {Tool[]} 工具数组
   */
  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * 获取 API 格式的工具列表
   * @returns {Object[]} API 格式工具列表
   */
  toAPIFormat() {
    return this.getAll().map(tool => tool.toAPIFormat());
  }

  /**
   * 调用工具
   * @param {string} name - 工具名称
   * @param {Object} args - 参数
   * @returns {Promise<any>} 执行结果
   */
  async call(name, args) {
    const tool = this.get(name);
    
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    
    return await tool.execute(args, this);
  }

  /**
   * 设置允许访问的路径
   * @param {string[]} paths - 路径数组
   */
  setAllowedPaths(paths) {
    this.allowedPaths = paths;
  }

  /**
   * 检查路径是否允许访问
   * @param {string} path - 检查的路径
   * @returns {boolean} 是否允许
   */
  isPathAllowed(targetPath) {
    const normalizedPath = path.resolve(targetPath);
    return this.allowedPaths.some(allowedPath => {
      const allowedResolved = path.resolve(allowedPath);
      return normalizedPath === allowedResolved || normalizedPath.startsWith(`${allowedResolved}${path.sep}`);
    });
  }
}

// ============================================
// 内置工具
// ============================================

/**
 * 文件系统工具
 */
export const builtinTools = {
  /**
   * 读取文件
   */
  readFile: new Tool({
    name: 'read_file',
    description: '读取文本文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于工作区）'
        },
        encoding: {
          type: 'string',
          description: '文件编码，默认 utf-8',
          default: 'utf-8'
        }
      },
      required: ['path']
    },
    handler: async (args, manager) => {
      const fullPath = `./workspace/${args.path}`;
      
      if (!manager.isPathAllowed(fullPath)) {
        throw new Error('路径访问被拒绝');
      }
      
      if (!existsSync(fullPath)) {
        throw new Error('文件不存在');
      }
      
      return await readFile(fullPath, args.encoding || 'utf-8');
    }
  }),

  /**
   * 写入文件
   */
  writeFile: new Tool({
    name: 'write_file',
    description: '写入内容到文件（如不存在则创建）',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径（相对于工作区）'
        },
        content: {
          type: 'string',
          description: '文件内容'
        },
        encoding: {
          type: 'string',
          description: '文件编码，默认 utf-8',
          default: 'utf-8'
        }
      },
      required: ['path', 'content']
    },
    handler: async (args, manager) => {
      const fullPath = `./workspace/${args.path}`;
      
      if (!manager.isPathAllowed(fullPath)) {
        throw new Error('路径访问被拒绝');
      }
      
      // 确保目录存在
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      
      await writeFile(fullPath, args.content, args.encoding || 'utf-8');
      
      return { success: true, path: fullPath };
    }
  }),

  /**
   * 列出目录
   */
  listDirectory: new Tool({
    name: 'list_directory',
    description: '列出目录内容',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录路径（相对于工作区）',
          default: '.'
        }
      },
      required: []
    },
    handler: async (args, manager) => {
      const fullPath = `./workspace/${args.path || '.'}`;
      
      if (!manager.isPathAllowed(fullPath)) {
        throw new Error('路径访问被拒绝');
      }
      
      if (!existsSync(fullPath)) {
        throw new Error('目录不存在');
      }
      
      const entries = await readdir(fullPath, { withFileTypes: true });
      
      return entries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file'
      }));
    }
  }),

  /**
   * 执行 Shell 命令
   */
  execShell: new Tool({
    name: 'exec_shell',
    description: '执行 Shell 命令（绿/白自动允许，灰需确认，黑拒绝）',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的命令'
        },
        approval: {
          type: 'string',
          description: '灰名单命令确认：once 或 remember_7d'
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 30000',
          default: 30000
        }
      },
      required: ['command']
    },
    handler: async (args) => {
      const command = (args.command || '').trim();
      if (!command) {
        throw new Error('命令不能为空');
      }
      const unsafePattern = /[;&|<>`$]/;
      if (unsafePattern.test(command)) {
        throw new Error('命令包含非法字符');
      }
      const normalizedCommand = normalizeCommand(command);
      const parts = normalizedCommand.split(/\s+/);
      const tokenPattern = /^[a-zA-Z0-9._/-]+$/;
      if (!parts.every(part => tokenPattern.test(part))) {
        throw new Error('命令包含非法参数');
      }
      const commandName = parts[0];
      const policy = classifyCommand(normalizedCommand);
      if (policy === 'black') {
        throw new Error('黑名单指令，请自己操作。');
      }
      if (policy === 'gray') {
        const approval = (args.approval || '').toLowerCase();
        const approvals = await loadApprovals();
        const signature = getApprovalSignature(normalizedCommand);
        const cached = approvals[signature];
        const now = Date.now();
        const cachedValid = cached && typeof cached.expiresAt === 'number' && cached.expiresAt > now;
        if (!cachedValid) {
          if (approval === 'remember_7d' || approval === 'remember-7d') {
            approvals[signature] = { expiresAt: now + approvalWindowMs };
            await saveApprovals(approvals);
          } else if (approval !== 'once') {
            throw new Error('灰名单指令，需要确认：approval=once 或 approval=remember_7d');
          }
        }
      }
      
      const { stdout, stderr } = await execAsync(normalizedCommand, {
        timeout: args.timeout || 30000
      });
      
      return {
        stdout,
        stderr: stderr || null,
        exitCode: 0
      };
    }
  }),

  /**
   * 获取当前时间
   */
  getCurrentTime: new Tool({
    name: 'get_current_time',
    description: '获取当前日期和时间',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: '时区，默认 Asia/Shanghai',
          default: 'Asia/Shanghai'
        }
      },
      required: []
    },
    handler: async (args) => {
      const now = new Date();
      
      return {
        iso: now.toISOString(),
        unix: Math.floor(now.getTime() / 1000),
        timezone: args.timezone || 'Asia/Shanghai',
        formatted: now.toLocaleString('zh-CN', {
          timeZone: args.timezone || 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        })
      };
    }
  })
};

/**
 * 创建默认工具管理器
 */
export function createToolManager() {
  const manager = new ToolManager();
  
  // 注册所有内置工具
  for (const tool of Object.values(builtinTools)) {
    manager.register(tool);
  }
  
  return manager;
}

export { Tool, ToolManager };
export default ToolManager;
