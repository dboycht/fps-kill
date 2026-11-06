# FPS杀

FPS 题材的类三国杀卡牌对战游戏。设计目标：**高度可进化**——每张角色卡、每个技能都通过「自然语言描述 → AI 添加机制」的方式逐步加入。

## 当前状态

规则引擎 MVP（无界面）：数据驱动的卡牌/角色定义 + 技能钩子注册表 + bot 自动对局与回放。

## 运行

```bash
pnpm install
pnpm verify   # 类型检查 + 单测
pnpm demo     # 跑 3 局 bot 自动对局，回放写入 logs/demo/
```

## 技术栈

TypeScript（原生 ESM，Node ≥ 22.15，直跑 .ts 源码）· pnpm monorepo ·
规划中：Vite + DOM/CSS 客户端、Tauri 2 桌面壳、mkx-link 联机。

## 许可

CC-BY-NC-4.0，Copyright (c) Mizuki，见 `LICENSE`。
