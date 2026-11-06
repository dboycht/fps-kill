import type { CardInstance } from './types.ts';
import { rngInt, type RngState } from './rng.ts';
import { BASE_DECK, type DeckSpec } from './data/base-deck.ts';

/** Fisher-Yates 洗牌：不改原数组，返回新数组与新的 RNG 状态 */
export function shuffleInstances<T>(list: T[], rng: RngState): { list: T[]; rng: RngState } {
  const arr = [...list];
  let s = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const r = rngInt(s, i + 1);
    s = r.next;
    const j = r.value;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return { list: arr, rng: s };
}

/** 按实体牌堆规格生成带 uid 的牌实例（uid 从 1 递增，按规格顺序） */
export function makeInstances(specs: DeckSpec[]): CardInstance[] {
  return specs.map((s, i) => ({ uid: i + 1, defId: s.defId, suit: s.suit, rank: s.rank }));
}

/** 标准牌堆（47 张：杀19 闪20 桃8），uid 固定，进场后再洗 */
export function baseDeckInstances(): CardInstance[] {
  return makeInstances(BASE_DECK);
}
