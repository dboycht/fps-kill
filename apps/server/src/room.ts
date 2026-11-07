/**
 * 权威对局房间：mkx-link `ReducerRoomDefinition<RoomState>`。
 *
 * 语义（accepts 白名单）：
 * - game.sit     落座（空位取 1 再 2；已落座则幂等并更新昵称；满员拒绝）
 * - game.start   开局（两座都有人且处于 lobby；带 seed 则用之，否则服务器随机）
 * - game.action  出牌/结束回合（发送者必须是当前 active 座位；引擎 GameError ⇒ 拒绝）
 * - game.bot     当前座位请求 Bot 代打本回合（服务器一次跑完，规避消息限速）
 * - game.restart 重开一局（两座都有人且不在 lobby；带 seed 则用之）
 * - game.reset   重置房间回 lobby（清座位与对局；任何人都可发，用于对手离开后回收）
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
  'game.start',
  'game.action',
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

/** 线上 data 收窄成 Action；形状不对返回 null。 */
export function parseAction(data: unknown): Action | null {
  if (!isRecord(data)) return null;
  const inner = isRecord(data.action) ? data.action : data;
  const player = inner.player;
  if (typeof player !== 'number' || !Number.isInteger(player)) return null;
  if (inner.type === 'END_TURN') return { type: 'END_TURN', player };
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
  return { ...state, phase: 'playing', seed, game: newGame({ seed }) };
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

/**
 * 座位绑定的稳定键：`peer.session`（= 客户端 sessionId，同一浏览器会话断线重连不变）。
 * peer.id 是房间内按加入顺序分配的，重连会换新 id，不能用于绑座位。
 */
function peerKey(ctx: ReducerContext): string {
  return ctx.peer.session ?? ctx.peer.id;
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
      const seat: Seat | null = state.seats[1] === null ? 1 : state.seats[2] === null ? 2 : null;
      if (seat === null) return undefined; // 满员
      const name = parseName(msg.data) ?? `玩家${seat}`;
      return {
        ...state,
        seats: { ...state.seats, [seat]: key },
        names: { ...state.names, [seat]: name },
      };
    }
    case 'game.start': {
      if (state.phase !== 'lobby' || !seatsFull(state)) return undefined;
      return startMatch(state, parseSeed(msg.data) ?? randomSeed());
    }
    case 'game.restart': {
      if (state.phase === 'lobby' || !seatsFull(state)) return undefined;
      return startMatch(state, parseSeed(msg.data) ?? randomSeed());
    }
    case 'game.action': {
      if (state.game === null || state.game.over) return undefined;
      const seat = seatOfPeer(state, key);
      if (seat === null || state.game.active !== seat) return undefined;
      const action = parseAction(msg.data);
      if (action === null || action.player !== state.game.active) return undefined;
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
      return emptyRoomState();
    }
    default:
      return undefined;
  }
}

export const gameRoom: ReducerRoomDefinition<RoomState> = {
  initialState: emptyRoomState(),
  accepts: [...GAME_COMMANDS],
  reduce: reduceRoom,
};
