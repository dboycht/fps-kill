import type { CardDef } from '../types.ts';

/**
 * 基础牌表。实体牌堆构成见 base-deck.ts（由 scripts/prepare-assets.mjs 从素材生成）。
 * 添加新牌 = 这里加 CardDef + 素材轮备好牌图，category 路由见 reducer.playCard。
 *
 * 类别：attack 杀 / response 闪 / restore 桃 / instant 无目标自用 / trick 需指定目标（dynasty-strike 除外，全场生效）。
 * 效果文本转录自用户牌面图；牌面无文字或语义有歧义处标【解释稿】，见 DEVELOPMENT.md「新牌解释稿」。
 */
export const BASE_CARDS: CardDef[] = [
  {
    id: 'sha',
    name: '杀',
    category: 'attack',
    desc: '出牌阶段对另一名角色使用，造成 1 点伤害（每回合限一次）；对方若有「闪」则自动抵消。',
  },
  {
    id: 'shan',
    name: '闪',
    category: 'response',
    desc: '抵消一次「杀」。',
  },
  {
    id: 'tao',
    name: '桃',
    category: 'restore',
    desc: '出牌阶段对自己使用，回复 1 点体力（不超过上限）。',
  },
  {
    id: 'jiu',
    name: '酒',
    category: 'instant',
    desc: '出牌阶段对自己使用：本回合下一张「杀」伤害 +1（每回合限一次）。〔牌面无文字，采用三国杀通行规则，待确认〕',
  },
  {
    id: 'power-bank',
    name: '充电宝',
    category: 'instant',
    desc: '◆锁定技，使用该牌后自己可以从牌堆顶摸取一张牌。',
  },
  {
    id: 'perfect-server',
    name: '完美服务器',
    category: 'trick',
    desc: '◆锁定技，指定一名玩家使用该牌可以抵消一次道具牌。',
  },
  {
    id: 'bullet-eater',
    name: '吞子弹',
    category: 'trick',
    desc: '◆锁定技，指定一名玩家使用该牌，可以将其装备区/手牌区的牌目丢入弃牌堆。〔装备区未实装，现弃其一张手牌〕',
  },
  {
    id: 'mid-door-awp',
    name: '中门对狙',
    category: 'trick',
    desc: '◆锁定技，对一名其他玩家使用后由接收者开始交替出「杀」，若一方无法出「杀」则受到一点伤害。',
  },
  {
    id: 'friendly-tk',
    name: '善意TK',
    category: 'trick',
    desc: '◆锁定技，可以令一名玩家丢弃装备区或手牌区一张牌并对另一名玩家造成伤害，若无法丢弃则该玩家的角色受到一点伤害。〔2 人局无第三者，伤害部分多人轮再议〕',
  },
  {
    id: 'gimme-that',
    name: '拿来吧你',
    category: 'trick',
    desc: '◆锁定技，对一名其他玩家使用后可以获取其装备区或手牌区的一张牌，该牌受攻击距离限制。〔装备区未实装，现拿其一张手牌；距离系统未实装，2 人局恒可及〕',
  },
  {
    id: 'reload-addict',
    name: '换弹癌',
    category: 'trick',
    desc: '◆锁定技，对一名玩家使用，该玩家丢弃一张手牌并从牌顶摸取一张牌，若无手牌则受到一点伤害。',
  },
  {
    id: 'dynasty-strike',
    name: '王朝来袭',
    category: 'trick',
    desc: '◆锁定技，所有其他玩家丢弃一张「杀」，也可丢弃「完美伺服」。〔原文无惩罚条款，照文实装：无「杀」也无「完美服务器」者无事发生〕',
  },
];

/** trick 里允许以自己为目标的牌 */
export const TRICK_SELF_TARGET: ReadonlySet<string> = new Set(['perfect-server', 'reload-addict']);
/** trick 里无需指定目标（全场生效）的牌 */
export const TRICK_NO_TARGET: ReadonlySet<string> = new Set(['dynasty-strike']);
