/**
 * LoongClaw - 主入口
 * 
 * 启动 LoongClaw Agent 服务
 */

import { createAgent } from './core/agent.js';
import { startWebServer } from './core/server.js';
import { config } from 'dotenv';

// 加载环境变量
config();

/**
 * 主函数
 */
async function main() {
  console.log('🐉 LoongClaw 启动中...\n');
  
  try {
    // 创建 Agent
    const agent = await createAgent({
      llm: {
        provider: process.env.LLM_PROVIDER || 'deepseek',
        apiKey: process.env.LLM_PROVIDER === 'glm'
          ? process.env.GLM_API_KEY
          : (process.env.DEEPSEEK_API_KEY || process.env.GLM_API_KEY),
        apiUrl: process.env.LLM_PROVIDER === 'glm'
          ? (process.env.GLM_API_URL || 'https://open.bigmodel.cn/api/anthropic')
          : (process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'),
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
    });
    
    console.log('✅ LoongClaw 初始化完成！\n');
    console.log(`📊 统计信息:`);
    console.log(`   - 会话数: ${agent.getStats().sessions}`);
    console.log(`   - 工具数: ${agent.getStats().tools}`);
    console.log(`   - 记忆数: ${agent.getStats().shortTermMemories}\n`);
    
    // 如果有命令行参数，执行单次对话
    const args = process.argv.slice(2);
    if (args.length > 0) {
      const message = args.join(' ');
      console.log(`👤 用户: ${message}\n`);
      
      const response = await agent.process(message);
      console.log(`🐉 熊大: ${response}\n`);
      
      process.exit(0);
    }
    
    // 启动 Web 服务器
    console.log('🌐 启动 Web 服务器...\n');
    const server = await startWebServer(agent, {
      port: process.env.PORT || 3000,
      wsPort: process.env.WS_PORT || 3001
    });
    
    console.log('\n🚀 LoongClaw 已就绪！\n');
    console.log('📍 访问地址:');
    console.log(`   - HTTP:  http://localhost:${server.port}`);
    console.log(`   - WS:    ws://localhost:${server.wsPort}`);
    console.log(`   - UI:    http://localhost:${server.port}\n`);
    console.log('💡 按 Ctrl+C 停止服务器\n');
    
    // 优雅关闭
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 正在关闭服务器...\n');
      await server.stop();
      console.log('✅ LoongClaw 已关闭\n');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行主函数
main();
