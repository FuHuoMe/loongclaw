# 000 Project Summary

## 概览
- CLI 入口统一在 cli.js，支持单次执行与 REPL 交互
- Agent 核心在 core/agent.js，负责系统提示、会话、记忆、工具调用与流式输出
- 工具系统在 core/tools.js，内置文件与命令执行能力

## 已实现的关键能力

### 1) 内部指令拦截（/model /models /lang）
- 位置：cli.js
- 逻辑：在 REPL 和单次执行前优先处理内部指令，避免发送到 LLM
- 结果：/model /models /lang 不再触发工具调用或目录误判

### 2) 多模型与提供商切换
- 位置：cli.js
- 逻辑：读取环境变量与默认模型列表，支持 deepseek/glm/kimi 回退
- 结果：/model 与 /models 可查看与切换模型与提供商

### 3) 语言切换与别名映射
- 位置：cli.js
- 逻辑：/lang 为主指令，支持 /language /zh /en /中文 /英文 /语言 等别名
- 结果：显示语言仅用 en/汉，REPL 支持等待下一条输入作为语言参数

### 4) 系统提示注入与可扩展配置
- 位置：core/agent.js
- 逻辑：默认系统提示 + config/SOUL.md + config/SYSTEM_PROMPTS..md 叠加
- 结果：每次对话都会带上项目级约束与提示

### 5) Workspace 根目录规则
- 位置：core/agent.js 与 SETTING.md
- 逻辑：系统提示中强制声明 workspace 为文件根目录
- 结果：回答中输出绝对路径时必须包含 workspace 层级

### 6) 工具分级策略（绿/白/灰/黑）
- 位置：core/tools.js
- 逻辑：
  - 绿/白名单自动允许
  - 灰名单必须显式确认 approval=once 或 approval=remember_7d
  - 黑名单直接拒绝
- 缓存：sessions/command-approvals.json，按工作目录与命令签名缓存 7 天

### 7) 文档同步
- 位置：docs/plan/06-command-list.md
- 逻辑：补充绿/白/灰/黑示例与确认缓存说明
- 结果：文档与实际策略一致

## 关键文件清单
- cli.js：CLI 入口与内部指令处理
- core/agent.js：系统提示构建、对话调度、工具调用
- core/tools.js：内置工具与命令策略
- config/SYSTEM_PROMPTS..md：系统级执行约束
- SETTING.md：workspace 根目录规则
- docs/plan/06-command-list.md：命令分级策略文档

## 设计约束与约定
- 所有文件操作以 workspace 为根目录
- 命令执行必须走 exec_shell 并遵守分级策略
- 交互中显示路径必须包含 workspace 层级

## 待办方向（未实现）
- CLI 交互层的灰名单 1/2/3 选择提示
- 将策略注入机制做成可配置开关
