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

export class GameError extends Error {}

export interface NewGameOptions {
  seed: number;
  /** 各玩家的角色 id，默认 ['rookie', 'gunner'] */
  characterIds?: string[];
  /** 测试用：空牌堆（配合 initialHands，排除摸牌干扰） */
  emptyDeck?: boolean;
  /** 测试用：直接指定牌堆内容（覆盖标准牌堆） */
  deckOverride?: CardInstance[];
  /** 测试用：直接指定起手手牌（跳过发牌） */
  initialHands?: CardInstance[][];
  /** 测试用：直接指定初始体力 */
  initialHp?: number[];
}

export function newGame(options: NewGameOptions): GameState {
  const characterIds = options.characterIds ?? ['rookie', 'gunner'];
  if (characterIds.length < 2) throw new GameError('至少需要 2 名玩家');

  const cardDefs: Record<string, CardDef> = {};
  for (const def of BASE_CARDS) cardDefs[def.id] = def;
  const characterDefs: Record<string, CharacterDef> = {};
  for (const def of CHARACTERS) characterDefs[def.id] = def;

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
    if (!def) throw new GameError(`未知角色：${cid}`);
    return {
      id: i + 1,
      characterId: cid,
      hp: def.hp,
      maxHp: def.hp,
      hand: [],
      alive: true,
      jiuUsed: false,
      perfectShield: false,
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
    active: 1,
    shotUsed: false,
    stallTurns: 0,
    lastTotalHp: players.reduce((s, p) => s + p.hp, 0),
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
  drawCards(state, state.active, TURN_DRAW);
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
    default: {
      const unknown: never = action;
      throw new GameError(`未知动作：${JSON.stringify(unknown)}`);
    }
  }
}

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
    if (state.shotUsed) throw new GameError(`本回合已用过[${def.name}]（每回合限一次）`);
    if (action.targetId === undefined) throw new GameError(`[${def.name}]需要指定目标`);
    const target = playerOf(state, action.targetId);
    if (target.id === player.id) throw new GameError(`[${def.name}]不能以自己为目标`);
    if (!target.alive) throw new GameError(`[${def.name}]的目标已出局`);
    player.hand.splice(idx, 1);
    state.discard.push(card);
    state.shotUsed = true;
    // 【酒】壮行：打出杀即消耗（即使被闪抵消），本杀伤害 +1
    let base = 1;
    if (player.jiuUsed) {
      player.jiuUsed = false;
      base += 1;
      pushLog(state, `【酒】壮行：[${def.name}] 伤害 +1`);
    }
    pushLog(state, `${playerLabel(state, player.id)} 打出 [${def.name}] → ${playerLabel(state, target.id)}`);
    resolveAttack(state, player.id, target.id, card, base);
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

/** MVP 简化：防守方若有「闪避」则自动打出抵消；没有响应窗。baseAmount = 基础伤害（酒已折入）。 */
function resolveAttack(
  state: GameState,
  sourceId: PlayerId,
  targetId: PlayerId,
  card: CardInstance,
  baseAmount: number,
): void {
  const target = playerOf(state, targetId);
  const dodgeIdx = target.hand.findIndex((c) => state.cardDefs[c.defId]?.category === 'response');
  if (dodgeIdx >= 0) {
    const dodge = target.hand[dodgeIdx];
    target.hand.splice(dodgeIdx, 1);
    state.discard.push(dodge);
    pushLog(state, `${playerLabel(state, target.id)} 打出 [${state.cardDefs[dodge.defId].name}]，抵消了伤害`);
    return;
  }
  dealDamage(state, sourceId, targetId, baseAmount, card.defId);
}

/**
 * 通用伤害入口：酒不在其中（杀的酒加成已在出牌时折入 baseAmount）；
 * 角色技能钩子按 cardId 匹配（非「杀」来源的伤害不受火力全开加成）。
 */
function dealDamage(
  state: GameState,
  sourceId: PlayerId,
  targetId: PlayerId,
  baseAmount: number,
  cardId: string,
): void {
  const target = playerOf(state, targetId);
  const source = playerOf(state, sourceId);
  let amount = baseAmount;
  for (const skillId of state.characterDefs[source.characterId].skills) {
    const skill = getSkill(skillId);
    if (!skill) continue;
    const delta = skill.onModifyDamage?.({ source: sourceId, target: targetId, cardId, amount }, state) ?? null;
    if (delta) {
      amount += delta;
      pushLog(state, `【${skill.name}】触发：伤害 +${delta}`);
    }
  }
  const from = target.hp;
  target.hp -= amount;
  pushLog(state, `${playerLabel(state, targetId)} 受到 ${amount} 点伤害，体力 ${from}→${target.hp}`);
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    pushLog(state, `${playerLabel(state, targetId)} 出局！`);
    checkGameover(state);
  }
}

// ---------- instant / trick ----------

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
    // 全场生效（王朝来袭）
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

function endTurn(state: GameState, action: Extract<Action, { type: 'END_TURN' }>): GameState {
  assertActive(state, action.player);
  const player = playerOf(state, action.player);

  const limit = Math.max(player.hp, 0);
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
  state.shotUsed = false;
  playerOf(state, nextId).jiuUsed = false;
  drawCards(state, nextId, TURN_DRAW);

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

function checkGameover(state: GameState): void {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.winner = alive[0]?.id ?? null;
    state.over = true;
    pushLog(state, `对局结束：${state.winner !== null ? `${playerLabel(state, state.winner)} 获胜` : '无胜者'}，共 ${state.turn} 回合`);
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

function drawRaw(state: GameState): CardInstance | null {
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

function assertActive(state: GameState, playerId: PlayerId): void {
  if (state.over) throw new GameError('对局已结束');
  if (playerId !== state.active) {
    throw new GameError(`还没轮到玩家${playerId}（当前是玩家${state.active}）`);
  }
}

function playerOf(state: GameState, id: PlayerId): PlayerState {
  const p = state.players[id - 1];
  if (!p) throw new GameError(`玩家不存在：${id}`);
  return p;
}

export function playerLabel(state: GameState, id: PlayerId): string {
  const p = playerOf(state, id);
  return `玩家${p.id}(${state.characterDefs[p.characterId].name})`;
}

function pushLog(state: GameState, text: string): void {
  state.log.push({ turn: state.turn, text });
}
