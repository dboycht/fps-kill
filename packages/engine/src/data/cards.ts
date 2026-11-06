import type { CardDef } from '../types.ts';

/**
 * 基础牌表（MVP 三件套）。添加新牌 = 在这里加一个 CardDef，
 * 并确认 reducer 的 playCard 对该 category 有路由（attack/restore 已内置）。
 */
export const BASE_CARDS: CardDef[] = [
  {
    id: 'shoot',
    name: '射击',
    category: 'attack',
    desc: '出牌阶段对另一名角色使用，造成 1 点伤害（每回合限一次）；对方若有「闪避」则自动抵消。',
    count: 12,
  },
  {
    id: 'dodge',
    name: '闪避',
    category: 'response',
    desc: '抵消一次「射击」。',
    count: 9,
  },
  {
    id: 'medkit',
    name: '医疗包',
    category: 'restore',
    desc: '出牌阶段对自己使用，回复 1 点体力（不超过上限）。',
    count: 6,
  },
];
