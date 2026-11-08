# FPS杀

FPS 题材的类三国杀卡牌对战游戏。设计目标：**高度可进化**——每张角色卡、每个技能都通过「自然语言描述 → AI 添加机制」的方式逐步加入。

## 当前状态（v1.1.0）

- **规则引擎**（`packages/engine`）：杀/闪/桃 + 九种技能牌 + 花色点数实体牌堆（98 张）+ **12 名武将**（卡面技能转录，判定/阵营/轮次/标记/主动技框架）+ 环形距离 + 2..8 人局 + bot 自动对局与回放。54 项单测全绿；300 局扫描全部真实分出胜负、平均 17.6 回合。
- **热座页面**（`apps/web`）：牌桌对战 + 图鉴（缩略图秒开）+ **联机大厅**（房主配人数/座位表/开局门控）+ 主动技按钮。
- **联机**（`apps/server`）：mkx-link 权威 reducer 房间，一个端口 = 中继 + 对局房间 + 游戏页托管。

## 运行

```bash
pnpm install
pnpm verify        # 类型检查（引擎+web+server）+ 54 项单测
pnpm demo          # 3 局 bot 自动对局，回放写入 logs/demo/
pnpm web:dev       # 热座页面 http://localhost:5173
```

## 联机

一个进程搞定（中继 + 权威对局房间 + 静态托管游戏页）：

```bash
pnpm web:build     # 首次或改过前端后
pnpm server        # 默认 0.0.0.0:7000，可 --port/--host
```

- **房主**开 `http://<主机IP>:7000/` → 顶栏「联机」→ 连接 → 落座（= 房主，座位1）→ 配置人数（2..8）。
- **玩家**各自开同一地址 → 连接 → 落座；人数齐后**房主点「开始对局」** → 系统随机发放武将 → 按 seat 顺序轮流（摸 2 → 出牌 → 弃牌至体力，参照三国杀）。
- 断线重连自动恢复局面与座位（同一浏览器标签内；刷新页面亦续座）。
- ⚠️ **手牌为荣誉制**：服务器全量快照广播，DevTools 能看到对手手牌；防偷看（裁判制）留待后续。
- 外网联机：给中继套隧道（ngrok / frp / Cloudflare Tunnel / tailscale funnel），见 mkx-link 仓库 `docs/TUNNELING.md`。
- 服务器无持久化：进程重启即清房；对手中途关页其座位被锁，房主可「重置房间」回收。
- 武将技能按卡面转录实装了核心子集，逐将实装清单与未实装部分见项目内 `DEVELOPMENT.md` §3.6。

素材重建（需本机素材备份）：`node scripts/prepare-assets.mjs <素材目录>`

## 技术栈

TypeScript（原生 ESM，Node ≥ 22.15，直跑 .ts 源码）· pnpm monorepo · Vite + DOM/CSS ·
联机 = mkx-link（本地 `link:` 依赖）· 规划中：Tauri 2 桌面壳。

## 许可

CC-BY-NC-4.0，Copyright (c) Mizuki，见 `LICENSE`。
