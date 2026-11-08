/**
 * 联机房间协议类型（纯类型 + 构造辅助，无对局逻辑）。
 *
 * 模型 = mkx-link 权威 reducer 房间：服务器持有唯一真相 `RoomState`，
 * 每接受一条命令就向全房间广播完整 state；客户端不发 state、只发命令。
 * 手牌采用荣誉制：全量快照里含所有手牌（DevTools 可见），防偷看留待裁判制升级。
 *
 * 多人局（1.1.0）：房主（座位 1）配置人数（2..8）→ 满员后房主开局 → 随机发放武将。
 */

import type { GameState, PlayerId } from './types.ts';

/** 座位号（1 起） */
export type Seat = number;

/** 座位容量上下限 */
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 8;

/** 服务器权威房间状态：全量可 JSON 序列化，随每条命令广播。 */
export interface RoomState {
  phase: 'lobby' | 'playing' | 'over';
  /** 座位数（房主在 lobby 配置；2..8） */
  capacity: number;
  /** 房主的 peer 绑定键（= 第一个落座者；开局/重开仅房主可点） */
  hostPeer: string | null;
  /** 座位 → 占座者的 peer 绑定键（session；null = 空位） */
  seats: Record<number, string | null>;
  /** 座位 → 昵称（null = 空位） */
  names: Record<number, string | null>;
  /** 当前对局 seed（null = 尚未开局） */
  seed: number | null;
  /** 对局全量状态（lobby 阶段为 null） */
  game: GameState | null;
}

export function emptyRoomState(capacity = MIN_CAPACITY): RoomState {
  const cap = clampCapacity(capacity);
  const seats: Record<number, string | null> = {};
  const names: Record<number, string | null> = {};
  for (let i = 1; i <= cap; i++) {
    seats[i] = null;
    names[i] = null;
  }
  return {
    phase: 'lobby',
    capacity: cap,
    hostPeer: null,
    seats,
    names,
    seed: null,
    game: null,
  };
}

/** 座位表按 capacity 补齐空位键（容量变更后调用） */
export function normalizeSeats(state: RoomState): RoomState {
  const seats = { ...state.seats };
  const names = { ...state.names };
  for (let i = 1; i <= state.capacity; i++) {
    if (seats[i] === undefined) seats[i] = null;
    if (names[i] === undefined) names[i] = null;
  }
  return { ...state, seats, names };
}

export function clampCapacity(n: unknown): number {
  const v = typeof n === 'number' && Number.isInteger(n) ? n : MIN_CAPACITY;
  return Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, v));
}

/** 客户端 → 服务器的命令类型（`accepts` 白名单与语义见 apps/server/src/room.ts）。 */
export type GameCommandType =
  | 'game.sit'
  | 'game.config'
  | 'game.start'
  | 'game.action'
  | 'game.skill'
  | 'game.bot'
  | 'game.restart'
  | 'game.reset';

export function seatCount(state: RoomState): number {
  return state.capacity;
}

export function seatOfPeer(state: RoomState, peerKey: string): Seat | null {
  for (let seat = 1; seat <= state.capacity; seat++) {
    if (state.seats[seat] === peerKey) return seat;
  }
  return null;
}

export function seatsFull(state: RoomState): boolean {
  for (let seat = 1; seat <= state.capacity; seat++) {
    if (!state.seats[seat]) return false;
  }
  return state.capacity >= MIN_CAPACITY;
}

export function seatedCount(state: RoomState): number {
  let n = 0;
  for (let seat = 1; seat <= state.capacity; seat++) {
    if (state.seats[seat]) n += 1;
  }
  return n;
}

/** 是否轮到某个座位出牌（lobby/无对局时恒 false）。 */
export function isSeatTurn(state: RoomState, seat: Seat | null): boolean {
  return seat !== null && state.game !== null && !state.game.over && state.game.active === seat;
}

export function seatLabel(seat: Seat): string {
  return `座位${seat}`;
}

export type { GameState, PlayerId };
