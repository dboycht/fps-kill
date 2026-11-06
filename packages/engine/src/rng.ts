/**
 * 可注入、可序列化的确定性随机数（mulberry32）。
 * 状态就是单个数字，直接存进 GameState，天然可重放。
 */

export type RngState = number;

/** 返回一个 [0, 1) 随机数和新的 RNG 状态 */
export function rngNext(state: RngState): { value: number; next: RngState } {
  let t = (state + 0x6d2b79f5) >>> 0;
  let u = t;
  u = Math.imul(u ^ (u >>> 15), u | 1);
  u ^= u + Math.imul(u ^ (u >>> 7), u | 61);
  const value = ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  return { value, next: t };
}

/** 返回一个 [0, bound) 整数和新的 RNG 状态 */
export function rngInt(state: RngState, bound: number): { value: number; next: RngState } {
  if (!Number.isInteger(bound) || bound <= 0) throw new Error(`rngInt 边界非法：${bound}`);
  const r = rngNext(state);
  return { value: Math.floor(r.value * bound), next: r.next };
}
