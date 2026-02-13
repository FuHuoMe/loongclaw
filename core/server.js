/**
 * LoongClaw - Web 服务器
 * 
 * Express + WebSocket 服务
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createAgent } from './agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Web 服务器类
 */
class WebServer {
  /**
   * 创建 Web 服务器
   * @param {Agent} agent - Agent 实例
   * @param {Object} config - 配置
   */
  constructor(agent, config = {}) {
    this.agent = agent;
    this.port = config.port || process.env.PORT || 3000;
    this.wsPort = config.wsPort || process.env.WS_PORT || 3001;
    
    // 创建 Express 应用
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    
    // HTTP 服务器
    this.server = null;
    
    // WebSocket 服务器
    this.wss = null;
    
    // WebSocket 客户端
    this.wsClients = new Map();
  }

  /**
   * 设置中间件
   */
  setupMiddleware() {
    // JSON 解析
    this.app.use(express.json());
    
    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
    
    // 请求日志
    this.app.use((req, res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        agent: this.agent.config.system.name,
        timestamp: new Date().toISOString()
      });
    });

    // 获取统计信息
    this.app.get('/api/stats', (req, res) => {
      try {
        const stats = this.agent.getStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/config', (req, res) => {
      res.json({
        wsPort: this.wsPort
      });
    });

    // 获取会话历史
    this.app.get('/api/history/:sessionId?', (req, res) => {
      try {
        const sessionId = req.params.sessionId || 'default';
        const history = this.agent.getHistory(sessionId);
        res.json({ sessionId, messages: history });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 清除会话历史
    this.app.delete('/api/history/:sessionId?', (req, res) => {
      try {
        const sessionId = req.params.sessionId || 'default';
        this.agent.clearHistory(sessionId);
        res.json({ success: true, sessionId });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 单次对话接口
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { message, sessionId = 'default' } = req.body;
        
        if (!message) {
          return res.status(400).json({ error: '缺少 message 参数' });
        }
        
        const response = await this.agent.process(message, sessionId);
        
        res.json({
          message: response,
          sessionId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 搜索记忆
    this.app.get('/api/memory/search', async (req, res) => {
      try {
        const { keyword, type, limit = 10 } = req.query;
        
        const results = await this.agent.memory.search({
          keyword,
          type,
          limit: parseInt(limit)
        });
        
        res.json({ results });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 导出记忆
    this.app.get('/api/memory/export', async (req, res) => {
      try {
        const format = req.query.format || 'json';
        const content = await this.agent.memory.export(format);
        
        if (format === 'json') {
          res.type('application/json').send(content);
        } else {
          res.type('text/markdown').send(content);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 404
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  /**
   * 启动 HTTP 服务器
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // 创建 HTTP 服务器
        this.server = createServer(this.app);
        
        // 启动 HTTP 服务器
        this.server.listen(this.port, () => {
          console.log(`✅ HTTP 服务器启动: http://localhost:${this.port}`);
          resolve();
        });
        
        this.server.on('error', (error) => {
          reject(error);
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 启动 WebSocket 服务器
   */
  async startWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // 创建 WebSocket 服务器
        this.wss = new WebSocketServer({ port: this.wsPort });
        
        // 连接处理
        this.wss.on('connection', (ws, req) => {
          const clientId = this._generateClientId();
          this.wsClients.set(clientId, ws);
          
          console.log(`✅ WebSocket 客户端连接: ${clientId}`);
          
          // 发送欢迎消息
          ws.send(JSON.stringify({
            type: 'connected',
            clientId,
            message: '已连接到 LoongClaw'
          }));
          
          // 消息处理
          ws.on('message', async (data) => {
            try {
              const payload = JSON.parse(data.toString());
              await this.handleWSMessage(clientId, payload, ws);
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                error: error.message
              }));
            }
          });
          
          // 关闭处理
          ws.on('close', () => {
            console.log(`❌ WebSocket 客户端断开: ${clientId}`);
            this.wsClients.delete(clientId);
          });
          
          // 错误处理
          ws.on('error', (error) => {
            console.error(`WebSocket 错误 (${clientId}):`, error.message);
          });
        });
        
        this.wss.on('listening', () => {
          console.log(`✅ WebSocket 服务器启动: ws://localhost:${this.wsPort}`);
          resolve();
        });
        
        this.wss.on('error', (error) => {
          reject(error);
        });
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  async handleWSMessage(clientId, payload, ws) {
    const { type, data } = payload;
    
    switch (type) {
      case 'chat':
        await this.handleWSChat(clientId, data, ws);
        break;
        
      case 'get_history':
        await this.handleWSGetHistory(clientId, data, ws);
        break;
        
      case 'clear_history':
        await this.handleWSClearHistory(clientId, data, ws);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `未知消息类型: ${type}`
        }));
    }
  }

  /**
   * 处理 WebSocket 聊天
   */
  async handleWSChat(clientId, data, ws) {
    const { message, sessionId = 'default' } = data;
    
    try {
      // 发送用户消息
      ws.send(JSON.stringify({
        type: 'message',
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      }));
      
      // 流式响应
      let fullResponse = '';
      
      await this.agent.processStream(
        message,
        (chunk) => {
          fullResponse += chunk;
          
          ws.send(JSON.stringify({
            type: 'message_chunk',
            content: chunk,
            timestamp: new Date().toISOString()
          }));
        },
        sessionId
      );
      
      // 发送完成消息
      ws.send(JSON.stringify({
        type: 'message_complete',
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString()
      }));
      
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  }

  /**
   * 处理获取历史
   */
  async handleWSGetHistory(clientId, data, ws) {
    const sessionId = data.sessionId || 'default';
    
    try {
      const history = this.agent.getHistory(sessionId);
      
      ws.send(JSON.stringify({
        type: 'history',
        sessionId,
        messages: history
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  }

  /**
   * 处理清除历史
   */
  async handleWSClearHistory(clientId, data, ws) {
    const sessionId = data.sessionId || 'default';
    
    try {
      this.agent.clearHistory(sessionId);
      
      ws.send(JSON.stringify({
        type: 'history_cleared',
        sessionId
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  }

  /**
   * 停止服务器
   */
  async stop() {
    // 关闭 WebSocket 服务器
    if (this.wss) {
      this.wss.close();
      console.log('✅ WebSocket 服务器已关闭');
    }
    
    // 关闭 HTTP 服务器
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('✅ HTTP 服务器已关闭');
          resolve();
        });
      });
    }
  }

  /**
   * 生成客户端 ID
   * @private
   */
  _generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 创建并启动 Web 服务器
 */
export async function startWebServer(agent, config) {
  const server = new WebServer(agent, config);
  
  await server.start();
  await server.startWebSocket();
  
  return server;
}

export default WebServer;
