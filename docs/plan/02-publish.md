# 02 发布与分发方案

## 目标
- 支持用户通过 npm 全局安装后直接使用 `loongclaw` 进入对话
- 保持本地开发与线上发布路径一致
- 提供可复现的版本发布流程

## 发布方式
- npm package 全局安装
  - `npm install -g loongclaw`
  - 二进制入口来自 `package.json` 的 `bin` 字段

## 本地开发与调试
- `npm link` 建立全局命令映射
- `loongclaw` 直接进入对话模式
- `loongclaw --list/--read/--write` 可验证基础能力

## 版本发布流程
- 版本号管理：使用语义化版本
- 发布流程建议
  1. 更新版本号与变更记录
  2. 运行测试
  3. `npm publish --access public`

## 环境变量管理
- 使用 `.env` 管理 key
- 发布包不包含 `.env`
- 运行时读取环境变量
  - `LLM_PROVIDER`
  - `DEEPSEEK_API_KEY` / `GLM_API_KEY`

## 分发补充
- 可选：提供 `npx loongclaw` 方式直接运行
- 可选：提供 Homebrew 或安装脚本
