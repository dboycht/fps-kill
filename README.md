# FPS杀

FPS 题材的类三国杀卡牌对战游戏。设计目标：**高度可进化**——每张角色卡、每个技能都通过「自然语言描述 → AI 添加机制」的方式逐步加入。

## 当前状态

- **规则引擎**（`packages/engine`）：杀/闪/桃三件套 + 花色点数实体牌堆（47 张，来自真实素材）+ 技能钩子注册表 + 僵局/回合上限终局判定 + bot 自动对局与回放。14 项单测全绿，300 局压力扫描 0 错误。
- **热座页面**（`apps/web`）：牌桌对战（出牌/结算/Bot 代打/终局弹层）+ 图鉴（98 张手牌、12 张武将立绘、6 件装备的设计数据展示）。武器与未实装牌的效果文本已收录，等机制定义。

## 运行

```bash
pnpm install
pnpm verify        # 类型检查 + 14 项单测
pnpm demo          # 3 局 bot 自动对局，回放写入 logs/demo/
pnpm web:dev       # 热座页面 http://localhost:5173
```

素材重建（需本机素材备份）：`node scripts/prepare-assets.mjs <素材目录>`

## 技术栈

TypeScript（原生 ESM，Node ≥ 22.15，直跑 .ts 源码）· pnpm monorepo · Vite + DOM/CSS ·
规划中：Tauri 2 桌面壳、mkx-link 联机。

## 许可

CC-BY-NC-4.0，Copyright (c) Mizuki，见 `LICENSE`。
