# 03 CLI 指令扩展规划

## 目标
- 在 CLI 中覆盖常见的文件与会话操作
- 指令语义清晰，避免必须依赖自然语言对话

## 现有指令
- `--list <path>`
- `--read <path>`
- `--write <path> <content>`
- `--repl`

## 拟扩展指令
- 文件与目录
  - `--mkdir <path>` 创建目录
  - `--rm <path>` 删除文件或目录
  - `--mv <from> <to>` 移动/重命名
  - `--cp <from> <to>` 复制
  - `--cat <path>` 读取并带行号
- 会话
  - `--session <id>` 指定会话
  - `--history <id>` 查看历史
  - `--clear <id>` 清空历史
- 工具输出与调试
  - `--json` 结构化输出
  - `--log-level <level>` 控制日志级别

## 命令设计原则
- 所有路径默认在 workspace 下
- 失败时返回明确错误信息
- 支持批量操作但保持可控
