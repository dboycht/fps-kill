/**
 * 权威对局房间：mkx-link `ReducerRoomDefinition<RoomState>`（多人版）。
 *
 * 语义（accepts 白名单）：
 * - game.sit     落座（取最小空位；已落座则幂等并更新昵称；满员拒绝；首个落座者成为房主）
 * - game.config  房主在 lobby 配置人数（2..8，不得小于已落座数）
 * - game.start   房主开局（全部座位有人；带 seed 则用之；随机发放武将）
 * - game.action  出牌/结束回合（发送者必须是当前 active 座位；引擎 GameError ⇒ 拒绝）
 * - game.skill   主动技（同 game.action 的座位门控；负载 {skillId, cardUid?, targetId?}）
 * - game.bot     当前座位请求 Bot 代打本回合（服务器一次跑完，规避消息限速）
 * - game.restart 房主重开一局（两座以上有人且不在 lobby；带 seed 则用之）
 * - game.reset   重置房间回 lobby（清座位与对局；任何人都可发，用于房主离开后回收）
 *
 * 拒绝 = 返回 undefined：发送者收到 error 帧，房间内无人看到任何变化。
 */

import {
  GameError,
  decideAction,
  emptyRoomState,
  newGame,
  reduce,
  seatOfPeer,
  seatsFull,
  clampCapacity,
  normalizeSeats,
  seatedCount,
  type Action,
  type GameCommandType,
  type GameState,
  type RoomState,
  type Seat,
} from '@fpskill/engine';
import type { ApplicationMessage, ReducerContext, ReducerRoomDefinition } from '@mkx/core';

export const GAME_ROOM = 'fpskill';

export const GAME_COMMANDS: readonly GameCommandType[] = [
  'game.sit',
  'game.config',
  'game.start',
  'game.action',
  'game.skill',
  'game.bot',
  'game.restart',
  'game.reset',
];

const MAX_NAME_LENGTH = 24;
const BOT_GUARD = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 线上 data 收窄成昵称；无有效昵称返回 null。 */
function parseName(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const name = data.name;
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed === '' ? null : trimmed.slice(0, MAX_NAME_LENGTH);
}

/** 线上 data 收窄成 seed；无有效 seed 返回 null。 */
export function parseSeed(data: unknown): number | null {
  if (!isRecord(data)) return null;
  const seed = data.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 1 || !Number.isSafeInteger(seed)) {
    return null;
  }
  return seed;
}

/** 线上 data 收窄成 Action（出牌/结束回合/主动技）；形状不对返回 null。
 *  player 允许缺省（客户端无需自知座位）：服务器盖章为发送者座位后才交给引擎。 */
export function parseAction(data: unknown): Action | null {
  if (!isRecord(data)) return null;
  const inner = isRecord(data.action) ? data.action : data;
  const hasPlayer = typeof inner.player === 'number' && Number.isInteger(inner.player);
  const player = hasPlayer ? (inner.player as number) : 0;
  if (inner.type === 'END_TURN') return { type: 'END_TURN', player };
  if (inner.type === 'SKILL') {
    const skillId = inner.skillId;
    if (typeof skillId !== 'string' || skillId.length === 0 || skillId.length > 64) return null;
    const cardUid = inner.cardUid;
    const targetId = inner.targetId;
    return {
      type: 'SKILL',
      player,
      skillId,
      ...(typeof cardUid === 'number' && Number.isInteger(cardUid) ? { cardUid } : {}),
      ...(typeof targetId === 'number' && Number.isInteger(targetId) ? { targetId } : {}),
    };
  }
  if (inner.type === 'PLAY_CARD') {
    const cardUid = inner.cardUid;
    if (typeof cardUid !== 'number' || !Number.isInteger(cardUid)) return null;
    const targetId = inner.targetId;
    const action: Action = {
      type: 'PLAY_CARD',
      player,
      cardUid,
      ...(typeof targetId === 'number' && Number.isInteger(targetId) ? { targetId } : {}),
    };
    return action;
  }
  return null;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 90000) + 1000;
}

function startMatch(state: RoomState, seed: number): RoomState {
  // 随机发放武将：从全部武将池按 seed 抽 capacity 名
  return {
    ...state,
    phase: 'playing',
    seed,
    game: newGame({ seed, playerCount: state.capacity, randomHeroes: true }),
  };
}

function settlePhase(state: RoomState, game: GameState): RoomState {
  return { ...state, phase: game.over ? 'over' : 'playing', game };
}

/** 跑完当前座位的一整个 Bot 回合；game 必须存在且未结束。 */
export function runBotTurn(game: GameState, seat: Seat): GameState {
  let guard = 0;
  let current = game;
  while (!current.over && current.active === seat && guard < BOT_GUARD) {
    current = reduce(current, decideAction(current));
    guard += 1;
  }
  return current;
}

export function reduceRoom(
  state: RoomState,
  msg: ApplicationMessage,
  ctx: ReducerContext,
): RoomState | undefined {
  const key = peerKey(ctx);
  switch (msg.type as GameCommandType | string) {
    case 'game.sit': {
      const existing = seatOfPeer(state, key);
      if (existing !== null) {
        const name = parseName(msg.data) ?? state.names[existing] ?? `玩家${existing}`;
        return { ...state, names: { ...state.names, [existing]: name } };
      }
      const seat = firstFreeSeat(state);
      if (seat === null) return undefined; // 满员
      const name = parseName(msg.data) ?? `玩家${seat}`;
      return {
        ...state,
        hostPeer: state.hostPeer ?? key,
        seats: { ...state.seats, [seat]: key },
        names: { ...state.names, [seat]: name },
      };
    }
    case 'game.config': {
      if (state.phase !== 'lobby' || state.hostPeer !== key) return undefined;
      const capacity = clampCapacity(isRecord(msg.data) ? msg.data.capacity : undefined);
      if (capacity < seatedCount(state)) return undefined;
      return normalizeSeats({ ...state, capacity });
    }
    case 'game.start': {
      if (state.phase !== 'lobby' || state.hostPeer !== key || !seatsFull(state)) return undefined;
      return startMatch(state, parseSeed(msg.data) ?? randomSeed());
    }
    case 'game.restart': {
      if (state.phase === 'lobby' || state.hostPeer !== key || seatedCount(state) < 2) return undefined;
      return startMatch(state, parseSeed(msg.data) ?? randomSeed());
    }
    case 'game.action':
    case 'game.skill': {
      if (state.game === null || state.game.over) return undefined;
      const seat = seatOfPeer(state, key);
      if (seat === null || state.game.active !== seat) return undefined;
      const action = parseAction(msg.data);
      if (action === null) return undefined;
      action.player = seat; // 服务器权威：动作归属 = 发送者座位，客户端声明一律无视
      if (msg.type === 'game.skill' && action.type !== 'SKILL') return undefined;
      if (msg.type === 'game.action' && action.type === 'SKILL') return undefined;
      try {
        const game = reduce(state.game, action);
        return settlePhase(state, game);
      } catch (error) {
        if (error instanceof GameError) return undefined; // 非法动作：仅发送者收到 error
        throw error;
      }
    }
    case 'game.bot': {
      if (state.game === null || state.game.over) return undefined;
      const seat = seatOfPeer(state, key);
      if (seat === null || state.game.active !== seat) return undefined;
      return settlePhase(state, runBotTurn(state.game, seat));
    }
    case 'game.reset': {
      return emptyRoomState(state.capacity);
    }
    default:
      return undefined;
  }
}

/** 座位绑定的稳定键：`peer.session`（同一浏览器会话断线重连不变）。 */
function peerKey(ctx: ReducerContext): string {
  return ctx.peer.session ?? ctx.peer.id;
}

function firstFreeSeat(state: RoomState): Seat | null {
  for (let seat = 1; seat <= state.capacity; seat++) {
    if (!state.seats[seat]) return seat;
  }
  return null;
}

export const gameRoom: ReducerRoomDefinition<RoomState> = {
  initialState: emptyRoomState(),
  accepts: [...GAME_COMMANDS],
  reduce: reduceRoom,
};
