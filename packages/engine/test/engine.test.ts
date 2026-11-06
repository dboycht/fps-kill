import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame,
  reduce,
  runBattle,
  GameError,
  BASE_CARDS,
  baseDeckInstances,
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
    emptyDeck: true,
  });
}

test('标准牌堆：47 张实体牌，杀19 闪20 桃8，uid 唯一', () => {
  const deck = baseDeckInstances();
  assert.equal(deck.length, 47);
  const byDef = (id: string) => deck.filter((c) => c.defId === id).length;
  assert.equal(byDef('sha'), 19);
  assert.equal(byDef('shan'), 20);
  assert.equal(byDef('tao'), 8);
  assert.equal(new Set(deck.map((c) => c.uid)).size, 47);
  for (const c of deck) {
    assert.ok(c.suit, '每张牌应有花色');
    assert.ok(c.rank, '每张牌应有点数');
    assert.ok(BASE_CARDS.some((d) => d.id === c.defId), 'defId 必须在牌表中注册');
  }
});

test('同 seed 两次对局完全一致（确定性）', () => {
  const a = runBattle(42);
  const b = runBattle(42);
  assert.equal(JSON.stringify(a.final), JSON.stringify(b.final));
});

test('多 seed 全部能打完且产生日志（胜负或僵局平局）', () => {
  for (let i = 0; i < 20; i++) {
    const seed = 1000 + i;
    const { final, steps } = runBattle(seed);
    assert.ok(final.over, `seed=${seed} 没打完`);
    assert.ok(final.log.length > 5, `seed=${seed} 日志过短`);
    assert.ok(steps > 0);
    if (final.winner !== null) {
      assert.ok(final.players.some((p) => !p.alive) || final.log.some((e) => e.text.includes('回合上限')), '胜者来源要有依据');
    } else {
      assert.ok(
        final.log.some((e) => e.text.includes('僵局') || e.text.includes('回合上限')),
        '无胜者应标僵局平局或回合上限平局',
      );
    }
  }
});

test('僵局判定：连续无体力变化判平局', () => {
  const flash = (rank: string): CardInstance[] => {
    const arr: CardInstance[] = [];
    for (let i = 0; i < 45; i++) {
      uidCounter += 1;
      arr.push({ uid: uidCounter, defId: 'shan', suit: 'spade', rank });
    }
    return arr;
  };
  let state = newGame({
    seed: 9,
    characterIds: ['rookie', 'rookie'],
    initialHands: [makeHand('shan', 'shan', 'shan', 'shan'), makeHand('shan', 'shan', 'shan', 'shan')],
    deckOverride: flash('2'),
  });
  let guard = 0;
  while (!state.over && guard < 200) {
    if (state.active === 2) {
      state = reduce(state, { type: 'END_TURN', player: 2 });
    } else {
      state = reduce(state, { type: 'END_TURN', player: 1 });
    }
    guard += 1;
  }
  assert.ok(state.over, '应触发僵局判定');
  assert.equal(state.winner, null);
  assert.ok(state.log.some((e) => e.text.includes('僵局')));
  assert.equal(state.players[0].hp, 4);
  assert.equal(state.players[1].hp, 4);
});

test('杀：无闪时造成 1 点伤害', () => {
  const s0 = testGame({ hands: [makeHand('sha'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 3);
  assert.equal(s1.shotUsed, true);
  assert.equal(s1.players[0].hand.length, 0);
  assert.equal(s1.discard.length, 1);
});

test('火力手杀伤害 +1（技能钩子生效）', () => {
  const s0 = testGame({ characters: ['gunner', 'rookie'], hands: [makeHand('sha'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 2);
  assert.ok(s1.log.some((e) => e.text.includes('火力全开')), '日志应有技能触发');
});

test('闪抵消杀', () => {
  const s0 = testGame({ hands: [makeHand('sha'), makeHand('shan')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 4);
  assert.equal(s1.players[1].hand.length, 0);
});

test('杀每回合限一次', () => {
  const s0 = testGame({ hands: [makeHand('sha', 'sha'), []] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.throws(
    () => reduce(s1, { type: 'PLAY_CARD', player: 1, cardUid: s1.players[0].hand[0].uid, targetId: 2 }),
    GameError,
  );
});

test('闪不能主动打出', () => {
  const s0 = testGame({ hands: [makeHand('shan'), []] });
  assert.throws(
    () => reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 }),
    GameError,
  );
});

test('桃回血且不能超过上限', () => {
  const hurt = testGame({ hands: [makeHand('tao'), []], hp: [3, 4] });
  const healed = reduce(hurt, { type: 'PLAY_CARD', player: 1, cardUid: hurt.players[0].hand[0].uid });
  assert.equal(healed.players[0].hp, 4);

  const full = testGame({ hands: [makeHand('tao'), []], hp: [4, 4] });
  assert.throws(
    () => reduce(full, { type: 'PLAY_CARD', player: 1, cardUid: full.players[0].hand[0].uid }),
    GameError,
  );
});

test('回合结束弃牌到手牌上限（=当前体力）', () => {
  const s0 = testGame({
    hands: [makeHand('shan', 'shan', 'shan', 'shan', 'shan'), []],
    hp: [2, 4],
  });
  const s1 = reduce(s0, { type: 'END_TURN', player: 1 });
  assert.equal(s1.players[0].hand.length, 2);
  assert.ok(s1.log.some((e) => e.text.includes('弃牌')), '日志应有弃牌记录');
});

test('体力归零出局并分出胜负；终局后动作无效', () => {
  const s0 = testGame({ hands: [makeHand('sha'), []], hp: [4, 1] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].alive, false);
  assert.equal(s1.winner, 1);
  assert.equal(s1.over, true);
  const s2 = reduce(s1, { type: 'END_TURN', player: 1 });
  assert.equal(JSON.stringify(s1), JSON.stringify(s2), '终局后 reducer 应幂等');
});

test('没轮到的玩家不能行动', () => {
  const s0 = testGame({ hands: [makeHand('sha'), []] });
  assert.throws(() => reduce(s0, { type: 'END_TURN', player: 2 }), GameError);
});

test('牌堆耗尽时弃牌堆重洗', () => {
  const s0 = newGame({
    seed: 7,
    characterIds: ['rookie', 'rookie'],
    initialHands: [makeHand('shan', 'shan', 'shan', 'shan', 'shan'), []],
    deckOverride: [
      { uid: 1, defId: 'sha', suit: 'spade', rank: '4' },
      { uid: 2, defId: 'sha', suit: 'heart', rank: '3' },
    ],
  });
  const s1 = reduce(s0, { type: 'END_TURN', player: 1 });
  assert.ok(s1.log.some((e) => e.text.includes('重洗')), '应触发重洗');
  assert.equal(s1.players[1].hand.length, 2);
});
