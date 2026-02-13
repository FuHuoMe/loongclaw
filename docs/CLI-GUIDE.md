# LoongClaw CLI 使用指南

**版本**: v0.3.0-alpha
**更新日期**: 2026年2月13日

---

## 🚀 快速开始

### 安装
```bash
# 克隆项目
git clone https://github.com/FuHuoMe/loongclaw.git
cd loongclaw

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key
```

### 基本使用

#### 1. 单次命令模式
```bash
# 直接提问
node cli.js "你好熊大，请用一句话自我介绍一下"

# 执行任务
node cli.js "在当前目录创建文件 test.txt，内容是：Hello World"

# 读取文件
node cli.js "读取 test.txt 文件的内容"
```

#### 2. 交互模式（REPL）
```bash
node cli.js --repl

# 或者直接运行
node cli.js
```

在交互模式中：
```
🐉 loongclaw> 你好
🐉 熊大: 你好！我是熊大，森林守护者...

🐉 loongclaw> 创建文件 hello.md，内容是：# 你好世界
🔧 工具调用: write_file
📝 参数: {"path":"hello.md","content":"# 你好世界"}
✅ 结果: {"success":true,"path":"hello.md"}
⏱️  耗时: 15ms

🐉 熊大: 文件已创建...

🐉 loongclaw> exit
👋 再见！
```

#### 3. 脚本模式
创建脚本文件 `tasks.txt`:
```
# 我的自动化任务
创建文件 story.md，内容是：# 森林的故事
读取 story.md
列出当前目录的文件
```

执行脚本：
```bash
node cli.js --file tasks.txt
```

---

## 🔧 配置选项

### 环境变量

在 `.env` 文件中配置：

```bash
# LLM 配置
LLM_PROVIDER=deepseek          # 提供商: deepseek|glm|kimi
DEEPSEEK_API_KEY=your_key_here
GLM_API_KEY=your_key_here

# 工作空间
WORKSPACE_DIR=/path/to/workspace  # 默认: 当前目录
ALLOWED_PATHS=/path/to/workspace  # 允许访问的路径（逗号分隔）

# CLI 行为
SHOW_TOOLS=true                 # 显示工具调用日志 (true|false)
JSON_OUTPUT=false               # JSON 格式输出 (true|false)
LOG_LEVEL=info                 # 日志等级 (debug|info|warn|error)

# 工具限制
SHELL_TIMEOUT=30000             # Shell 命令超时（毫秒）
```

### CLI 参数

```bash
# 单次命令
node cli.js "你的问题"

# 交互模式
node cli.js --repl

# 脚本模式
node cli.js --file script.txt

# 帮助
node cli.js --help
```

---

## 🛠️ 内置工具

### 文件操作

#### 1. read_file - 读取文件
```bash
node cli.js "读取 config.json"
node cli.js "读取 ./data/report.md 的前 50 行"
```

#### 2. write_file - 写入文件
```bash
node cli.js "创建文件 README.md，内容是：# 我的项目

这是一个很棒的项目。"
```

#### 3. list_directory - 列出目录
```bash
node cli.js "列出当前目录"
node cli.js "列出 src 目录下所有 .js 文件"
```

### Shell 命令

#### 4. execute_shell - 执行 Shell 命令
```bash
# 白名单命令: ls, pwd, echo, cat, head, tail, grep, wc
node cli.js "执行 ls -la"
node cli.js "用 grep 搜索文件中的关键词"
node cli.js "统计文件行数"
```

### 其他工具

#### 5. get_current_time - 获取时间
```bash
node cli.js "现在几点了？"
node cli.js "用中文格式化当前时间"
```

---

## 💡 使用技巧

### 1. 工作空间管理

```bash
# 设置专属工作空间
WORKSPACE_DIR=/root/myproject node cli.js "创建文件 notes.txt"

# 多路径访问
ALLOWED_PATHS=/root/project,/tmp/files node cli.js "读取文件"
```

### 2. 调试模式

```bash
# 显示工具调用详情
SHOW_TOOLS=true node cli.js "列出当前目录"

# JSON 输出（用于脚本处理）
JSON_OUTPUT=true node cli.js "读取 config.json" > result.json
```

### 3. 批量任务

创建 `batch.txt`:
```
创建文件 file1.txt，内容是：第一个文件
创建文件 file2.txt，内容是：第二个文件
创建文件 file3.txt，内容是：第三个文件
列出当前目录
```

执行：
```bash
node cli.js --file batch.txt
```

### 4. 交互模式快捷命令

在 REPL 中：
```
!help           # 显示帮助
!session        # 显示会话信息
!clear-session  # 清除会话历史
!workspace      # 显示当前工作目录
exit            # 退出程序
```

---

## 🔒 安全说明

### 路径限制
- **默认**: 只能访问当前工作目录
- **配置**: 通过 `ALLOWED_PATHS` 设置允许的路径
- **保护**: 自动阻止路径遍历攻击（`../`）

### Shell 命令白名单
默认只允许安全的命令：
- `ls` - 列出文件
- `pwd` - 显示当前目录
- `echo` - 输出文本
- `cat` - 读取文件
- `head` - 文件开头
- `tail` - 文件结尾
- `grep` - 搜索文本
- `wc` - 统计

### 命令注入防护
- 自动过滤危险字符：`& ; | < > ` $`
- 验证参数格式
- 超时保护（默认 30 秒）

---

## 📊 输出格式

### 默认输出
```
👤 用户: 创建文件 test.txt

🔧 工具调用: write_file
📝 参数: {
  "path": "test.txt",
  "content": "Hello World"
}
✅ 结果: {"success":true,"path":"test.txt"}
⏱️  耗时: 12ms

🐉 熊大: 文件已创建成功！
```

### JSON 输出
```bash
JSON_OUTPUT=true node cli.js "你好"
```

```json
{
  "message": "你好",
  "response": "你好！我是熊大...",
  "sessionId": "cli-default",
  "timestamp": "2026-02-13T10:30:00.000Z",
  "tools": [
    {
      "name": "write_file",
      "arguments": {...},
      "result": {...},
      "duration": 12
    }
  ]
}
```

---

## 🐛 故障排除

### 问题 1: API 密钥错误
```
❌ 错误: LLM API 错误: 401
```

**解决**: 检查 `.env` 文件中的 API Key 是否正确

### 问题 2: 路径访问拒绝
```
❌ 错误: 路径不允许访问: /etc/passwd
```

**解决**: 使用 `ALLOWED_PATHS` 添加允许的路径

### 问题 3: Shell 命令不在白名单
```
❌ 错误: 命令不在白名单中: rm
```

**解决**: 只使用白名单命令，或修改源码添加命令

---

## 📚 高级用法

### 1. 自定义工具

编辑 `core/tools.js`，添加新工具：

```javascript
{
  name: 'my_custom_tool',
  description: '我的自定义工具',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: '参数1' }
    },
    required: ['param1']
  },
  handler: async (args) => {
    // 实现你的逻辑
    return { result: 'success' };
  }
}
```

### 2. 会话管理

```javascript
import { createAgent } from './core/agent.js';

const agent = await createAgent({...});

// 创建新会话
await agent.process('你好', 'session-1');

// 继续会话
await agent.process('还记得我吗？', 'session-1');

// 清除会话
agent.clearHistory('session-1');
```

### 3. 记忆系统

```javascript
// 保存记忆
await agent.memory.save('用户喜欢蓝色', 'user_preference', 'high');

// 搜索记忆
const results = await agent.memory.search({
  keyword: '蓝色',
  limit: 5
});
```

---

## 🎯 下一步

- [ ] 添加更多内置工具
- [ ] 支持插件系统
- [ ] 添加任务调度器
- [ ] 支持多用户会话
- [ ] Web UI 复用核心逻辑

---

**文档版本**: v0.3.0-alpha
**最后更新**: 2026年2月13日
**维护者**: 熊大 🐉💪
