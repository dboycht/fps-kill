import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame,
  reduce,
  runBattle,
  GameError,
  type CardInstance,
  type GameState,
} from '../src/index.ts';

let uidCounter = 900;
function makeHand(...defIds: string[]): CardInstance[] {
  return defIds.map((defId) => {
    uidCounter += 1;
    return { uid: uidCounter, defId };
  });
}

/** 规则单测专用：空牌堆 + 指定手牌/体力，排除随机摸牌干扰 */
function testGame(opts: {
  characters?: [string, string];
  hands?: [CardInstance[], CardInstance[]];
  hp?: [number, number];
}): GameState {
  return newGame({
    seed: 1,
    characterIds: opts.characters ?? ['rookie', 'rookie'],
    initialHands: opts.hands,
    initialHp: opts.hp,
    startWithEmptyDeck: true,
  });
}

test('同 seed 两次对局完全一致（确定性）', () => {
  const a = runBattle(42);
  const b = runBattle(42);
  assert.equal(JSON.stringify(a.final), JSON.stringify(b.final));
});

test('多 seed 全部能打完且产生日志', () => {
  for (let i = 0; i < 20; i++) {
    const seed = 1000 + i;
    const { final, steps } = runBattle(seed);
    assert.ok(final.winner !== null, `seed=${seed} 没打完`);
    assert.ok(final.log.length > 5, `seed=${seed} 日志过短`);
    assert.ok(steps > 0);
    assert.ok(final.players.some((p) => !p.alive), '应有败者');
  }
});

test('射击：无闪避时造成 1 点伤害', () => {
  const s0 = testGame({ hands: [makeHand('shoot'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 3);
  assert.equal(s1.shotUsed, true);
  assert.equal(s1.players[0].hand.length, 0);
  assert.equal(s1.discard.length, 1);
});

test('火力手射击伤害 +1（技能钩子生效）', () => {
  const s0 = testGame({ characters: ['gunner', 'rookie'], hands: [makeHand('shoot'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 2);
  assert.ok(s1.log.some((e) => e.text.includes('火力全开')), '日志应有技能触发');
});

test('闪避抵消射击', () => {
  const s0 = testGame({ hands: [makeHand('shoot'), makeHand('dodge')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 4);
  assert.equal(s1.players[1].hand.length, 0);
});

test('射击每回合限一次', () => {
  const s0 = testGame({ hands: [makeHand('shoot', 'shoot'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.throws(
    () => reduce(s1, { type: 'PLAY_CARD', player: 1, cardUid: s1.players[0].hand[0].uid, targetId: 2 }),
    GameError,
  );
});

test('闪避不能主动打出', () => {
  const s0 = testGame({ hands: [makeHand('dodge'), []] });
  assert.throws(
    () => reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 }),
    GameError,
  );
});

test('医疗包回血且不能超过上限', () => {
  const hurt = testGame({ hands: [makeHand('medkit'), []], hp: [3, 4] });
  const healed = reduce(hurt, { type: 'PLAY_CARD', player: 1, cardUid: hurt.players[0].hand[0].uid });
  assert.equal(healed.players[0].hp, 4);

  const full = testGame({ hands: [makeHand('medkit'), []], hp: [4, 4] });
  assert.throws(
    () => reduce(full, { type: 'PLAY_CARD', player: 1, cardUid: full.players[0].hand[0].uid }),
    GameError,
  );
});

test('回合结束弃牌到手牌上限（=当前体力）', () => {
  const s0 = testGame({
    hands: [makeHand('dodge', 'dodge', 'dodge', 'dodge', 'dodge'), []],
    hp: [2, 4],
  });
  const s1 = reduce(s0, { type: 'END_TURN', player: 1 });
  assert.equal(s1.players[0].hand.length, 2);
  assert.ok(s1.log.some((e) => e.text.includes('弃牌')), '日志应有弃牌记录');
});

test('体力归零出局并分出胜负；终局后动作无效', () => {
  const s0 = testGame({ hands: [makeHand('shoot'), []], hp: [4, 1] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].alive, false);
  assert.equal(s1.winner, 1);
  const s2 = reduce(s1, { type: 'END_TURN', player: 1 });
  assert.equal(JSON.stringify(s1), JSON.stringify(s2), '终局后 reducer 应幂等');
});

test('没轮到的玩家不能行动', () => {
  const s0 = testGame({ hands: [makeHand('shoot'), []] });
  assert.throws(() => reduce(s0, { type: 'END_TURN', player: 2 }), GameError);
});

test('牌堆耗尽时弃牌堆重洗', () => {
  const s0 = newGame({
    seed: 7,
    characterIds: ['rookie', 'rookie'],
    initialHands: [makeHand('dodge', 'dodge', 'dodge', 'dodge', 'dodge'), []],
    deckDefs: [{ id: 'shoot', name: '射击', category: 'attack', desc: '', count: 2 }],
  });
  const s1 = reduce(s0, { type: 'END_TURN', player: 1 });
  assert.ok(s1.log.some((e) => e.text.includes('重洗')), '应触发重洗');
  assert.equal(s1.players[1].hand.length, 2);
});
