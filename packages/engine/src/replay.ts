import { newGame, reduce } from './reducer.ts';
import { decideAction } from './ai.ts';
import type { GameState } from './types.ts';

export interface BattleResult {
  final: GameState;
  steps: number;
}

/** 从 seed 跑一整局 bot 自动对局，直到结束（胜负或僵局平局；确定性：同 seed 同轨迹）。 */
export function runBattle(seed: number, maxSteps = 2000): BattleResult {
  let state = newGame({ seed });
  let steps = 0;
  while (!state.over) {
    if (steps >= maxSteps) {
      throw new Error(`对局超过 ${maxSteps} 步未结束（seed=${seed}），疑似停滞`);
    }
    state = reduce(state, decideAction(state));
    steps += 1;
  }
  return { final: state, steps };
}

/** 把对局日志渲染成人类可读文本 */
export function renderLog(state: GameState): string {
  return state.log.map((e) => `T${e.turn}  ${e.text}`).join('\n') + '\n';
}
