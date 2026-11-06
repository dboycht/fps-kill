import type { Action, GameState } from './types.ts';

/**
 * MVP bot：贪心优先级——受伤先用医疗包；能射就射第一个存活对手；否则结束回合。
 * 确定性：同一 state 永远产出同一动作，对局轨迹只由 seed 决定。
 * 进化方向：目标选择策略、留牌策略、配合角色技能的打法。
 */
export function decideAction(state: GameState): Action {
  const self = state.players[state.active - 1];
  if (!self) throw new Error(`玩家不存在：${state.active}`);
  const findCard = (defId: string) => self.hand.find((c) => c.defId === defId);

  if (self.hp < self.maxHp) {
    const tao = findCard('tao');
    if (tao) return { type: 'PLAY_CARD', player: self.id, cardUid: tao.uid };
  }
  if (!state.shotUsed) {
    const sha = findCard('sha');
    const target = state.players.find((p) => p.alive && p.id !== self.id);
    if (sha && target) {
      return { type: 'PLAY_CARD', player: self.id, cardUid: sha.uid, targetId: target.id };
    }
  }
  return { type: 'END_TURN', player: self.id };
}
