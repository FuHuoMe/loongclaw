# 06 Command List 设计（绿/白/灰/黑名单）

## 目标
- 为 CLI 指令建立分级许可制度
- 降低高风险命令误操作
- 保持常用命令流畅体验

## 名单定义
### 绿名单（自动允许）
**特征**: 只读、安全、无副作用  
**策略**: 无提示直接执行  
**示例**:
- 文件读取: `cat`, `head`, `tail`, `wc`, `grep`, `rg`
- 目录查看: `ls`, `pwd`
- 信息输出: `echo`, `which`, `whoami`, `uname`, `date`, `uptime`, `df`, `du`
- CLI 工具内置 `read_file`, `list_directory`

### 白名单（低风险）
**特征**: 可控、低副作用、常规开发操作  
**策略**: 默认允许，可记录日志  
**示例**:
- `git status`, `git diff`, `git log`, `git show`
- `npm test`, `npm run lint`, `npm run typecheck`
- `pnpm test`, `pnpm run lint`

### 灰名单（需确认）
**特征**: 可能产生副作用、依赖上下文风险  
**策略**: 交互确认  
**确认选项**:
1. 仅本次允许  
2. 允许并记住 7 天  
3. 拒绝  
**示例**:
- `npm install`, `npm ci`, `npm publish`
- `npm run build`, `npm run dev`, `npm run start`
- `yarn install`, `pnpm install`, `bun install`
- `git checkout`, `git pull`, `git fetch`, `git merge`, `git rebase`, `git commit`, `git push`
- `node`, `python`, `pip install`
- 任何带 `sudo` 的命令

### 黑名单（禁止执行）
**特征**: 破坏性、不可逆、高风险  
**策略**: 直接拒绝并返回提示  
**示例**:
- 文件删除/覆盖: `rm`, `mv`(覆盖), `dd`, `truncate`
- 系统破坏: `mkfs`, `shutdown`, `reboot`, `kill -9`
- 权限变更: `chmod 777 /`, `chown -R /`
- 任意网络下载执行: `curl | sh`, `wget | sh`

## 策略细节
### 1. 命令匹配规则
- 先匹配黑名单，再匹配灰名单，最后白名单与绿名单
- 支持正则与前缀匹配（例如 `rm`, `rm -rf`）
- 对参数进行归一化（去掉多余空格与引号）

### 2. 确认与缓存
- 灰名单确认结果可缓存 7 天（按命令签名 + 工作目录）
- 缓存到本地文件，例如 `sessions/command-approvals.json`
- 支持手动清理与过期自动清理
- 灰名单命令需要显式确认参数（单次或 7 天记住）

### 3. 交互文案建议
```
⚠️ 灰名单命令：npm run build
请选择：
1) 仅本次允许
2) 允许并记住 7 天
3) 拒绝
```

### 4. 拒绝提示建议
```
❌ 黑名单指令，请自己操作。
```

## 与现有工具的结合
- `exec_shell` 统一走名单策略
- 内置文件工具 `read_file`/`write_file` 不走 shell 名单
- 可在 CLI 启动时加载自定义配置文件覆盖默认名单

## 可选增强建议
- 按项目/目录隔离缓存
- 按用户会话隔离缓存
- 支持 `--dry-run` 预览即将执行的命令
- 支持 `--policy <path>` 指定策略文件
