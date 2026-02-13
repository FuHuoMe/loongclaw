/**
 * LoongClaw - LLM 适配器
 * 
 * 负责 LLM API 调用，支持多种模型
 * 当前支持：GLM-4 (智谱 AI)
 */

import axios from 'axios';

/**
 * LLM 消息格式
 * @typedef {Object} Message
 * @property {string} role - 角色 (system|user|assistant)
 * @property {string} content - 内容
 * @property {Object[]} [tool_calls] - 工具调用
 */

/**
 * LLM 响应格式
 * @typedef {Object} LLMResponse
 * @property {string} content - 响应内容
 * @property {Object[]} [tool_calls] - 工具调用请求
 * @property {Object} usage - token 使用统计
 */

/**
 * LLM 适配器类
 */
class LLMAdapter {
  /**
   * 创建 LLM 适配器
   * @param {Object} config - 配置对象
   * @param {string} config.provider - 提供商 (glm|deepseek|kimi)
   * @param {string} config.apiKey - API 密钥
   * @param {string} config.apiUrl - API 端点
   * @param {string} config.model - 模型名称
   */
  constructor(config) {
    this.provider = config.provider || 'glm';
    this.apiKey = config.apiKey || process.env.GLM_API_KEY;
    this.apiUrl = config.apiUrl || process.env.GLM_API_URL || 'https://open.bigmodel.cn/api/anthropic';
    this.format = config.format || process.env.LLM_FORMAT || null;
    const modelConfig = config.model || process.env.GLM_MODEL;
    const parsedModels = Array.isArray(modelConfig)
      ? modelConfig
      : (typeof modelConfig === 'string'
          ? modelConfig.split(',').map(item => item.trim()).filter(Boolean)
          : []);
    this.models = parsedModels.length > 0 ? parsedModels : ['glm-5', 'glm-4.7'];
    this.model = this.models[0];
    this.timeout = config.timeout || 60000;
    
    // 验证配置
    if (!this.apiKey) {
      throw new Error('LLM 适配器配置不完整：需要 apiKey');
    }
    
    // 创建 HTTP 客户端
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    };
    if (this._isAnthropic()) {
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: this.timeout,
      headers
    });
  }

  /**
   * 发送聊天请求
   * @param {Message[]} messages - 消息历史
   * @param {Object[]} [tools] - 可用工具列表
   * @param {Object} [options] - 额外选项
   * @returns {Promise<LLMResponse>} LLM 响应
   */
  async chat(messages, tools = null, options = {}) {
    const isAnthropic = this._isAnthropic();
    const requestPath = isAnthropic ? '/v1/messages' : '';
    return await this._requestWithFallback(async (model) => {
      try {
        const requestBody = isAnthropic
          ? this._buildAnthropicRequest(messages, tools, options, false, model)
          : this._buildOpenAIRequest(messages, tools, options, false, model);
        const response = await this.client.post(requestPath, requestBody);
        return isAnthropic ? this._parseAnthropicResponse(response.data) : this._parseResponse(response.data);
      } catch (error) {
        throw await this._normalizeErrorAsync(error);
      }
    });
  }

  /**
   * 发送流式聊天请求
   * @param {Message[]} messages - 消息历史
   * @param {Function} onChunk - 接收数据块的回调
   * @param {Object[]} [tools] - 可用工具列表
   * @returns {Promise<LLMResponse>} 完整响应
   */
  async chatStream(messages, onChunk, tools = null) {
    const isAnthropic = this._isAnthropic();
    const requestPath = isAnthropic ? '/v1/messages' : '';
    return await this._requestWithFallback(async (model) => {
      try {
        const requestBody = isAnthropic
          ? this._buildAnthropicRequest(messages, tools, {}, true, model)
          : this._buildOpenAIRequest(messages, tools, {}, true, model);
        const response = await this.client.post(requestPath, requestBody, {
          responseType: 'stream'
        });
        return isAnthropic
          ? this._handleAnthropicStream(response, onChunk)
          : this._handleOpenAIStream(response, onChunk);
      } catch (error) {
        throw await this._normalizeErrorAsync(error);
      }
    });
  }

  /**
   * 格式化工具列表为 API 格式
   * @private
   */
  _formatTools(tools) {
    if (this._isAnthropic()) {
      return tools.map(tool => {
        if (tool.type === 'function' && tool.function) {
          return {
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters || {
              type: 'object',
              properties: {},
              required: []
            }
          };
        }
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters || {
            type: 'object',
            properties: {},
            required: []
          }
        };
      });
    }
    return tools.map(tool => {
      if (tool.type === 'function' && tool.function) {
        return tool;
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || {
            type: 'object',
            properties: {},
            required: []
          }
        }
      };
    });
  }

  /**
   * 解析 API 响应
   * @private
   */
  _parseResponse(data) {
    const choice = data.choices?.[0];
    
    return {
      content: choice?.message?.content || '',
      tool_calls: choice?.message?.tool_calls || [],
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0
      }
    };
  }

  _parseAnthropicResponse(data) {
    const contentBlocks = Array.isArray(data.content) ? data.content : [];
    const textContent = contentBlocks
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('');
    const toolCalls = contentBlocks
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {})
        }
      }));

    return {
      content: textContent,
      tool_calls: toolCalls,
      usage: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      }
    };
  }

  _buildOpenAIRequest(messages, tools, options, stream, model) {
    const requestBody = {
      model,
      messages: messages.map(msg => {
        if (msg.role === 'tool') {
          const toolMessage = {
            role: 'tool',
            content: msg.content ?? ''
          };
          const toolCallId = msg.tool_call_id || msg.id;
          if (toolCallId) {
            toolMessage.tool_call_id = toolCallId;
          }
          if (msg.name) {
            toolMessage.name = msg.name;
          }
          return toolMessage;
        }
        if (msg.role === 'assistant') {
          const assistantMessage = {
            role: 'assistant',
            content: msg.content ?? ''
          };
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            assistantMessage.tool_calls = msg.tool_calls;
          }
          return assistantMessage;
        }
        return {
          role: msg.role,
          content: msg.content
        };
      }),
      temperature: options.temperature || 0.7,
      max_tokens: options.maxTokens || 2000,
      stream
    };

    if (tools && tools.length > 0) {
      requestBody.tools = this._formatTools(tools);
      requestBody.tool_choice = options.toolChoice || 'auto';
    }
    return requestBody;
  }

  _buildAnthropicRequest(messages, tools, options, stream, model) {
    const systemMessages = messages.filter(msg => msg.role === 'system').map(msg => msg.content).join('\n\n');
    const userAssistantMessages = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: [
          {
            type: 'text',
            text: msg.content || ''
          }
        ]
      }));

    const requestBody = {
      model,
      messages: userAssistantMessages,
      max_tokens: options.maxTokens || 2000,
      temperature: options.temperature || 0.7,
      stream
    };

    if (systemMessages) {
      requestBody.system = systemMessages;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = this._formatTools(tools);
    }

    return requestBody;
  }

  _handleOpenAIStream(response, onChunk) {
    return new Promise((resolve, reject) => {
      let fullContent = '';
      const toolCallBuffers = new Map();
      const functionCall = { name: null, arguments: '' };

      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              break;
            }
            
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              if (delta?.content) {
                fullContent += delta.content;
                onChunk(delta.content);
              }

              if (delta?.function_call) {
                if (delta.function_call.name) {
                  functionCall.name = delta.function_call.name;
                }
                if (delta.function_call.arguments) {
                  functionCall.arguments += delta.function_call.arguments;
                }
              }
              
              if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                  const index = toolCallDelta.index ?? 0;
                  const current = toolCallBuffers.get(index) || { id: null, name: null, arguments: '' };
                  if (toolCallDelta.id) {
                    current.id = toolCallDelta.id;
                  }
                  if (toolCallDelta.function?.name) {
                    current.name = toolCallDelta.function.name;
                  }
                  if (toolCallDelta.function?.arguments) {
                    current.arguments += toolCallDelta.function.arguments;
                  }
                  toolCallBuffers.set(index, current);
                }
              }
            } catch (e) {
            }
          }
        }
      });

      response.data.on('end', () => {
        let toolCalls = Array.from(toolCallBuffers.entries()).map(([index, toolCall]) => ({
          id: toolCall.id || `tool_call_${Date.now()}_${index}`,
          type: 'function',
          function: {
            name: toolCall.name || '',
            arguments: toolCall.arguments || ''
          }
        }));
        if (toolCalls.length === 0 && functionCall.name) {
          toolCalls = [
            {
              id: `tool_call_${Date.now()}_0`,
              type: 'function',
              function: {
                name: functionCall.name || '',
                arguments: functionCall.arguments || ''
              }
            }
          ];
        }
        resolve({
          content: fullContent,
          tool_calls: toolCalls,
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        });
      });

      response.data.on('error', (error) => {
        reject(new Error(`流式请求失败: ${error.message}`));
      });
    });
  }

  _handleAnthropicStream(response, onChunk) {
    return new Promise((resolve, reject) => {
      let fullContent = '';
      const toolInputBuffers = new Map();
      const toolMeta = new Map();
      const toolCalls = [];

      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue;
          }
          const data = line.slice(6);
          if (!data || data === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_start') {
              const block = parsed.content_block;
              if (block?.type === 'tool_use') {
                toolMeta.set(parsed.index, { id: block.id, name: block.name });
                toolInputBuffers.set(parsed.index, '');
              }
            }
            if (parsed.type === 'content_block_delta') {
              const delta = parsed.delta;
              if (delta?.type === 'text_delta') {
                fullContent += delta.text;
                onChunk(delta.text);
              }
              if (delta?.type === 'input_json_delta') {
                const current = toolInputBuffers.get(parsed.index) || '';
                toolInputBuffers.set(parsed.index, current + (delta.partial_json || ''));
              }
            }
            if (parsed.type === 'content_block_stop') {
              const meta = toolMeta.get(parsed.index);
              if (meta) {
                const rawInput = toolInputBuffers.get(parsed.index) || '';
                let input = {};
                try {
                  input = rawInput ? JSON.parse(rawInput) : {};
                } catch (e) {
                  input = {};
                }
                toolCalls.push({
                  id: meta.id,
                  type: 'function',
                  function: {
                    name: meta.name,
                    arguments: JSON.stringify(input)
                  }
                });
              }
            }
          } catch (e) {
          }
        }
      });

      response.data.on('end', () => {
        resolve({
          content: fullContent,
          tool_calls: toolCalls,
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        });
      });

      response.data.on('error', (error) => {
        reject(new Error(`流式请求失败: ${error.message}`));
      });
    });
  }

  _isAnthropic() {
    if (this.format) {
      return this.format === 'anthropic';
    }
    return this.apiUrl.includes('/api/anthropic');
  }

  async _normalizeErrorAsync(error) {
    if (error.response) {
      const responseData = await this._safeStringifyAsync(error.response.data);
      return new Error(`LLM API 错误: ${error.response.status} - ${responseData}`);
    }
    if (error.request) {
      return new Error(`LLM API 请求失败: ${error.message}`);
    }
    return new Error(`LLM 调用失败: ${error.message}`);
  }

  async _requestWithFallback(requestFn) {
    let lastError = null;
    for (const model of this.models) {
      try {
        return await requestFn(model);
      } catch (error) {
        lastError = error;
        if (!this._shouldFallback(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  _shouldFallback(error) {
    const status = error.response?.status;
    const message = error.response?.data ? this._safeStringify(error.response.data) : error.message || '';
    if (status === 404) {
      return true;
    }
    if (status === 400 && /model|not found|不存在/i.test(message)) {
      return true;
    }
    return false;
  }

  _safeStringify(data) {
    if (data === null || data === undefined) {
      return '';
    }
    if (typeof data === 'string') {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString('utf-8');
    }
    if (typeof data?.pipe === 'function') {
      return '[stream]';
    }
    try {
      return JSON.stringify(data);
    } catch (error) {
      return '[unserializable]';
    }
  }

  async _safeStringifyAsync(data) {
    if (data === null || data === undefined) {
      return '';
    }
    if (typeof data === 'string') {
      return data;
    }
    if (Buffer.isBuffer(data)) {
      return data.toString('utf-8');
    }
    if (typeof data?.on === 'function') {
      const raw = await this._readStream(data);
      if (raw) {
        return raw;
      }
      return '[stream]';
    }
    try {
      return JSON.stringify(data);
    } catch (error) {
      return '[unserializable]';
    }
  }

  _readStream(stream) {
    return new Promise((resolve) => {
      let raw = '';
      stream.on('data', chunk => {
        raw += chunk.toString('utf-8');
      });
      stream.on('end', () => resolve(raw));
      stream.on('error', () => resolve(raw));
    });
  }

  /**
   * 健康检查
   * @returns {Promise<boolean>} 是否健康
   */
  async healthCheck() {
    try {
      const response = await this.chat([
        { role: 'user', content: 'ping' }
      ], null, { maxTokens: 10 });
      
      return !!response.content;
    } catch (error) {
      return false;
    }
  }
}

/**
 * GLM-4 适配器工厂
 */
export function createGLMAdapter(config) {
  return new LLMAdapter({
    provider: 'glm',
    apiUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: ['glm-5', 'glm-4.7'],
    ...config
  });
}

/**
 * DeepSeek 适配器工厂
 */
export function createDeepSeekAdapter(config) {
  return new LLMAdapter({
    provider: 'deepseek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    format: 'openai',
    model: 'deepseek-chat',
    ...config
  });
}

/**
 * Kimi 适配器工厂
 */
export function createKimiAdapter(config) {
  return new LLMAdapter({
    provider: 'kimi',
    apiUrl: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    ...config
  });
}

export default LLMAdapter;
