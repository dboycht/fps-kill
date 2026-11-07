import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyRoomState, newGame, type Action, type RoomState, type Seat } from '@fpskill/engine';
import type { ApplicationMessage, ReducerContext, WirePeer } from '@mkx/core';
import { gameRoom, parseAction, parseSeed, runBotTurn } from '../src/room.ts';

function ctxFor(peerId: string, seq = 1): ReducerContext {
  const peer: WirePeer = { id: peerId };
  return { room: 'fpskill', peer, seq, now: 0 };
}

function ctxForPeer(peer: WirePeer, seq = 1): ReducerContext {
  return { room: 'fpskill', peer, seq, now: 0 };
}

function cmd(state: RoomState, peerId: string, type: string, data?: unknown): RoomState | undefined {
  return cmdPeer(state, { id: peerId }, type, data);
}

function cmdPeer(
  state: RoomState,
  peer: WirePeer,
  type: string,
  data?: unknown,
): RoomState | undefined {
  const msg: ApplicationMessage = { type, data: data ?? null };
  return gameRoom.reduce(state, msg, ctxForPeer(peer));
}

/** 建一个两人已落座、可开局的房间 */
function seatedRoom(): RoomState {
  let s = emptyRoomState();
  s = cmd(s, 'p1', 'game.sit', { name: '甲' })!;
  s = cmd(s, 'p2', 'game.sit', { name: '乙' })!;
  return s;
}

/** 找一个「active 玩家手牌含 attack 牌」的 seed */
function seedWithAttack(): number {
  for (let seed = 1; seed < 400; seed++) {
    const g = newGame({ seed });
    if (g.players[0].hand.some((c) => g.cardDefs[c.defId].category === 'attack')) return seed;
  }
  throw new Error('no seed with attack card found');
}

/** 找一个「active 玩家手牌含 response 牌」的 seed */
function seedWithResponse(): number {
  for (let seed = 1; seed < 400; seed++) {
    const g = newGame({ seed });
    if (g.players[0].hand.some((c) => g.cardDefs[c.defId].category === 'response')) return seed;
  }
  throw new Error('no seed with response card found');
}

test('落座：依次占 1/2 号座，第三个被拒；昵称记录', () => {
  let s = emptyRoomState();
  s = cmd(s, 'p1', 'game.sit', { name: '甲' })!;
  assert.equal(s.seats[1], 'p1');
  assert.equal(s.names[1], '甲');
  assert.equal(s.phase, 'lobby');
  s = cmd(s, 'p2', 'game.sit', { name: '乙' })!;
  assert.equal(s.seats[2], 'p2');
  const rejected = cmd(s, 'p3', 'game.sit', { name: '丙' });
  assert.equal(rejected, undefined);
});

test('重复落座幂等且可改名；默认昵称 = 玩家N', () => {
  let s = emptyRoomState();
  s = cmd(s, 'p1', 'game.sit')!;
  assert.equal(s.names[1], '玩家1');
  s = cmd(s, 'p1', 'game.sit', { name: '新名字' })!;
  assert.equal(s.seats[1], 'p1');
  assert.equal(s.names[1], '新名字');
});

test('开局：未满员拒绝；满员后 phase=playing、seed 记录、active=1', () => {
  let s = emptyRoomState();
  s = cmd(s, 'p1', 'game.sit', { name: '甲' })!;
  assert.equal(cmd(s, 'p1', 'game.start', { seed: 42 }), undefined);
  s = cmd(s, 'p2', 'game.sit', { name: '乙' })!;
  s = cmd(s, 'p1', 'game.start', { seed: 42 })!;
  assert.equal(s.phase, 'playing');
  assert.equal(s.seed, 42);
  assert.notEqual(s.game, null);
  assert.equal(s.game!.turn, 1);
  assert.equal(s.game!.active, 1);
});

test('开局后再 start 拒绝（用 game.restart 重开）', () => {
  const s = cmd(seatedRoom(), 'p1', 'game.start', { seed: 42 })!;
  assert.equal(cmd(s, 'p1', 'game.start', { seed: 43 }), undefined);
  const again = cmd(s, 'p1', 'game.restart', { seed: 43 })!;
  assert.equal(again.seed, 43);
  assert.equal(again.game!.turn, 1);
});

test('game.action：非 active 座位拒绝、player 字段不符拒绝', () => {
  const s = cmd(seatedRoom(), 'p1', 'game.start', { seed: 42 })!;
  assert.equal(cmd(s, 'p2', 'game.action', { action: { type: 'END_TURN', player: 2 } }), undefined);
  assert.equal(
    cmd(s, 'p1', 'game.action', { action: { type: 'END_TURN', player: 2 } }),
    undefined,
  );
});

test('game.action：合法杀被接受（shotUsed），之后 END_TURN 换人', () => {
  const seed = seedWithAttack();
  let s = cmd(seatedRoom(), 'p1', 'game.start', { seed })!;
  const g0 = s.game!;
  const attack = g0.players[0].hand.find((c) => g0.cardDefs[c.defId].category === 'attack')!;
  const play: Action = { type: 'PLAY_CARD', player: 1, cardUid: attack.uid, targetId: 2 };
  s = cmd(s, 'p1', 'game.action', { action: play })!;
  assert.notEqual(s.game, null);
  assert.equal(s.game!.active, 1);
  assert.equal(s.game!.shotUsed, true);
  assert.notEqual(JSON.stringify(s.game), JSON.stringify(g0));
  s = cmd(s, 'p1', 'game.action', { action: { type: 'END_TURN', player: 1 } })!;
  assert.equal(s.game!.active, 2);
  assert.equal(s.game!.shotUsed, false);
  // 换人后旧座位再发被拒
  assert.equal(cmd(s, 'p1', 'game.action', { action: { type: 'END_TURN', player: 1 } }), undefined);
});

test('game.action：response 牌主动打出被拒（引擎 GameError 通道）', () => {
  const seed = seedWithResponse();
  let s = cmd(seatedRoom(), 'p1', 'game.start', { seed })!;
  const shan = s.game!.players[0].hand.find(
    (c) => s.game!.cardDefs[c.defId].category === 'response',
  )!;
  const bad: Action = { type: 'PLAY_CARD', player: 1, cardUid: shan.uid, targetId: 2 };
  assert.equal(cmd(s, 'p1', 'game.action', { action: bad }), undefined);
  // 房间状态未被破坏
  assert.equal(s.phase, 'playing');
  assert.equal(s.game!.shotUsed, false);
});

test('game.bot：当前座位一次跑完整回合', () => {
  const seed = seedWithAttack();
  let s = cmd(seatedRoom(), 'p1', 'game.start', { seed })!;
  // 让 active 变成 2
  s = cmd(s, 'p1', 'game.action', { action: { type: 'END_TURN', player: 1 } })!;
  assert.equal(s.game!.active, 2);
  // p1 代打别人的回合被拒
  assert.equal(cmd(s, 'p1', 'game.bot'), undefined);
  s = cmd(s, 'p2', 'game.bot')!;
  const afterBot = s.game!;
  assert.ok(afterBot.over || afterBot.active === 1, 'bot 应跑完 p2 的整回合');
});

test('game.restart：playing 状态可重开新局；lobby 状态拒绝', () => {
  let s = cmd(seatedRoom(), 'p1', 'game.restart', { seed: 1 });
  assert.equal(s, undefined);
  s = cmd(seatedRoom(), 'p1', 'game.start', { seed: 42 })!;
  s = cmd(s, 'p1', 'game.restart')!; // 不带 seed → 服务器随机
  assert.equal(s.phase, 'playing');
  assert.ok(s.seed !== null && s.seed >= 1);
  assert.equal(s.game!.turn, 1);
  assert.equal(s.game!.active, 1);
});

test('game.reset：任何人可把房间重置回 lobby（座位清空）', () => {
  let s = cmd(seatedRoom(), 'p1', 'game.start', { seed: 42 })!;
  s = cmd(s, 'p9', 'game.reset')!;
  assert.equal(s.phase, 'lobby');
  assert.equal(s.seats[1], null);
  assert.equal(s.seats[2], null);
  assert.equal(s.game, null);
  assert.equal(s.seed, null);
});

test('确定性：同 seed 两次开局的 game 完全一致', () => {
  const a = cmd(seatedRoom(), 'p1', 'game.start', { seed: 1234 })!;
  const b = cmd(seatedRoom(), 'p1', 'game.start', { seed: 1234 })!;
  assert.equal(JSON.stringify(a.game), JSON.stringify(b.game));
});

test('runBotTurn：bot 回合必然推进（换人或终局）', () => {
  const start = cmd(seatedRoom(), 'p1', 'game.start', { seed: 42 })!;
  const seat = start.game!.active as Seat;
  const after = runBotTurn(start.game!, seat);
  assert.ok(after.over || after.active !== seat);
});

test('断线重连：同 session 新 pid 保持座位（绑定键 = session）', () => {
  let s = emptyRoomState();
  s = cmdPeer(s, { id: 'a1', session: 's1' }, 'game.sit', { name: '甲' })!;
  s = cmdPeer(s, { id: 'a2', session: 's2' }, 'game.sit', { name: '乙' })!;
  s = cmdPeer(s, { id: 'a1', session: 's1' }, 'game.start', { seed: 42 })!;
  // 重连后同 session 换了房间内 pid，仍应被认作座位1
  const again = cmdPeer(s, { id: 'a3', session: 's1' }, 'game.action', {
    action: { type: 'END_TURN', player: 1 },
  });
  assert.notEqual(again, undefined);
  assert.equal(again!.game!.active, 2);
  // 新 session 冒充不了座位1
  assert.equal(
    cmdPeer(s, { id: 'a9', session: 's9' }, 'game.action', {
      action: { type: 'END_TURN', player: 1 },
    }),
    undefined,
  );
});

test('parseAction / parseSeed：畸形数据收窄', () => {
  assert.equal(parseAction(null), null);
  assert.equal(parseAction({ type: 'JUNK' }), null);
  assert.equal(parseAction({ action: { type: 'END_TURN' } }), null); // 缺 player
  assert.equal(parseAction({ action: { type: 'END_TURN', player: 1 } })!.type, 'END_TURN');
  assert.equal(parseAction({ type: 'PLAY_CARD', player: 1, cardUid: 3 })!.type, 'PLAY_CARD');
  assert.equal(parseSeed({ seed: 42 }), 42);
  assert.equal(parseSeed({ seed: 0 }), null);
  assert.equal(parseSeed({ seed: 1.5 }), null);
  assert.equal(parseSeed({}), null);
});
