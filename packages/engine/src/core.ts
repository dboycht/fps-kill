/**
 * 引擎内部共享原语：错误、日志、玩家存取、牌堆顶判定、环形距离、通用伤害与「杀」结算。
 * 独立成模块以避免 reducer ↔ characters 的 ESM 循环依赖。
 */

import type { CardInstance, GameState, PlayerId, PlayerState } from './types.ts';
import { getSkill } from './skills.ts';
import { shuffleInstances } from './deck.ts';

export class GameError extends Error {}

/** 红色花色（判定/育婴/锁头用） */
export function isRed(card: CardInstance): boolean {
  return card.suit === 'heart' || card.suit === 'diamond';
}

export function pushLog(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, text });
}

export function playerOf(state: GameState, id: PlayerId): PlayerState {
  const p = state.players[id - 1];
  if (!p) throw new GameError(`玩家不存在：${id}`);
  return p;
}

export function playerLabel(state: GameState, id: PlayerId): string {
  const p = playerOf(state, id);
  return `玩家${p.id}(${state.characterDefs[p.characterId].name})`;
}

/** 牌堆顶摸一张（空则重洗弃牌堆）；判定/摸牌共用 */
export function drawRaw(state: GameState): CardInstance | null {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    const shuffled = shuffleInstances(state.discard, state.rng);
    state.deck = shuffled.list;
    state.rng = shuffled.rng;
    pushLog(state, `牌堆已空，弃牌堆 ${state.discard.length} 张重洗`);
    state.discard = [];
  }
  return state.deck.pop() ?? null;
}

/** 牌顶判定：翻一张牌进弃牌堆并返回 */
export function judgeTop(state: GameState): CardInstance {
  const card = drawRaw(state);
  if (!card) throw new GameError('牌堆与弃牌堆均为空，无法判定');
  state.discard.push(card);
  return card;
}

/**
 * 环形距离（大纲 §距离）：沿座位序两侧逼近取最小，跳过已出局玩家。
 * 相邻存活玩家距离 1；自身为 0。
 */
export function seatDistance(state: GameState, fromId: PlayerId, toId: PlayerId): number {
  if (fromId === toId) return 0;
  const ring = state.players.filter((p) => p.alive).map((p) => p.id);
  const from = ring.indexOf(fromId);
  const to = ring.indexOf(toId);
  if (from < 0 || to < 0) throw new GameError('距离计算包含出局玩家');
  const n = ring.length;
  return Math.min(Math.abs(to - from), n - Math.abs(to - from));
}

function skillsOf(state: GameState, p: PlayerState): string[] {
  return state.characterDefs[p.characterId]?.skills ?? [];
}

function rangeBonusOf(state: GameState, source: PlayerState): number {
  let bonus = 0;
  for (const sid of skillsOf(state, source)) {
    const skill = getSkill(sid);
    if (skill?.attackRangeBonus) bonus += skill.attackRangeBonus;
  }
  return bonus;
}

/** 攻击距离（含技能加成）：校验与 UI 共用 */
export function attackRangeOf(state: GameState, playerId: PlayerId): number {
  return 1 + rangeBonusOf(state, playerOf(state, playerId));
}

export interface ShaResolveOptions {
  /** 无视距离（快枪/闪电/豪情追加） */
  ignoreDistance?: boolean;
  /** 不计入本回合出杀次数 */
  noCount?: boolean;
  /** 基础伤害（酒已折入） */
  baseAmount?: number;
}

/**
 * 通用「杀」结算：距离校验 → 锁头（红杀不可抵消）→ 闪抵消（僵尸/背身判定钩）→ dealDamage。
 * 普通杀与技能追加杀共用。
 */
export function resolveShaAgainst(
  state: GameState,
  source: PlayerState,
  target: PlayerState,
  card: CardInstance,
  opts: ShaResolveOptions = {},
): void {
  if (!opts.ignoreDistance) {
    const range = 1 + rangeBonusOf(state, source);
    const dist = seatDistance(state, source.id, target.id);
    if (dist > range) throw new GameError(`距离 ${dist} 超出攻击范围 ${range}，无法出「杀」`);
  }
  if (!opts.noCount) state.shaUsed += 1;

  let blockable = true;
  for (const sid of skillsOf(state, source)) {
    const skill = getSkill(sid);
    if (skill?.onShaUnblockable?.(state, source, card)) {
      blockable = false;
      pushLog(state, `【${skill.name}】发动：[杀] 不可被抵消`);
    }
  }
  if (blockable) {
    const dodge = target.hand.find((c) => state.cardDefs[c.defId]?.category === 'response');
    if (dodge) {
      let dodgeOk = true;
      for (const sid of skillsOf(state, target)) {
        const skill = getSkill(sid);
        if (skill?.onDodgeCheck && !skill.onDodgeCheck(state, target)) dodgeOk = false;
      }
      if (dodgeOk) {
        target.hand.splice(target.hand.indexOf(dodge), 1);
        state.discard.push(dodge);
        pushLog(state, `${playerLabel(state, target.id)} 打出 [${state.cardDefs[dodge.defId].name}]，抵消了伤害`);
        return;
      }
      pushLog(state, `${playerLabel(state, target.id)} 的 [闪] 无效`);
    }
  }

  let amount = opts.baseAmount ?? 1;
  for (const sid of skillsOf(state, source)) {
    const skill = getSkill(sid);
    if (!skill) continue;
    const delta =
      skill.onModifyDamage?.({ source: source.id, target: target.id, cardId: card.defId, amount }, state) ?? null;
    if (delta) {
      amount += delta;
      pushLog(state, `【${skill.name}】触发：伤害 +${delta}`);
    }
  }
  dealDamage(state, source.id, target.id, amount, card.defId);
}

/**
 * 通用伤害入口：
 *   目标侧 软脚背身免疫 → 受伤修正（车主·正面）→ 扣体力 → 软枪不致死（大表猪）→ 死亡/终局
 *   → onDamaged（火仔芯片+回满 / 老尼软脚基因）→ onDamageDealt（海參/豪情/就很/突破/甩狙）。
 * cardId 传 null 表示非牌类伤害；来源侧 onModifyDamage 在「杀」结算内已折算，不在此重复。
 */
export function dealDamage(
  state: GameState,
  sourceId: PlayerId,
  targetId: PlayerId,
  baseAmount: number,
  cardId: string | null,
): void {
  if (state.over) return;
  const target = playerOf(state, targetId);
  if (!target.alive) return;
  const source = playerOf(state, sourceId);
  let amount = baseAmount;

  // 来源侧封印：小孩·海参（≥3 碎片无法造成伤害）/ 老尼·软脚封印（不伤他人）
  if (source.id !== targetId) {
    if (skillsOf(state, source).includes('haishen') && (source.marks['haishen'] ?? 0) >= 3) {
      pushLog(state, `【海参】${playerLabel(state, source.id)} 碎片已满 3，本回合无法造成伤害`);
      return;
    }
    if (source.playSealed) {
      pushLog(state, `【软脚】${playerLabel(state, source.id)} 出牌被封印，无法对他人造成伤害`);
      return;
    }
  }

  if (skillsOf(state, target).includes('ruanjiao_back') && target.posture === 'back') {
    pushLog(state, `【软脚】${playerLabel(state, target.id)} 处于背身，免疫伤害`);
    return;
  }
  for (const sid of skillsOf(state, target)) {
    const skill = getSkill(sid);
    if (!skill?.onIncomingDamageModify) continue;
    const modified = skill.onIncomingDamageModify(state, target, amount);
    if (typeof modified === 'number' && modified !== amount) {
      pushLog(state, `【${skill.name}】受到的伤害 ${amount}→${modified}`);
      amount = modified;
    }
  }

  const from = target.hp;
  target.hp -= amount;
  pushLog(state, `${playerLabel(state, targetId)} 受到 ${amount} 点伤害，体力 ${from}→${target.hp}`);
  if (target.hp <= 0) {
    const softgun = skillsOf(state, source).includes('ruanqiang');
    const alive = state.players.filter((p) => p.alive).length;
    if (softgun && alive > 2 && from >= 1) {
      target.hp = 1;
      pushLog(state, `【软枪】${playerLabel(state, targetId)} 体力锁定为 1（不致死）`);
    } else {
      target.hp = 0;
      target.alive = false;
      pushLog(state, `${playerLabel(state, targetId)} 出局！`);
    }
  }

  const ctx = { source: sourceId, target: targetId, cardId, amount };
  for (const sid of skillsOf(state, target)) {
    getSkill(sid)?.onDamaged?.(state, target, ctx);
  }
  for (const sid of skillsOf(state, source)) {
    getSkill(sid)?.onDamageDealt?.(state, source, ctx);
  }
  if (!target.alive) {
    checkGameover(state);
  }
}

export function checkGameover(state: GameState): void {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.winner = alive[0]?.id ?? null;
    state.over = true;
    pushLog(state, `对局结束：${state.winner !== null ? `${playerLabel(state, state.winner)} 获胜` : '无胜者'}，共 ${state.turn} 回合`);
  }
}
