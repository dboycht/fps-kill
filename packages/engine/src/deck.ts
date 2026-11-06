import type { CardDef, CardInstance } from './types.ts';
import { rngInt, type RngState } from './rng.ts';

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

/** 按牌定义构建并洗匀牌堆（uid 从 1 递增） */
export function buildDeck(defs: CardDef[], rng: RngState): { deck: CardInstance[]; rng: RngState } {
  const list: CardInstance[] = [];
  let uid = 1;
  for (const def of defs) {
    for (let i = 0; i < def.count; i++) {
      list.push({ uid, defId: def.id });
      uid += 1;
    }
  }
  const shuffled = shuffleInstances(list, rng);
  return { deck: shuffled.list, rng: shuffled.rng };
}
