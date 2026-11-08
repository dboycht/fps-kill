import type { Action, GameState, PlayerState } from './types.ts';
import { attackRangeOf, seatDistance } from './core.ts';
import { shaLimitOf } from './reducer.ts';

/**
 * MVP bot：贪心优先级——
 *   受伤先桃 → 有杀且还有出杀次数时先喝酒 → 充电宝（无杀可打时）→ 拿来吧你（偷牌）→
 *   吞子弹（对手手牌多时拆一张）→ 杀攻击范围内最近的对手 → 结束回合。
 * 确定性：同一 state 永远产出同一动作，对局轨迹只由 seed 决定。
 * 进化方向：目标选择策略、留牌策略、配合角色技能的打法、主动技使用、中门对狙博弈。
 */
export function decideAction(state: GameState): Action {
  const self = state.players[state.active - 1];
  if (!self) throw new Error(`玩家不存在：${state.active}`);
  const findCard = (defId: string) => self.hand.find((c) => c.defId === defId);
  const play = (cardUid: number, targetId?: number): Action => ({
    type: 'PLAY_CARD',
    player: self.id,
    cardUid,
    ...(targetId !== undefined ? { targetId } : {}),
  });

  // 攻击范围内最近的存活对手（多人局下按环形距离）
  const inRange = state.players
    .filter((p) => p.alive && p.id !== self.id)
    .map((p) => ({ p, dist: seatDistance(state, self.id, p.id) }))
    .filter(({ dist }) => dist <= attackRangeOf(state, self.id))
    .sort((a, b) => a.dist - b.dist || a.p.id - b.p.id);
  const target: PlayerState | undefined = inRange[0]?.p;

  if (self.hp < self.maxHp) {
    const tao = findCard('tao');
    if (tao) return play(tao.uid);
  }
  const sha = findCard('sha');
  const canSha = sha !== undefined && state.shaUsed < shaLimitOf(state, self);
  if (sha && canSha && !self.jiuUsed && target) {
    const jiu = findCard('jiu');
    if (jiu) return play(jiu.uid); // 先酒后杀：下一动作必是杀，不浪费壮行
  }
  if ((!sha || !canSha) && target) {
    const powerBank = findCard('power-bank');
    if (powerBank) return play(powerBank.uid);
  }
  if (target && target.hand.length > 0) {
    const gimme = findCard('gimme-that');
    if (gimme) return play(gimme.uid, target.id);
    const eater = findCard('bullet-eater');
    if (eater && target.hand.length > 2) return play(eater.uid, target.id);
  }
  if (sha && canSha && target) {
    return play(sha.uid, target.id);
  }
  return { type: 'END_TURN', player: self.id };
}

