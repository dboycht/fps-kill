# FPS杀

FPS 题材的类三国杀卡牌对战游戏。设计目标：**高度可进化**——每张角色卡、每个技能都通过「自然语言描述 → AI 添加机制」的方式逐步加入。

## 当前状态

- **规则引擎**（`packages/engine`）：杀/闪/桃 + 九种技能牌（酒、充电宝、完美服务器、吞子弹、中门对狙、善意TK、拿来吧你、换弹癌、王朝来袭）+ 花色点数实体牌堆（98 张，来自真实素材）+ 技能钩子注册表 + 僵局/回合上限终局判定 + bot 自动对局与回放。39 项单测全绿；300 局扫描全部真实分出胜负、平均 17.6 回合。
- **热座页面**（`apps/web`）：牌桌对战（出牌/结算/Bot 代打/终局弹层）+ 图鉴（缩略图秒开、点击看 2.3MB 大图；98 张手牌、12 张武将立绘、6 件装备）。5 件武器的效果文本已收录，等装备区/判定/距离框架。
- **联机**（`apps/server` + web 联机模式）：mkx-link 权威 reducer 房间，一个端口 = 中继 + 对局房间 + 游戏页托管；落座/开局/Bot 代打/断线重连保座位。详见下文「联机」。

## 运行

```bash
pnpm install
pnpm verify        # 类型检查（引擎+web+server）+ 39 项单测
pnpm demo          # 3 局 bot 自动对局，回放写入 logs/demo/
pnpm web:dev       # 热座页面 http://localhost:5173
```

## 联机

一个进程搞定（中继 + 权威对局房间 + 静态托管游戏页）：

```bash
pnpm web:build     # 首次或改过前端后
pnpm server        # 默认 0.0.0.0:7000，可 --port/--host
```

- 局域网玩家开 `http://<主机IP>:7000/` → 顶栏「联机」→ 连接（服务器留空 = 本页同源）→ 落座 → 任一落座者点「开始对局」。
- 断线重连自动恢复局面与座位（同一浏览器会话内）。
- ⚠️ **手牌为荣誉制**：服务器全量快照广播，DevTools 能看到对手手牌；防偷看（裁判制）留待后续。
- 外网联机：给中继套隧道（ngrok / frp / Cloudflare Tunnel / tailscale funnel），玩法见 mkx-link 仓库 `docs/TUNNELING.md`。
- 服务器无持久化：进程重启即清房（重新落座开局即可）。
- v1 为单房间（一个服务器一盘对局）；3+ 人局、观战、房间密码未做。

素材重建（需本机素材备份）：`node scripts/prepare-assets.mjs <素材目录>`

## 技术栈

TypeScript（原生 ESM，Node ≥ 22.15，直跑 .ts 源码）· pnpm monorepo · Vite + DOM/CSS ·
联机 = mkx-link（本地 `link:` 依赖）· 规划中：Tauri 2 桌面壳。

## 许可

CC-BY-NC-4.0，Copyright (c) Mizuki，见 `LICENSE`。
