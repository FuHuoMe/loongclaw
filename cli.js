#!/usr/bin/env node
/**
 * LoongClaw CLI - 命令行入口
 * 
 * 使用方式:
 * - 单次模式: loongclaw "你的问题"
 * - 交互模式: loongclaw --repl
 * - 脚本模式: loongclaw --file script.txt
 */

import { createAgent } from './core/agent.js';
import { config } from 'dotenv';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// 加载环境变量
config();

/**
 * CLI 配置
 */
class CLIConfig {
  constructor() {
    this.workspace = process.env.WORKSPACE_DIR || process.cwd();
    this.allowedPaths = (process.env.ALLOWED_PATHS || process.cwd()).split(',').map(p => p.trim());
    this.sessionId = 'cli-default';
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.timeout = parseInt(process.env.SHELL_TIMEOUT || '30000');
    this.showTools = process.env.SHOW_TOOLS !== 'false';
    this.jsonOutput = process.env.JSON_OUTPUT === 'true';
  }
}

/**
 * CLI 应用
 */
class CLIApp {
  constructor(config) {
    this.config = config;
    this.agent = null;
    this.rl = null;
  }

  /**
   * 初始化 Agent
   */
  async init() {
    console.log('🐉 LoongClaw CLI 启动中...\n');

    this.agent = await createAgent({
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
        memoryDir: process.env.MEMORY_DIR || './memory',
        shortTermSize: parseInt(process.env.SHORT_TERM_SIZE || '10'),
        longTermDir: process.env.MEMORY_DIR || './memory'
      },
      tools: {
        allowedPaths: this.config.allowedPaths
      }
    });

    // 设置工具调用拦截器（用于日志）
    this._setupToolInterceptor();

    console.log('✅ LoongClaw CLI 已就绪！\n');
    console.log(`📁 工作目录: ${this.config.workspace}`);
    const toolNames = this.agent.tools.getAll().map(t => t.name).join(', ');
    console.log(`🔧 可用工具: ${toolNames}`);
    console.log(`📊 会话 ID: ${this.config.sessionId}\n`);
  }

  /**
   * 设置工具调用拦截器
   */
  _setupToolInterceptor() {
    const originalCall = this.agent.tools.call.bind(this.agent.tools);
    
    this.agent.tools.call = async (name, args) => {
      const startTime = Date.now();
      
      if (this.config.showTools) {
        console.log(`\n🔧 工具调用: ${name}`);
        console.log(`📝 参数: ${JSON.stringify(args, null, 2)}`);
      }
      
      try {
        const result = await originalCall(name, args);
        const duration = Date.now() - startTime;
        
        if (this.config.showTools) {
          console.log(`✅ 结果: ${this._formatResult(result)}`);
          console.log(`⏱️  耗时: ${duration}ms\n`);
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (this.config.showTools) {
          console.log(`❌ 错误: ${error.message}`);
          console.log(`⏱️  耗时: ${duration}ms\n`);
        }
        
        throw error;
      }
    };
  }

  /**
   * 格式化工具结果
   */
  _formatResult(result) {
    const str = JSON.stringify(result);
    return str.length > 200 ? str.slice(0, 200) + '...' : str;
  }

  /**
   * 执行单次命令
   */
  async runOnce(message) {
    try {
      console.log(`👤 用户: ${message}\n`);
      
      const response = await this.agent.process(message, this.config.sessionId);
      
      console.log(`🐉 熊大: ${response}\n`);
      
      if (this.config.jsonOutput) {
        console.log('\n--- JSON 输出 ---');
        console.log(JSON.stringify({
          message,
          response,
          sessionId: this.config.sessionId,
          timestamp: new Date().toISOString()
        }, null, 2));
      }
      
    } catch (error) {
      console.error(`❌ 错误: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * REPL 模式
   */
  async runREPL() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🐉 loongclaw> '
    });

    console.log('🔄 进入交互模式 (Ctrl+C 或 exit 退出)\n');

    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      
      if (!trimmed) return;
      
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('\n👋 再见！');
        this.rl.close();
        process.exit(0);
      }
      
      if (trimmed === 'clear') {
        console.clear();
        return;
      }
      
      if (trimmed.startsWith('!')) {
        // Shell 命令
        this._handleShellCommand(trimmed.slice(1));
        return;
      }
      
      await this.runOnce(trimmed);
    });

    this.rl.on('close', () => {
      console.log('\n👋 再见！');
      process.exit(0);
    });
  }

  /**
   * 处理 Shell 命令
   */
  _handleShellCommand(cmd) {
    const [command, ...args] = cmd.trim().split(/\s+/);
    
    switch (command) {
      case 'help':
        this._showHelp();
        break;
      case 'session':
        this._showSession();
        break;
      case 'clear-session':
        this.agent.clearHistory(this.config.sessionId);
        console.log('✅ 会话已清除\n');
        break;
      case 'workspace':
        console.log(`📁 当前工作目录: ${this.config.workspace}\n`);
        break;
      default:
        console.log(`❌ 未知命令: ${command}`);
        console.log('输入 !help 查看可用命令\n');
    }
  }

  /**
   * 显示帮助
   */
  _showHelp() {
    console.log(`
📖 LoongClaw CLI 帮助
═══════════════════════════════════════

交互模式命令:
  !help           显示此帮助
  !session        显示当前会话信息
  !clear-session  清除当前会话历史
  !workspace      显示当前工作目录
  exit / quit     退出程序

环境变量:
  LLM_PROVIDER     LLM 提供商 (deepseek|glm|kimi)
  WORKSPACE_DIR    工作目录 (默认: 当前目录)
  ALLOWED_PATHS    允许访问的路径 (逗号分隔)
  LOG_LEVEL        日志等级 (debug|info|warn|error)
  SHOW_TOOLS       显示工具调用日志 (true|false)
  JSON_OUTPUT       JSON 格式输出 (true|false)

示例:
  loongclaw "创建文件 test.txt，内容是 Hello"
  loongclaw --repl
  WORKSPACE_DIR=./project loongclaw "列出当前目录"

═══════════════════════════════════════
    `);
  }

  /**
   * 显示会话信息
   */
  _showSession() {
    const session = this.agent.sessions.get(this.config.sessionId);
    
    if (!session) {
      console.log('📊 当前会话: 空\n');
      return;
    }
    
    console.log(`
📊 当前会话信息
═══════════════════════════════════════
会话 ID: ${this.config.sessionId}
消息数: ${session.messages.length}
记忆数: ${this.agent.memory.stats().shortTerm}

最后 5 条消息:
${session.messages.slice(-5).map((msg, i) => 
  `${i + 1}. [${msg.role}] ${msg.content.slice(0, 50)}...`
).join('\n')}
═══════════════════════════════════════
    `);
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const cliConfig = new CLIConfig();
  const app = new CLIApp(cliConfig);

  await app.init();

  // 解析参数
  if (args.length === 0) {
    // 无参数，进入 REPL 模式
    await app.runREPL();
  } else if (args[0] === '--repl') {
    // 显式 REPL 模式
    await app.runREPL();
  } else if (args[0] === '--file') {
    // 脚本文件模式
    const scriptFile = args[1];
    if (!scriptFile) {
      console.error('❌ 错误: --file 需要指定文件路径');
      process.exit(1);
    }
    
    if (!fs.existsSync(scriptFile)) {
      console.error(`❌ 错误: 文件不存在: ${scriptFile}`);
      process.exit(1);
    }
    
    const script = fs.readFileSync(scriptFile, 'utf-8');
    const lines = script.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    
    console.log(`📜 执行脚本: ${scriptFile}\n`);
    
    for (const line of lines) {
      await app.runOnce(line.trim());
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n✅ 脚本执行完成\n');
  } else if (args[0] === '--help' || args[0] === '-h') {
    app._showHelp();
  } else {
    // 单次命令模式
    const message = args.join(' ');
    await app.runOnce(message);
  }
}

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('❌ 未捕获的异常:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未处理的 Promise 拒绝:', reason);
  process.exit(1);
});

// 启动
main();
