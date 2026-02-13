# LoongClaw CLI 规划

## 目标
- 提供一个稳定、可观察、易调试的命令行入口，优先验证工具调用与文件操作能力
- 在 UI 之前打通“指令 → 工具调用 → 结果回传”的闭环
- 形成可扩展的 CLI 架构，为后续 UI 复用打基础

## 范围
- 优先：单次指令模式与交互模式
- 次级：脚本化批处理、会话导出与回放
- 不包含：复杂前端交互、可视化任务面板

## CLI 形式
- 单次指令模式
  - 例：`loongclaw "在 workspace 下创建文件 stories/forest.txt，内容是：森林的清晨。然后读取该文件并把内容发给我"`
- 交互模式
  - 例：`loongclaw --repl`，在终端中持续对话

## 输出策略
- 默认输出两段信息
  - 助手文本输出
  - 工具执行日志（包含工具名、参数、结果摘要）
- 可选参数控制输出
  - `--no-tools` 隐藏工具日志
  - `--json` 以结构化 JSON 输出所有阶段信息

## CLI 能力清单
### 已有工具能力
- `read_file` 读取 workspace 下文件
- `write_file` 写入 workspace 下文件（如不存在则创建）
- `list_directory` 列出 workspace 下目录
- `exec_shell` 执行白名单命令（默认仅 `ls/pwd/echo/cat/head/tail/grep/wc`）
- `get_current_time` 获取当前时间

### CLI 应支持的能力（封装层）
- 会话管理：`--session <id>`、`--clear-session`
- 超时控制：`--timeout <ms>`
- 工具白名单/路径限制：`--allowed-paths <list>`
- 日志等级：`--log-level debug|info|warn|error`

## 配置来源
- `.env` 为主
- CLI 参数可覆盖 `.env`
- 关键变量
  - `LLM_PROVIDER`、`DEEPSEEK_API_KEY`、`GLM_API_KEY`
  - `WORKSPACE_DIR`、`ALLOWED_PATHS`
  - `SHELL_TIMEOUT`

## 交互流程设计
1. 解析 CLI 参数，构建 Agent 配置
2. 执行用户指令或进入交互循环
3. 处理工具调用并输出工具日志
4. 输出最终回复

## 关键实现方案
### 新入口文件
新增 `cli.js` 作为入口，职责：
- 解析参数
- 初始化 Agent
- 执行单次或 REPL 流程
- 输出结果与工具日志

### 工具日志
在 Agent 层或 CLI 层拦截工具调用结果：
- 输出工具名、参数、结果摘要
- 失败时输出 error 字段

### 文件路径策略
CLI 只允许访问 workspace 下路径：
- CLI 输出提示：`workspace/<path>`
- 若用户输入绝对路径，提示并回退到 workspace 相对路径

## 错误处理策略
- 请求错误：输出模型错误信息与建议
- 工具错误：输出工具错误并继续对话
- 解析错误：保底输出原始响应文本

## 兼容性与安全
- 默认最小权限，只允许 workspace
- Shell 命令严格白名单
- 禁止在 CLI 中打印敏感密钥

## MVP 里程碑
1. 单次命令模式可用
2. 工具调用日志清晰可读
3. 能稳定完成“写文件 → 读文件 → 输出内容”
4. REPL 模式可持续对话

## 后续增强
- 任务计划与多步执行可视化
- 结果导出（markdown、json）
- 自定义工具插件机制

