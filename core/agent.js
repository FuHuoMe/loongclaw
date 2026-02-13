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
      
      // 处理工具调用
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolResults = [];
        
        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
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
            { role: 'assistant', content: response.content, tool_calls: response.tool_calls },
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
      onChunk,
      this.tools.toAPIFormat()
    );
    
    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolResults = [];
      
      for (const toolCall of response.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
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
          { role: 'assistant', content: response.content, tool_calls: response.tool_calls },
          ...toolResults
        ]
      );
      
      session.messages.push({
        role: 'assistant',
        content: finalResponse.content
      });
      
      if (finalResponse.content) {
        onChunk(finalResponse.content);
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
