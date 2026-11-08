import type {
  Action,
  CardDef,
  CardInstance,
  CharacterDef,
  GameState,
  PlayerId,
  PlayerState,
} from './types.ts';
import { baseDeckInstances, shuffleInstances } from './deck.ts';
import { getSkill } from './skills.ts';
import { rngInt } from './rng.ts';
import {
  attackRangeOf,
  checkGameover,
  dealDamage,
  drawRaw,
  GameError,
  playerOf,
  playerLabel,
  pushLog,
  resolveShaAgainst,
  seatDistance,
} from './core.ts';
import { BASE_CARDS, TRICK_NO_TARGET, TRICK_SELF_TARGET } from './data/cards.ts';
import { CHARACTERS } from './data/characters.ts';

/** 起手手牌张数 */
const HAND_SIZE = 4;
/** 每回合开始摸牌张数 */
const TURN_DRAW = 2;
/** 僵局判定阈值：连续 N 个回合全场体力无变化 → 平局 */
const STALL_LIMIT = 40;
/** 回合上限：到达后按剩余体力判定（高者胜，平则平局） */
const TURN_CAP = 200;

export { GameError } from './core.ts';

export interface NewGameOptions {
  seed: number;
  /** 各玩家的角色 id（显式指定；测试/热座用） */
  characterIds?: string[];
  /** 玩家人数（配合 randomHeroes 随机发将；默认 2） */
  playerCount?: number;
  /** 从全部武将池随机发放武将（同 seed 同结果） */
  randomHeroes?: boolean;
  /** 测试用：空牌堆（配合 initialHands，排除摸牌干扰） */
  emptyDeck?: boolean;
  /** 测试用：直接指定牌堆内容（覆盖标准牌堆） */
  deckOverride?: CardInstance[];
  /** 测试用：直接指定起手手牌（跳过发牌） */
  initialHands?: CardInstance[][];
  /** 测试用：直接指定初始体力 */
  initialHp?: number[];
}

/** 从武将池按 seed 随机抽 N 名（洗牌取前 N，确定性） */
export function pickHeroes(seed: number, count: number): string[] {
  const pool = CHARACTERS.map((c) => c.id);
  const shuff = shuffleInstances(
    pool.map((id, i) => ({ uid: i + 1, defId: id })),
    seed >>> 0,
  );
  return shuff.list.slice(0, count).map((c) => c.defId);
}

export function newGame(options: NewGameOptions): GameState {
  let characterIds: string[];
  if (options.characterIds) {
    characterIds = options.characterIds;
  } else if (options.randomHeroes) {
    characterIds = pickHeroes(options.seed, options.playerCount ?? 2);
  } else {
    characterIds = ['rookie', 'gunner'];
  }
  if (characterIds.length < 2) throw new GameError('至少需要 2 名玩家');

  const cardDefs: Record<string, CardDef> = {};
  for (const def of BASE_CARDS) cardDefs[def.id] = def;
  const characterDefs: Record<string, CharacterDef> = {};
  for (const def of CHARACTERS) characterDefs[def.id] = def;
  for (const cid of characterIds) {
    if (!characterDefs[cid]) throw new GameError(`未知角色：${cid}`);
  }

  let rng = options.seed >>> 0;
  let deck: CardInstance[] = options.deckOverride
    ? options.deckOverride.map((c) => ({ ...c }))
    : options.emptyDeck
      ? []
      : baseDeckInstances();
  const shuff = shuffleInstances(deck, rng);
  deck = shuff.list;
  rng = shuff.rng;

  const players: PlayerState[] = characterIds.map((cid, i) => {
    const def = characterDefs[cid];
    return {
      id: i + 1,
      characterId: cid,
      hp: def.hp,
      maxHp: def.hp,
      hand: [],
      alive: true,
      jiuUsed: false,
      perfectShield: false,
      marks: {},
      skillUsedTurn: {},
      skillUsedRound: {},
      posture: 'back',
      playSealed: false,
    };
  });
  if (options.initialHp) {
    options.initialHp.forEach((hp, i) => {
      if (players[i]) players[i].hp = hp;
    });
  }
  if (options.initialHands) {
    options.initialHands.forEach((hand, i) => {
      if (players[i]) players[i].hand = [...hand];
    });
  } else {
    for (const p of players) {
      for (let k = 0; k < HAND_SIZE; k++) {
        const c = deck.pop();
        if (!c) break;
        p.hand.push(c);
      }
    }
  }

  const state: GameState = {
    version: 1,
    rng,
    cardDefs,
    characterDefs,
    players,
    deck,
    discard: [],
    turn: 1,
    round: 1,
    active: 1,
    roundStartPlayer: 1,
    shaUsed: 0,
    stallTurns: 0,
    lastTotalHp: players.reduce((s, p) => s + p.hp, 0),
    roundFirstDamage: false,
    log: [],
    winner: null,
    over: false,
  };
  pushLog(
    state,
    `对局开始（seed=${options.seed}）：${players
      .map((p) => `${playerLabel(state, p.id)} 体力 ${p.hp}/${p.maxHp}`)
      .join('，')}`,
  );
  drawPhase(state, state.active);
  return state;
}

/** 纯 reducer：输入旧状态 + 动作，返回新状态。对局结束后的动作是无效操作（原样返回）。 */
export function reduce(prev: GameState, action: Action): GameState {
  const state: GameState = structuredClone(prev);
  if (state.over) return state;
  switch (action.type) {
    case 'PLAY_CARD':
      return playCard(state, action);
    case 'END_TURN':
      return endTurn(state, action);
    case 'SKILL':
      return useSkill(state, action);
    default: {
      const unknown: never = action;
      throw new GameError(`未知动作：${JSON.stringify(unknown)}`);
    }
  }
}

// ---------- 主动技 ----------

function useSkill(state: GameState, action: Extract<Action, { type: 'SKILL' }>): GameState {
  assertActive(state, action.player);
  const player = playerOf(state, action.player);
  const skill = getSkill(action.skillId);
  if (!skill || !skill.active || !skill.executeSkill) throw new GameError(`未知技能：${action.skillId}`);
  const used =
    skill.active.oncePer === 'turn' ? player.skillUsedTurn[action.skillId] : player.skillUsedRound[action.skillId];
  if (used) throw new GameError(`【${skill.name}】已用过（${skill.active.oncePer === 'turn' ? '每回合' : '每轮'}限一次）`);
  skill.executeSkill(state, player, action);
  if (skill.active.oncePer === 'turn') player.skillUsedTurn[action.skillId] = true;
  else player.skillUsedRound[action.skillId] = true;
  return state;
}

// ---------- 出牌 ----------

function playCard(state: GameState, action: Extract<Action, { type: 'PLAY_CARD' }>): GameState {
  assertActive(state, action.player);
  const player = playerOf(state, action.player);
  const idx = player.hand.findIndex((c) => c.uid === action.cardUid);
  if (idx < 0) throw new GameError(`玩家${action.player} 手牌中没有 uid=${action.cardUid} 的牌`);
  const card = player.hand[idx];
  const def = state.cardDefs[card.defId];
  if (!def) throw new GameError(`未知牌定义：${card.defId}`);

  if (def.category === 'response') {
    throw new GameError(`[${def.name}]只能在响应「杀」时使用，不能主动打出`);
  }

  if (def.category === 'attack') {
    const limit = shaLimitOf(state, player);
    if (state.shaUsed >= limit) throw new GameError(`本回合已出 ${state.shaUsed} 次[${def.name}]（上限 ${limit}）`);
    if (action.targetId === undefined) throw new GameError(`[${def.name}]需要指定目标`);
    const target = playerOf(state, action.targetId);
    if (target.id === player.id) throw new GameError(`[${def.name}]不能以自己为目标`);
    if (!target.alive) throw new GameError(`[${def.name}]的目标已出局`);
    if (player.playSealed) throw new GameError(`【软脚】封印中，本回合无法对他人造成伤害`);
    player.hand.splice(idx, 1);
    state.discard.push(card);
    // 【酒】壮行：打出杀即消耗（即使被闪抵消），本杀伤害 +1
    let base = 1;
    if (player.jiuUsed) {
      player.jiuUsed = false;
      base += 1;
      pushLog(state, `【酒】壮行：[${def.name}] 伤害 +1`);
    }
    pushLog(state, `${playerLabel(state, player.id)} 打出 [${def.name}] → ${playerLabel(state, target.id)}`);
    resolveShaAgainst(state, player, target, card, { baseAmount: base });
    return state;
  }

  if (def.category === 'instant') {
    player.hand.splice(idx, 1);
    state.discard.push(card);
    playInstant(state, player, def);
    return state;
  }

  if (def.category === 'trick') {
    playTrick(state, player, idx, card, def, action);
    return state;
  }

  // restore
  if (def.category !== 'restore') throw new GameError(`未知牌类别：${def.category}`);
  if (player.hp >= player.maxHp) throw new GameError(`体力已满，[${def.name}]无法使用`);
  player.hand.splice(idx, 1);
  state.discard.push(card);
  const from = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + 1);
  pushLog(state, `${playerLabel(state, player.id)} 使用 [${def.name}]，体力 ${from}→${player.hp}`);
  return state;
}

/** 本回合还可出几张「杀」（1 + 技能加成） */
export function shaLimitOf(state: GameState, player: PlayerState): number {
  let limit = 1;
  for (const sid of state.characterDefs[player.characterId]?.skills ?? []) {
    const skill = getSkill(sid);
    limit += skill?.onShaLimitBonus?.(state, player) ?? 0;
  }
  return limit;
}

function playInstant(state: GameState, player: PlayerState, def: CardDef): void {
  if (def.id === 'jiu') {
    if (player.jiuUsed) throw new GameError(`本回合已用过[${def.name}]（每回合限一次）`);
    player.jiuUsed = true;
    pushLog(state, `${playerLabel(state, player.id)} 使用 [${def.name}]：本回合下一张 [杀] 伤害 +1`);
    return;
  }
  if (def.id === 'power-bank') {
    pushLog(state, `${playerLabel(state, player.id)} 使用 [${def.name}]`);
    drawCards(state, player.id, 1);
    return;
  }
  throw new GameError(`未知 instant 牌：${def.id}`);
}

function playTrick(
  state: GameState,
  player: PlayerState,
  idx: number,
  card: CardInstance,
  def: CardDef,
  action: Extract<Action, { type: 'PLAY_CARD' }>,
): void {
  const target = action.targetId !== undefined ? playerOf(state, action.targetId) : null;
  if (TRICK_NO_TARGET.has(def.id)) {
    player.hand.splice(idx, 1);
    state.discard.push(card);
    resolveDynastyStrike(state, player, def);
    return;
  }
  if (!target) throw new GameError(`[${def.name}]需要指定目标`);
  if (!target.alive) throw new GameError(`[${def.name}]的目标已出局`);
  if (target.id === player.id && !TRICK_SELF_TARGET.has(def.id)) {
    throw new GameError(`[${def.name}]不能以自己为目标`);
  }
  // 拿来吧你：受攻击距离限制
  if (def.id === 'gimme-that') {
    const dist = seatDistance(state, player.id, target.id);
    const range = attackRangeOf(state, player.id);
    if (dist > range) throw new GameError(`[${def.name}]距离 ${dist} 超出攻击范围 ${range}`);
  }
  player.hand.splice(idx, 1);
  state.discard.push(card);
  pushLog(state, `${playerLabel(state, player.id)} 对 ${playerLabel(state, target.id)} 使用 [${def.name}]`);
  if (target.id !== player.id && target.perfectShield) {
    target.perfectShield = false;
    pushLog(state, `${playerLabel(state, target.id)} 的 [完美服务器] 抵消了 [${def.name}]`);
    return;
  }
  switch (def.id) {
    case 'perfect-server': {
      if (target.perfectShield) throw new GameError(`目标已有[${def.name}]的抵消护盾`);
      target.perfectShield = true;
      pushLog(state, `${playerLabel(state, target.id)} 获得 [${def.name}] 护盾：下一次道具牌对其无效`);
      return;
    }
    case 'bullet-eater': {
      const picked = pickRandomHand(state, target);
      if (!picked) {
        pushLog(state, `${playerLabel(state, target.id)} 手牌为空，[${def.name}] 无事发生`);
        return;
      }
      target.hand.splice(picked.index, 1);
      state.discard.push(picked.card);
      pushLog(state, `${playerLabel(state, target.id)} 的 [${cardName(state, picked.card)}] 被丢入弃牌堆`);
      return;
    }
    case 'friendly-tk': {
      const picked = pickRandomHand(state, target);
      if (!picked) {
        pushLog(state, `${playerLabel(state, target.id)} 无牌可弃，受到一点伤害`);
        dealDamage(state, player.id, target.id, 1, def.id);
        return;
      }
      target.hand.splice(picked.index, 1);
      state.discard.push(picked.card);
      pushLog(state, `${playerLabel(state, target.id)} 弃掉了 [${cardName(state, picked.card)}]`);
      return;
    }
    case 'gimme-that': {
      const picked = pickRandomHand(state, target);
      if (!picked) {
        pushLog(state, `${playerLabel(state, target.id)} 手牌为空，[${def.name}] 无事发生`);
        return;
      }
      target.hand.splice(picked.index, 1);
      player.hand.push(picked.card);
      pushLog(state, `${playerLabel(state, player.id)} 拿走了 [${cardName(state, picked.card)}]`);
      return;
    }
    case 'reload-addict': {
      const picked = pickRandomHand(state, target);
      if (!picked) {
        pushLog(state, `${playerLabel(state, target.id)} 无手牌可换弹，受到一点伤害`);
        dealDamage(state, player.id, target.id, 1, def.id);
        return;
      }
      target.hand.splice(picked.index, 1);
      state.discard.push(picked.card);
      pushLog(state, `${playerLabel(state, target.id)} 换弹：弃 [${cardName(state, picked.card)}]`);
      drawCards(state, target.id, 1);
      return;
    }
    case 'mid-door-awp': {
      // 决斗：由接收者（目标）开始交替弃【杀】，无法出者受 1 点伤害
      let cur = target.id;
      let guard = 0;
      for (;;) {
        guard += 1;
        if (guard > 200) throw new GameError('[中门对狙] 结算异常：交替次数超限');
        const curPlayer = playerOf(state, cur);
        const shaIdx = curPlayer.hand.findIndex((c) => c.defId === 'sha');
        if (shaIdx >= 0) {
          const sha = curPlayer.hand.splice(shaIdx, 1)[0];
          state.discard.push(sha);
          pushLog(state, `${playerLabel(state, cur)} 打出 [杀] 应对`);
          cur = cur === target.id ? player.id : target.id;
          continue;
        }
        pushLog(state, `${playerLabel(state, cur)} 无 [杀] 可出`);
        const other = cur === target.id ? player.id : target.id;
        dealDamage(state, other, cur, 1, def.id);
        return;
      }
    }
    default:
      throw new GameError(`未知 trick 牌：${def.id}`);
  }
}

/** 王朝来袭：所有其他玩家——有完美服务器则弃之抵消；否则弃一张【杀】；都没有则无事发生（原文无惩罚条款）。 */
function resolveDynastyStrike(state: GameState, user: PlayerState, def: CardDef): void {
  pushLog(state, `${playerLabel(state, user.id)} 使用 [${def.name}]！`);
  for (const p of state.players) {
    if (!p.alive || p.id === user.id) continue;
    if (p.perfectShield) {
      p.perfectShield = false;
      pushLog(state, `${playerLabel(state, p.id)} 弃 [完美服务器] 抵消了 [王朝来袭]`);
      continue;
    }
    const shaIndexes = p.hand.flatMap((c, i) => (c.defId === 'sha' ? [i] : []));
    if (shaIndexes.length === 0) {
      pushLog(state, `${playerLabel(state, p.id)} 无 [杀] 可弃（原文无惩罚条款），无事发生`);
      continue;
    }
    const pick = rngInt(state.rng, shaIndexes.length);
    state.rng = pick.next;
    const [discarded] = p.hand.splice(shaIndexes[pick.value], 1);
    state.discard.push(discarded);
    pushLog(state, `${playerLabel(state, p.id)} 弃 [${cardName(state, discarded)}] 应对 [王朝来袭]`);
  }
}

/** 从目标手牌中按 rng 随机取一张（不移动，只返回下标与牌） */
function pickRandomHand(state: GameState, target: PlayerState): { index: number; card: CardInstance } | null {
  if (target.hand.length === 0) return null;
  const pick = rngInt(state.rng, target.hand.length);
  state.rng = pick.next;
  return { index: pick.value, card: target.hand[pick.value] };
}

function cardName(state: GameState, card: CardInstance): string {
  return state.cardDefs[card.defId]?.name ?? card.defId;
}

// ---------- 回合与阶段 ----------

function endTurn(state: GameState, action: Extract<Action, { type: 'END_TURN' }>): GameState {
  assertActive(state, action.player);
  const player = playerOf(state, action.player);

  // 弃牌阶段开始：海參回收
  for (const sid of state.characterDefs[player.characterId]?.skills ?? []) {
    getSkill(sid)?.onDiscardStart?.(state, player);
  }

  // 弃牌到上限（= 当前体力 + 技能修正）
  const baseLimit = Math.max(player.hp, 0);
  let limit = baseLimit;
  for (const sid of state.characterDefs[player.characterId]?.skills ?? []) {
    const skill = getSkill(sid);
    const overridden = skill?.onHandLimit?.(state, player, baseLimit);
    if (typeof overridden === 'number') limit = overridden;
  }
  if (player.hand.length > limit) {
    const dropped: string[] = [];
    while (player.hand.length > limit) {
      const c = player.hand.pop();
      if (!c) break;
      state.discard.push(c);
      dropped.push(state.cardDefs[c.defId]?.name ?? c.defId);
    }
    pushLog(state, `${playerLabel(state, player.id)} 弃牌：${dropped.join('、')}（手牌上限 ${limit}）`);
  }

  // 老尼封印在其回合结束解除
  if (player.playSealed) {
    player.playSealed = false;
    pushLog(state, `【软脚】封印解除：${playerLabel(state, player.id)}`);
  }

  const order = state.players.map((p) => p.id);
  const startIdx = order.indexOf(action.player);
  let nextId: PlayerId | null = null;
  for (let k = 1; k <= order.length; k++) {
    const cand = playerOf(state, order[(startIdx + k) % order.length]);
    if (cand.alive) {
      nextId = cand.id;
      break;
    }
  }
  if (nextId === null) {
    checkGameover(state);
    return state;
  }
  state.turn += 1;
  state.active = nextId;
  state.shaUsed = 0;
  const next = playerOf(state, nextId);
  next.jiuUsed = false;
  next.skillUsedTurn = {};
  next.playSealed = false;

  // 轮次推进：回到本轮首个行动者 → 新一轮（清轮限用/轮标记）
  if (nextId === state.roundStartPlayer) {
    state.round += 1;
    state.roundFirstDamage = false;
    state.roundStartPlayer = nextId;
    for (const p of state.players) p.skillUsedRound = {};
    pushLog(state, `—— 第 ${state.round} 轮 ——`);
  }

  drawPhase(state, nextId);

  // 僵局检测：整回合体力总和没变就计数，变了清零
  const totalHp = state.players.reduce((s, p) => s + p.hp, 0);
  if (totalHp === state.lastTotalHp) {
    state.stallTurns += 1;
  } else {
    state.stallTurns = 0;
  }
  state.lastTotalHp = totalHp;
  if (state.stallTurns >= STALL_LIMIT) {
    state.over = true;
    pushLog(state, `连续 ${STALL_LIMIT} 回合体力无变化，判定僵局：平局`);
    return state;
  }
  if (state.turn > TURN_CAP) {
    state.over = true;
    const sorted = [...state.players].sort((a, b) => b.hp - a.hp);
    const tied = sorted.length > 1 && sorted[0].hp === sorted[1].hp;
    state.winner = tied ? null : sorted[0].id;
    pushLog(
      state,
      `达到回合上限（${TURN_CAP}），按剩余体力判定：${
        state.winner !== null ? `${playerLabel(state, state.winner)} 获胜` : '平局'
      }`,
    );
  }
  return state;
}

/** 摸牌阶段：基础 2 + 技能加成；结束后触发 onDrawEnd（身法判定/鹰精） */
function drawPhase(state: GameState, playerId: PlayerId): void {
  const player = playerOf(state, playerId);
  let count = TURN_DRAW;
  for (const sid of state.characterDefs[player.characterId]?.skills ?? []) {
    const skill = getSkill(sid);
    count += skill?.onDrawBonus?.(state, player) ?? 0;
  }
  drawCards(state, playerId, count);
  for (const sid of state.characterDefs[player.characterId]?.skills ?? []) {
    getSkill(sid)?.onDrawEnd?.(state, player);
  }
}

function drawCards(state: GameState, playerId: PlayerId, n: number): void {
  const player = playerOf(state, playerId);
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const c = drawRaw(state);
    if (!c) break;
    player.hand.push(c);
    drawn += 1;
  }
  pushLog(state, `${playerLabel(state, playerId)} 摸 ${drawn} 张牌`);
}

function assertActive(state: GameState, playerId: PlayerId): void {
  if (state.over) throw new GameError('对局已结束');
  if (playerId !== state.active) {
    throw new GameError(`还没轮到玩家${playerId}（当前是玩家${state.active}）`);
  }
}
