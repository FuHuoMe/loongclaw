# LoongClaw Cloudflare 部署计划 🐉☁️

## 📋 计划概述

**目标**: 将 LoongClaw 部署到 Cloudflare 平台（Workers + Container）

**优势**:
- ✅ 全球边缘网络
- ✅ 免费额度充足
- ✅ 自动扩展
- ✅ 低延迟访问
- ✅ 零运维成本

**创建时间**: 2026年2月12日
**预计完成**: 2026年2月19日（1周）

---

## 🏗️ 架构设计

### 部署架构

```
┌─────────────────────────────────────────────┐
│         Cloudflare 平台                      │
│  ┌──────────────────────────────────────┐  │
│  │  Cloudflare Workers (边缘计算)      │  │
│  │  - HTTP API 处理                   │  │
│  │  - WebSocket 网关                  │  │
│  │  - 静态文件服务                   │  │
│  └──────────┬───────────────────────────┘  │
│             │                              │
│  ┌──────────▼───────────────────────────┐  │
│  │  Cloudflare Container (Docker)      │  │
│  │  - Agent 引擎                      │  │
│  │  - LLM 调用                       │  │
│  │  - 记忆系统 (R2 Storage)          │  │
│  └──────────┬───────────────────────────┘  │
│             │                              │
│  ┌──────────▼───────────────────────────┐  │
│  │  Cloudflare R2 (对象存储)          │  │
│  │  - 记忆持久化                      │  │
│  │  - 会话历史                        │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 组件分工

#### 1. Workers 层（轻量级）

**职责**:
- HTTP 请求路由
- WebSocket 网关
- 静态文件服务（WebChat UI）
- 限流和认证

**限制**:
- CPU 时间: 10ms (免费) / 50ms (付费)
- 内存: 128MB
- 适合: 轻量级任务

#### 2. Container 层（重量级）

**职责**:
- Agent 核心逻辑
- LLM API 调用
- 工具执行
- 记忆管理

**优势**:
- 无 CPU 时间限制
- 支持完整 Node.js 运行时
- 可访问外部 API

#### 3. R2 存储（持久化）

**用途**:
- 记忆文件存储
- 会话历史归档
- 配置文件

---

## 🚀 实施方案

### 阶段 1: 代码重构 (Day 1-2)

#### 1.1 拆分架构

**当前架构** (单体):
```
index.js → Agent → Tools/Memory → Web Server
```

**目标架构** (微服务):
```
Workers (API) → Container (Agent) → R2 (Storage)
```

#### 1.2 Workers 入口

**文件**: `workers/index.js`

```javascript
import { Router } from 'itty-router';

const router = Router();

// 健康检查
router.get('/health', () => ({
  status: 'ok',
  timestamp: Date.now()
}));

// API 路由到 Container
router.all('/api/*', async (request) => {
  const containerUrl = 'https://loongclaw-container.workers.dev';
  return fetch(containerUrl + request.url);
});

// WebSocket 升级
router.upgrade('/ws', (client) => {
  // 转发到 Container
  const ws = new WebSocket(containerUrl);
  // ...
});

// 静态文件服务
router.get('*', () => {
  // 返回 WebChat UI
});

export default {
  fetch: router.handle
};
```

#### 1.3 Container 适配

**文件**: `container/index.js`

```javascript
import { createAgent } from '../core/agent.js';

// 创建 Agent（全局单例）
const agent = await createAgent({
  llm: {
    apiKey: env.GLM_API_KEY,
    model: 'glm-4-flash'
  },
  memory: {
    memoryDir: '/r2/memory'  // R2 挂载点
  }
});

// Export for Cloudflare Workers
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 路由处理
    if (url.pathname === '/api/chat') {
      // ...
    }
    
    return new Response('Not found', { status: 404 });
  }
};
```

#### 1.4 R2 存储适配

**文件**: `core/storage-r2.js`

```javascript
/**
 * R2 存储适配器
 */
class R2Storage {
  constructor(bucket) {
    this.bucket = bucket;
  }
  
  async get(key) {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return await object.text();
  }
  
  async put(key, value) {
    await this.bucket.put(key, value);
  }
  
  async delete(key) {
    await this.bucket.delete(key);
  }
  
  async list(prefix = '') {
    const listed = await this.bucket.list({ prefix });
    return listed.objects;
  }
}

export default R2Storage;
```

---

### 阶段 2: Cloudflare 配置 (Day 3)

#### 2.1 wrangler.toml

**Workers 配置**: `wrangler-workers.toml`

```toml
name = "loongclaw-api"
main = "workers/index.js"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
CONTAINER_URL = "https://loongclaw-container.workers.dev"

[[routes]]
pattern = "api.loongclaw.workers.dev/*"
zone_name = "loongclaw.workers.dev"
```

**Container 配置**: `wrangler-container.toml`

```toml
name = "loongclaw-container"
main = "container/index.js"
compatibility_date = "2024-01-01"

[build]
command = "npm run build:container"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "loongclaw-storage"

[vars]
GLM_API_KEY = ""  # 从 secrets 获取
```

#### 2.2 Secrets 配置

```bash
# Workers secrets
wrangler secret put GLM_API_KEY --env production
wrangler secret put R2_ACCESS_KEY_ID --env production

# Container secrets
wrangler secret put GLM_API_KEY
wrangler secret put R2_SECRET_ACCESS_KEY
```

---

### 阶段 3: 部署流程 (Day 4)

#### 3.1 部署 Workers

```bash
# 安装 wrangler
npm install -g wrangler

# 登录
wrangler login

# 部署 Workers
cd workers
wrangler deploy --env production

# 部署 Container
cd container
wrangler deploy --env production
```

#### 3.2 创建 R2 Bucket

```bash
# 创建 bucket
wrangler r2 bucket create loongclaw-storage

# 验证
wrangler r2 bucket list
```

#### 3.3 配置域名

```bash
# 添加自定义域名（可选）
wrangler custom-domains add api.loongclaw.workers.dev
```

---

### 阶段 4: 测试与优化 (Day 5-6)

#### 4.1 功能测试

- [ ] API 端点测试
- [ ] WebSocket 连接测试
- [ ] 记忆持久化测试
- [ ] 工具调用测试

#### 4.2 性能测试

- [ ] 响应时间测试
- [ ] 并发测试
- [ ] 边缘缓存测试

#### 4.3 安全测试

- [ ] API 认证测试
- [ ] 限流测试
- [ ] CORS 配置测试

---

### 阶段 5: 文档与发布 (Day 7)

#### 5.1 文档编写

- [ ] 部署指南 (`docs/DEPLOY-CLOUDFLARE.md`)
- [ ] 配置说明 (`docs/CONFIGURATION.md`)
- [ ] 故障排除 (`docs/TROUBLESHOOTING.md`)

#### 5.2 发布准备

- [ ] 版本更新: v0.2.0
- [ ] Release Notes
- [ ] GitHub Actions CI

---

## 💰 成本分析

### Cloudflare 定价（免费额度）

| 资源 | 免费额度 | 超出费用 |
|------|----------|-----------|
| **Workers Requests** | 100,000/天 | $0.50/百万 |
| **Workers CPU Time** | 10ms/请求 | $12.50/百万 ms |
| **Container** | 30天试用 | $5-30/月 |
| **R2 Storage** | 10GB | $0.015/GB/月 |
| **R2 Class A Operations** | 1000万次/月 | $4.50/百万次 |
| **R2 Class B Operations** | 1000万次/月 | $0.36/百万次 |

### 预估成本

**小型项目** (个人使用):
- Workers: 免费
- Container: $5/月
- R2: 免费 (10GB 以内)
- **总计**: ~$5/月

**中型项目** (社区使用):
- Workers: $1/月
- Container: $5/月
- R2: $0.50/月
- **总计**: ~$6.50/月

**大型项目** (商业使用):
- Workers: $10/月
- Container: $30/月
- R2: $5/月
- **总计**: ~$45/月

---

## 🔧 技术挑战

### 1. Workers CPU 限制

**问题**: 10ms CPU 时间太短

**解决方案**:
- 只在 Workers 处理轻量级任务
- 重计算任务转发到 Container
- 使用 Cloudflare KV 缓存

### 2. WebSocket 连接

**问题**: Workers WebSocket 支持有限

**解决方案**:
- 使用 Container 处理 WebSocket
- Workers 作为 TCP 负载均衡
- 实现 WebSocket 心跳机制

### 3. 文件系统访问

**问题**: Workers 无文件系统

**解决方案**:
- 使用 R2 替代文件系统
- 记忆文件存储到 R2
- 临时数据使用 KV

### 4. 环境变量

**问题**: Secrets 管理复杂

**解决方案**:
- 使用 `wrangler secret put`
- 区分 Workers/Container secrets
- 文档化所有变量

---

## 📊 对比分析

### Cloudflare vs 传统 VPS

| 特性 | Cloudflare | VPS (DigitalOcean) |
|------|------------|-------------------|
| **部署复杂度** | ⭐⭐ | ⭐⭐⭐⭐ |
| **全球 CDN** | ✅ 包含 | ❌ 需额外配置 |
| **自动扩展** | ✅ 是 | ❌ 否 |
| **维护成本** | ⭐ 低 | ⭐⭐⭐ 高 |
| **成本** | $5-45/月 | $4-48/月 |
| **冷启动** | ⚠️ 有延迟 | ✅ 即时 |
| **持久化** | R2 | SSD |
| **适用场景** | 边缘应用 | 完整控制 |

### 结论

**优势选择 Cloudflare**:
- 需要全球低延迟
- 流量波动大
- 零运维需求
- 边缘计算需求

**优势选择 VPS**:
- 需要完整控制
- 长时间运行任务
- 复杂依赖
- 成本敏感

---

## 🎯 成功标准

### 功能指标
- ✅ 所有 API 端点正常工作
- ✅ WebSocket 流式对话
- ✅ 记忆持久化到 R2
- ✅ 工具调用正常

### 性能指标
- ✅ P95 延迟 < 200ms
- ✅ 99.9% 可用性
- ✅ 1000 并发支持

### 运维指标
- ✅ 零停机部署
- ✅ 自动回滚机制
- ✅ 监控告警配置

---

## 📝 附录

### 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare Container 文档](https://developers.cloudflare.com/workers/platform/bindings/)
- [R2 Storage 文档](https://developers.cloudflare.com/r2/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 替代方案

如果 Cloudflare 不适合，可以考虑：

1. **Vercel + VPS**
   - Vercel: 前端和 API
   - VPS: Agent 服务

2. **Railway**
   - 全栈部署
   - 自动扩展
   - $5/月起

3. **Fly.io**
   - 全球边缘网络
   - Docker 支持
   - 免费额度

---

## 🚀 下一步行动

### 立即开始
1. 阅读本文档
2. 创建 Cloudflare 账号
3. 安装 Wrangler CLI
4. 创建测试项目

### 本周目标
- [ ] 完成代码重构
- [ ] 部署到 Cloudflare
- [ ] 功能测试通过
- [ ] 文档编写完成

---

**计划版本**: v1.0
**创建时间**: 2026年2月12日
**创建者**: 熊大 🐉💪
**预计完成**: 2026年2月19日
