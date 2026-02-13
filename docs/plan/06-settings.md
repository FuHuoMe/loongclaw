# 06 Settings 文档设计与模型配置

## Settings 文档目标
- 统一记录运行参数、约束与开关
- 方便不同环境复用同一套配置

## 建议位置
- `config/SETTINGS.md`

## Settings 内容结构
- 运行环境与路径
- 模型与密钥选择
- 工具限制与安全边界
- 输出格式与日志级别

## 模型选择逻辑
- `LLM_PROVIDER` 控制提供商：`deepseek | glm | kimi`
- 选择对应的模型变量与 API Key
  - DeepSeek: `DEEPSEEK_API_KEY` + `DEEPSEEK_MODEL`
  - GLM: `GLM_API_KEY` + `GLM_MODEL`
  - Kimi: `KIMI_API_KEY` + `KIMI_MODEL`
- 未设置时使用默认模型

## 默认优先级
- 未设置 `LLM_PROVIDER` 时默认 DeepSeek
- DeepSeek 未配置 Key 时回退到 `GLM_API_KEY`

## 环境变量示例
```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions

LLM_PROVIDER=glm
GLM_API_KEY=your_key
GLM_MODEL=glm-5,glm-4.7
GLM_API_URL= https://open.bigmodel.cn/api/coding/paas/v4

LLM_PROVIDER=kimi
KIMI_API_KEY=your_key
KIMI_MODEL=moonshot-v1-8k
KIMI_API_URL=https://api.moonshot.cn/v1/chat/completions
```

## CLI 运行建议
- 统一使用 `.env` 保存密钥
- 本地调试可通过命令行临时覆盖

## 约束与安全
- 仅允许访问 `workspace` 目录
- Shell 命令默认白名单
- 禁止在日志中输出完整密钥
