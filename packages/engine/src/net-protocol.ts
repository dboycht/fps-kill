/**
 * 联机房间协议类型（纯类型 + 构造辅助，无对局逻辑）。
 *
 * 模型 = mkx-link 权威 reducer 房间：服务器持有唯一真相 `RoomState`，
 * 每接受一条命令就向全房间广播完整 state；客户端不发 state、只发命令。
 * 手牌采用荣誉制：全量快照里含所有手牌（ DevTools 可见），防偷看留待裁判制升级。
 */

import type { GameState, PlayerId } from './types.ts';

/** 座位号（v1 固定 1v1 两个座位）。 */
export type Seat = 1 | 2;

/** 服务器权威房间状态：全量可 JSON 序列化，随每条命令广播。 */
export interface RoomState {
  phase: 'lobby' | 'playing' | 'over';
  /** 座位 → 占座者的 peer id（null = 空位） */
  seats: Record<Seat, string | null>;
  /** 座位 → 昵称（null = 空位） */
  names: Record<Seat, string | null>;
  /** 当前对局 seed（null = 尚未开局） */
  seed: number | null;
  /** 对局全量状态（lobby 阶段为 null） */
  game: GameState | null;
}

export function emptyRoomState(): RoomState {
  return {
    phase: 'lobby',
    seats: { 1: null, 2: null },
    names: { 1: null, 2: null },
    seed: null,
    game: null,
  };
}

/** 客户端 → 服务器的命令类型（`accepts` 白名单与语义见 apps/server/src/room.ts）。 */
export type GameCommandType =
  | 'game.sit'
  | 'game.start'
  | 'game.action'
  | 'game.bot'
  | 'game.restart'
  | 'game.reset';

export function seatOfPeer(state: RoomState, peerId: string): Seat | null {
  if (state.seats[1] === peerId) return 1;
  if (state.seats[2] === peerId) return 2;
  return null;
}

export function seatsFull(state: RoomState): boolean {
  return state.seats[1] !== null && state.seats[2] !== null;
}

/** 是否轮到某个座位出牌（lobby/无对局时恒 false）。 */
export function isSeatTurn(state: RoomState, seat: Seat | null): boolean {
  return (
    seat !== null && state.game !== null && !state.game.over && state.game.active === seat
  );
}

export function seatLabel(seat: Seat): string {
  return `座位${seat}`;
}
