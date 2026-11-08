import type { Action, GameState } from './types.ts';

/**
 * MVP bot：贪心优先级——
 *   受伤先桃 → 有杀且本回合未出杀时先喝酒 → 充电宝（无杀可打时）→ 拿来吧你（偷牌）→
 *   吞子弹（对手手牌多时拆一张）→ 杀第一个存活对手 → 结束回合。
 * 确定性：同一 state 永远产出同一动作，对局轨迹只由 seed 决定。
 * 进化方向：目标选择策略、留牌策略、配合角色技能的打法、中门对狙博弈。
 */
export function decideAction(state: GameState): Action {
  const self = state.players[state.active - 1];
  if (!self) throw new Error(`玩家不存在：${state.active}`);
  const findCard = (defId: string) => self.hand.find((c) => c.defId === defId);
  const target = state.players.find((p) => p.alive && p.id !== self.id);
  const play = (cardUid: number, targetId?: number): Action => ({
    type: 'PLAY_CARD',
    player: self.id,
    cardUid,
    ...(targetId !== undefined ? { targetId } : {}),
  });

  if (self.hp < self.maxHp) {
    const tao = findCard('tao');
    if (tao) return play(tao.uid);
  }
  const sha = findCard('sha');
  if (sha && !state.shotUsed && !self.jiuUsed && target) {
    const jiu = findCard('jiu');
    if (jiu) return play(jiu.uid); // 先酒后杀：下一动作必是杀，不浪费壮行
  }
  if ((!sha || state.shotUsed) && target) {
    const powerBank = findCard('power-bank');
    if (powerBank) return play(powerBank.uid);
  }
  if (target && target.hand.length > 0) {
    const gimme = findCard('gimme-that');
    if (gimme) return play(gimme.uid, target.id);
    const eater = findCard('bullet-eater');
    if (eater && target.hand.length > 2) return play(eater.uid, target.id);
  }
  if (sha && !state.shotUsed && target) {
    return play(sha.uid, target.id);
  }
  return { type: 'END_TURN', player: self.id };
}
