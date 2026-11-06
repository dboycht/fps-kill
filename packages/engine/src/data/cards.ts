import type { CardDef } from '../types.ts';

/**
 * 基础牌表（杀/闪/桃）。实体牌堆构成见 base-deck.ts（由 scripts/prepare-assets.mjs 从素材生成）。
 * 添加新牌 = 这里加 CardDef + 素材轮备好牌图，category 路由见 reducer.playCard。
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
];
