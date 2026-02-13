/**
 * LoongClaw - Agent 主引擎
 * 
 * 核心对话逻辑，协调 LLM、工具和记忆
 */

import { config } from 'dotenv';
import { createGLMAdapter, createDeepSeekAdapter, createKimiAdapter } from './llm.js';
import { createToolManager } from './tools.js';
import { createMemorySystem, MemoryType, MemoryImportance } from './memory.js';
import { readFile } from 'fs/promises';

config();

/**
 * Agent 配置
 */
class AgentConfig {
  constructor(config = {}) {
    this.llm = {
      provider: config.llm?.provider || 'deepseek',
      apiKey: config.llm?.apiKey || process.env.GLM_API_KEY,
      apiUrl: config.llm?.apiUrl,
      model: config.llm?.model
    };
    
    this.memory = {
      memoryDir: config.memory?.memoryDir || './memory',
      maxShortTermSize: config.memory?.maxShortTermSize || 100
    };
    
    this.system = {
      name: config.system?.name || '熊大',
      role: config.system?.role || '森林守护者',
      vibe: config.system?.vibe || '强壮、聪明、勇敢，保护森林',
      timezone: config.system?.timezone || 'Asia/Shanghai'
    };
  }
}

/**
 * LoongClaw Agent
 */
class Agent {
  /**
   * 创建 Agent
   * @param {AgentConfig|Object} config - 配置
   */
  constructor(config = {}) {
    this.config = config instanceof AgentConfig ? config : new AgentConfig(config);
    
    // 初始化组件
    if (this.config.llm.provider === 'deepseek') {
      this.llm = createDeepSeekAdapter({
        apiKey: this.config.llm.apiKey,
        apiUrl: this.config.llm.apiUrl,
        model: this.config.llm.model
      });
    } else if (this.config.llm.provider === 'kimi') {
      this.llm = createKimiAdapter({
        apiKey: this.config.llm.apiKey,
        apiUrl: this.config.llm.apiUrl,
        model: this.config.llm.model
      });
    } else {
      this.llm = createGLMAdapter({
        apiKey: this.config.llm.apiKey,
        apiUrl: this.config.llm.apiUrl,
        model: this.config.llm.model
      });
    }
    
    this.tools = createToolManager();
    this.memory = createMemorySystem(this.config.memory);
    
    // 会话状态
    this.sessions = new Map();
    this.currentSession = null;
    
    // 系统提示
    this.systemPrompt = this._buildSystemPrompt();
  }

  /**
   * 初始化 Agent
   */
  async init() {
    // 初始化记忆系统
    await this.memory.init();
    
    // 加载自定义系统提示（如果存在）
    try {
      const customPromptPath = './config/SOUL.md';
      const customPrompt = await readFile(customPromptPath, 'utf-8');
      this.systemPrompt = customPrompt;
    } catch (e) {
      // 使用默认提示
    }
  }

  /**
   * 处理用户消息
   * @param {string} message - 用户消息
   * @param {string} [sessionId] - 会话 ID
   * @returns {Promise<string>} Agent 响应
   */
  async process(message, sessionId = 'default') {
    try {
      // 获取或创建会话
      const session = this._getOrCreateSession(sessionId);

      const internalResponse = this._handleInternalCommand(message);
      if (internalResponse) {
        session.messages.push({
          role: 'user',
          content: message
        });
        session.messages.push({
          role: 'assistant',
          content: internalResponse
        });
        return internalResponse;
      }
      
      // 添加用户消息到历史
      session.messages.push({
        role: 'user',
        content: message
      });
      
      // 搜索相关记忆
      const relevantMemories = await this.memory.search({
        keyword: message,
        limit: 5
      });
      
      // 构建上下文
      const context = this._buildContext(session, relevantMemories);
      
      // 调用 LLM
      const response = await this.llm.chat(
        [
          { role: 'system', content: this.systemPrompt },
          ...context,
          { role: 'user', content: message }
        ],
        this.tools.toAPIFormat()
      );
      
      let toolCalls = this._normalizeToolCalls(response.tool_calls || []);
      if (toolCalls.length === 0) {
        const dsmlCalls = this._extractDSMLToolCalls(response.content || '');
        if (dsmlCalls.length > 0) {
          toolCalls = this._normalizeToolCalls(dsmlCalls);
          response.content = this._stripDSML(response.content || '');
        }
      }
      if (toolCalls.length > 0) {
        const toolResults = [];
        
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = this._parseToolArguments(toolCall.function.arguments);
          
          try {
            const result = await this.tools.call(toolName, toolArgs);
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify(result)
            });
          } catch (error) {
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({ error: error.message })
            });
          }
        }
        
        // 再次调用 LLM 获取最终响应
        const finalResponse = await this.llm.chat(
          [
            { role: 'system', content: this.systemPrompt },
            ...context,
            ...session.messages,
            { role: 'assistant', content: response.content, tool_calls: toolCalls },
            ...toolResults
          ]
        );
        
        // 保存到会话
        session.messages.push({
          role: 'assistant',
          content: finalResponse.content
        });
        
        // 保存重要记忆
        await this._saveMemory(message, finalResponse.content);
        
        return finalResponse.content;
      }
      
      // 保存到会话
      session.messages.push({
        role: 'assistant',
        content: response.content
      });
      
      // 保存重要记忆
      await this._saveMemory(message, response.content);
      
      return response.content;
      
    } catch (error) {
      console.error('Agent 处理失败:', error);
      throw error;
    }
  }

  /**
   * 流式处理消息
   * @param {string} message - 用户消息
   * @param {Function} onChunk - 接收数据块的回调
   * @param {string} [sessionId] - 会话 ID
   * @returns {Promise<string>} 完整响应
   */
  async processStream(message, onChunk, sessionId = 'default') {
    const session = this._getOrCreateSession(sessionId);

    const internalResponse = this._handleInternalCommand(message);
    if (internalResponse) {
      session.messages.push({
        role: 'user',
        content: message
      });
      session.messages.push({
        role: 'assistant',
        content: internalResponse
      });
      if (internalResponse) {
        onChunk(internalResponse);
      }
      return internalResponse;
    }
    
    session.messages.push({
      role: 'user',
      content: message
    });
    
    const context = this._buildContext(session);
    
    const response = await this.llm.chatStream(
      [
        { role: 'system', content: this.systemPrompt },
        ...context,
        { role: 'user', content: message }
      ],
      (chunk) => {
        const sanitized = this._sanitizeStreamChunk(chunk);
        if (sanitized) {
          onChunk(sanitized);
        }
      },
      this.tools.toAPIFormat()
    );
    
    let toolCalls = this._normalizeToolCalls(response.tool_calls || []);
    if (toolCalls.length === 0) {
      const dsmlCalls = this._extractDSMLToolCalls(response.content || '');
      if (dsmlCalls.length > 0) {
        toolCalls = this._normalizeToolCalls(dsmlCalls);
        response.content = this._stripDSML(response.content || '');
      }
    }
    if (toolCalls.length > 0) {
      const toolResults = [];
      
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = this._parseToolArguments(toolCall.function.arguments);
        
        try {
          const result = await this.tools.call(toolName, toolArgs);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(result)
          });
        } catch (error) {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({ error: error.message })
          });
        }
      }
      
      const finalResponse = await this.llm.chat(
        [
          { role: 'system', content: this.systemPrompt },
          ...context,
          ...session.messages,
          { role: 'assistant', content: response.content, tool_calls: toolCalls },
          ...toolResults
        ]
      );
      
      session.messages.push({
        role: 'assistant',
        content: finalResponse.content
      });
      
      if (finalResponse.content) {
        const sanitized = this._stripDSML(finalResponse.content || '');
        if (sanitized) {
          onChunk(sanitized);
        }
      }
      
      return finalResponse.content;
    }
    
    session.messages.push({
      role: 'assistant',
      content: response.content
    });
    
    return response.content;
  }

  /**
   * 获取会话历史
   * @param {string} [sessionId] - 会话 ID
   * @returns {Array} 消息历史
   */
  getHistory(sessionId = 'default') {
    const session = this.sessions.get(sessionId);
    return session ? session.messages : [];
  }

  /**
   * 清除会话历史
   * @param {string} [sessionId] - 会话 ID
   */
  clearHistory(sessionId = 'default') {
    if (sessionId === 'all') {
      this.sessions.clear();
    } else {
      this.sessions.delete(sessionId);
    }
  }

  _handleInternalCommand(message) {
    if (!message || typeof message !== 'string') {
      return null;
    }
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }
    const parts = trimmed.slice(1).trim().split(/\s+/).filter(Boolean);
    const command = (parts[0] || '').toLowerCase();
    if (!command || (command !== 'model' && command !== 'models')) {
      return null;
    }
    const provider = this.config.llm?.provider || 'deepseek';
    const currentModel = this.llm?.model || '';
    const models = Array.isArray(this.llm?.models)
      ? this.llm.models
      : (currentModel ? [currentModel] : []);
    const language = (this.config.system?.language || 'zh').toLowerCase();
    if (command === 'models') {
      const lines = [
        language === 'en' ? `Current provider: ${provider}` : `当前提供商: ${provider}`,
        language === 'en' ? `Current model: ${currentModel || '-'}` : `当前模型: ${currentModel || '-'}`,
        language === 'en' ? 'Available models:' : '可用模型:',
        ...models.map(item => `- ${item}`)
      ];
      return lines.join('\n');
    }
    const lines = [
      language === 'en' ? `Current provider: ${provider}` : `当前提供商: ${provider}`,
      language === 'en' ? `Current model: ${currentModel || '-'}` : `当前模型: ${currentModel || '-'}`,
      language === 'en'
        ? 'This is an internal command. Use /model or /models in CLI'
        : '这是内部指令，请在 CLI 中使用 /model 或 /models'
    ];
    return lines.join('\n');
  }

  _parseToolArguments(rawArgs) {
    if (!rawArgs) {
      return {};
    }
    if (typeof rawArgs === 'object') {
      return rawArgs;
    }
    if (typeof rawArgs !== 'string') {
      return {};
    }
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return {};
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return {};
    }
  }

  _normalizeToolCalls(toolCalls) {
    return toolCalls.map((toolCall, index) => {
      const id = toolCall.id || toolCall.tool_call_id || `tool_call_${Date.now()}_${index}`;
      return {
        ...toolCall,
        id,
        function: {
          ...toolCall.function,
          arguments: toolCall.function?.arguments ?? ''
        }
      };
    });
  }

  _extractDSMLToolCalls(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }
    const result = [];
    const invokeRegex = /<[^>]*invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*invoke>/g;
    let match;
    while ((match = invokeRegex.exec(content)) !== null) {
      const name = match[1];
      const block = match[2] || '';
      const params = {};
      const paramRegex = /<[^>]*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*parameter>/g;
      let p;
      while ((p = paramRegex.exec(block)) !== null) {
        const key = p[1];
        const valRaw = (p[2] || '').trim();
        let val = valRaw;
        if (/^(true|false)$/i.test(valRaw)) {
          val = /^true$/i.test(valRaw);
        } else if (/^-?\d+(\.\d+)?$/.test(valRaw)) {
          val = Number(valRaw);
        }
        params[key] = val;
      }
      result.push({
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(params)
        }
      });
    }
    return result;
  }

  _stripDSML(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    let cleaned = text.replace(/<[^>]*function_calls[^>]*>[\s\S]*?<\/[^>]*function_calls>/g, '');
    cleaned = cleaned.replace(/<[^>]*invoke[^>]*>[\s\S]*?<\/[^>]*invoke>/g, '');
    cleaned = cleaned.replace(/<[^>]*parameter[^>]*>[\s\S]*?<\/[^>]*parameter>/g, '');
    cleaned = cleaned.replace(/<\/?[^>]*DSML[^>]*>/g, '');
    return cleaned;
  }

  _sanitizeStreamChunk(chunk) {
    if (!chunk) return '';
    if (typeof chunk !== 'string') return String(chunk);
    return this._stripDSML(chunk);
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计数据
   */
  getStats() {
    return {
      sessions: this.sessions.size,
      tools: this.tools.getAll().length,
      shortTermMemories: this.memory.getRecent().length
    };
  }

  /**
   * 构建系统提示
   * @private
   */
  _buildSystemPrompt() {
    const currentTime = new Date().toLocaleString('zh-CN', {
      timeZone: this.config.system.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const language = (this.config.system.language || 'zh').toLowerCase();
    if (language === 'en') {
      const time = new Date().toLocaleString('en-US', {
        timeZone: this.config.system.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `You are ${this.config.system.name}, ${this.config.system.role}.

${this.config.system.vibe}

**Current time**: ${time} (${this.config.system.timezone})

**Core principles**:
- Help sincerely without performative politeness
- Keep your own judgment and opinions
- Try to solve first, then ask
- Win trust through action, not empty promises

**Available tools**:
${this.tools.getAll().map(t => `- ${t.name}: ${t.description}`).join('\n')}

**Memory system**:
- Short-term memory: current session context
- Long-term memory: persisted important information

**Notes**:
- Protect privacy, never leak sensitive info
- Be cautious before external actions
- Say you don't know if you don't know
`;
    }
    return `你是 ${this.config.system.name}，${this.config.system.role}。

${this.config.system.vibe}

**当前时间**: ${currentTime} (${this.config.system.timezone})

**核心原则**:
- 真诚帮助他人，不要表演式的客套
- 有自己的观点和判断
- 遇到问题先尝试解决，再提问
- 通过行动赢得信任，而不是空洞的承诺

**可用工具**:
${this.tools.getAll().map(t => `- ${t.name}: ${t.description}`).join('\n')}

**记忆系统**:
- 短期记忆: 当前会话上下文
- 长期记忆: 持久化的重要信息

**注意事项**:
- 保护隐私，不泄露敏感信息
- 执行外部操作前要谨慎
- 不知道的就说不知道，不要编造
`;
  }

  /**
   * 获取或创建会话
   * @private
   */
  _getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        messages: [],
        createdAt: new Date()
      });
    }
    
    return this.sessions.get(sessionId);
  }

  /**
   * 构建上下文
   * @private
   */
  _buildContext(session, memories = []) {
    const context = [];
    
    // 添加最近记忆作为上下文
    if (memories.length > 0) {
      const memoryText = memories
        .map(m => `- [${m.type}] ${m.content.substring(0, 100)}...`)
        .join('\n');
      
      context.push({
        role: 'system',
        content: `**相关记忆**:\n${memoryText}`
      });
    }
    
    // 添加会话历史
    context.push(...session.messages.slice(-10)); // 最近 10 条
    
    return context;
  }

  /**
   * 保存重要记忆
   * @private
   */
  async _saveMemory(userMessage, agentResponse) {
    // 简单启发式：如果用户提到重要事项，则保存
    const keywords = ['记住', '重要', '决策', '计划', 'TODO', '待办'];
    
    const isImportant = keywords.some(kw => 
      userMessage.includes(kw) || agentResponse.includes(kw)
    );
    
    if (isImportant) {
      await this.memory.add({
        content: `Q: ${userMessage}\nA: ${agentResponse}`,
        type: MemoryType.EVENT,
        importance: MemoryImportance.HIGH,
        tags: ['conversation']
      });
    }
  }
}

/**
 * 创建默认 Agent
 */
export async function createAgent(config) {
  const agent = new Agent(config);
  await agent.init();
  return agent;
}

export { Agent, AgentConfig };
export default Agent;
