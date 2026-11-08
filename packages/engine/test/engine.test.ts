import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newGame,
  reduce,
  runBattle,
  decideAction,
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

test('标准牌堆：98 张实体牌（12 种牌型），uid 唯一', () => {
  const deck = baseDeckInstances();
  assert.equal(deck.length, 98);
  const byDef = (id: string) => deck.filter((c) => c.defId === id).length;
  // 基础三件套回归基线（第 20 张杀是源素材重复文件，被 prepare-assets 正确跳过）
  assert.equal(byDef('sha'), 19);
  assert.equal(byDef('shan'), 20);
  assert.equal(byDef('tao'), 8);
  // 技能牌张数（来自用户素材真实张数）
  assert.equal(byDef('jiu'), 8);
  assert.equal(byDef('power-bank'), 8);
  assert.equal(byDef('perfect-server'), 8);
  assert.equal(byDef('bullet-eater'), 8);
  assert.equal(byDef('mid-door-awp'), 4);
  assert.equal(byDef('friendly-tk'), 4);
  assert.equal(byDef('gimme-that'), 4);
  assert.equal(byDef('reload-addict'), 3);
  assert.equal(byDef('dynasty-strike'), 4);
  assert.equal(new Set(deck.map((c) => c.uid)).size, 98);
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

// ---------- 技能牌（效果文本转录自用户牌面，见 cards.ts 注释） ----------

const uid = (() => {
  let n = 5000;
  return () => {
    n += 1;
    return n;
  };
})();

test('酒：杀伤害+1（火力手叠满 = 3），每回合限一次，被闪抵消也消耗', () => {
  // 新兵：1 + 1(酒) = 2
  const s0 = testGame({ hands: [makeHand('jiu', 'sha'), []] });
  const jiu = s0.players[0].hand[0];
  const sha = s0.players[0].hand[1];
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: jiu.uid });
  assert.equal(s1.players[0].jiuUsed, true);
  const s2 = reduce(s1, { type: 'PLAY_CARD', player: 1, cardUid: sha.uid, targetId: 2 });
  assert.equal(s2.players[1].hp, 2);
  assert.equal(s2.players[0].jiuUsed, false, '酒应被消耗');
  // 第二张酒同回合被拒
  const s3 = testGame({ hands: [makeHand('jiu', 'jiu'), []] });
  const s4 = reduce(s3, { type: 'PLAY_CARD', player: 1, cardUid: s3.players[0].hand[0].uid });
  assert.throws(
    () => reduce(s4, { type: 'PLAY_CARD', player: 1, cardUid: s4.players[0].hand[0].uid }),
    GameError,
  );
  // 火力手：1 + 1(酒) + 1(火力全开) = 3
  const g0 = testGame({ characters: ['gunner', 'rookie'], hands: [makeHand('jiu', 'sha'), []] });
  const g2 = reduce(
    reduce(g0, { type: 'PLAY_CARD', player: 1, cardUid: g0.players[0].hand[0].uid }),
    { type: 'PLAY_CARD', player: 1, cardUid: g0.players[0].hand[1].uid, targetId: 2 },
  );
  assert.equal(g2.players[1].hp, 1);
});

test('酒加成在被闪抵消时同样消耗', () => {
  const s0 = testGame({ hands: [makeHand('jiu', 'sha'), makeHand('shan')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid });
  const s2 = reduce(s1, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[1].uid, targetId: 2 });
  assert.equal(s2.players[1].hp, 4, '闪应抵消');
  assert.equal(s2.players[0].jiuUsed, false, '酒已随杀消耗');
});

test('充电宝：弃 1 摸 1（净手牌数不变）', () => {
  const s0 = newGame({
    seed: 3,
    characterIds: ['rookie', 'rookie'],
    initialHands: [makeHand('power-bank', 'shan'), []],
    deckOverride: [
      { uid: uid(), defId: 'sha', suit: 'heart', rank: '5' },
      { uid: uid(), defId: 'shan', suit: 'club', rank: '6' },
      { uid: uid(), defId: 'tao', suit: 'diamond', rank: '7' },
    ],
  });
  // 起手自动摸 2（newGame 固定流程）→ 手牌 4，牌堆剩 1
  assert.equal(s0.players[0].hand.length, 4);
  const pb = s0.players[0].hand[0];
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: pb.uid });
  assert.equal(s1.players[0].hand.length, 4, '弃充电宝 + 摸 1 = 净不变');
  assert.ok(s1.players[0].hand.every((c) => c.defId !== 'power-bank'), '充电宝应离手');
  assert.ok(s1.discard.some((c) => c.defId === 'power-bank'));
  assert.ok(s1.players[0].hand.some((c) => c.defId === 'sha'), '应从牌堆摸到牌');
});

test('完美服务器：护盾抵消一次道具牌，之后失效', () => {
  let s = testGame({ hands: [makeHand('perfect-server', 'bullet-eater', 'bullet-eater'), makeHand('sha', 'shan')] });
  const [ps, eater1, eater2] = s.players[0].hand;
  s = reduce(s, { type: 'PLAY_CARD', player: 1, cardUid: ps.uid, targetId: 2 });
  assert.equal(s.players[1].perfectShield, true);
  // 第一发吞子弹被护盾抵消
  s = reduce(s, { type: 'PLAY_CARD', player: 1, cardUid: eater1.uid, targetId: 2 });
  assert.equal(s.players[1].hand.length, 2, '护盾应抵消吞子弹');
  assert.equal(s.players[1].perfectShield, false, '护盾一次性');
  // 第二发生效
  s = reduce(s, { type: 'PLAY_CARD', player: 1, cardUid: eater2.uid, targetId: 2 });
  assert.equal(s.players[1].hand.length, 1);
});

test('吞子弹：目标弃一张手牌；空手无事发生', () => {
  const s0 = testGame({ hands: [makeHand('bullet-eater'), makeHand('sha', 'shan')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hand.length, 1);
  assert.equal(s1.discard.length, 2);
  const s2 = testGame({ hands: [makeHand('bullet-eater'), []] });
  const s3 = reduce(s2, { type: 'PLAY_CARD', player: 1, cardUid: s2.players[0].hand[0].uid, targetId: 2 });
  assert.ok(s3.log.some((e) => e.text.includes('无事发生')));
});

test('善意TK：有牌弃 1，空手受 1 点伤害', () => {
  const s0 = testGame({ hands: [makeHand('friendly-tk'), makeHand('sha')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hand.length, 0);
  assert.equal(s1.players[1].hp, 4);
  const s2 = testGame({ hands: [makeHand('friendly-tk'), []] });
  const s3 = reduce(s2, { type: 'PLAY_CARD', player: 1, cardUid: s2.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s3.players[1].hp, 3);
});

test('拿来吧你：目标一张手牌易主；自己不能用', () => {
  const s0 = testGame({ hands: [makeHand('gimme-that'), makeHand('sha', 'shan')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[0].hand.length, 1);
  assert.equal(s1.players[1].hand.length, 1);
  assert.equal(s1.discard.length, 1, '拿来的牌应进手牌而非弃牌堆');
  const s2 = testGame({ hands: [makeHand('gimme-that'), []] });
  assert.throws(
    () => reduce(s2, { type: 'PLAY_CARD', player: 1, cardUid: s2.players[0].hand[0].uid, targetId: 1 }),
    GameError,
  );
});

test('换弹癌：可对自己使用，弃 1 摸 1；空手受 1 点伤害', () => {
  const s0 = newGame({
    seed: 5,
    characterIds: ['rookie', 'rookie'],
    initialHands: [makeHand('reload-addict', 'shan', 'shan'), []],
    deckOverride: [
      { uid: uid(), defId: 'sha', suit: 'club', rank: '8' },
      { uid: uid(), defId: 'shan', suit: 'heart', rank: '9' },
      { uid: uid(), defId: 'tao', suit: 'spade', rank: '10' },
    ],
  });
  // 起手自动摸 2 → 手牌 5，牌堆剩 1（那张杀）
  assert.equal(s0.players[0].hand.length, 5);
  const ra = s0.players[0].hand[0];
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: ra.uid, targetId: 1 });
  assert.equal(s1.players[0].hand.length, 4, '5 - 本体(ra) - 随机弃1 + 摸1 = 4');
  assert.ok(s1.players[0].hand.some((c) => c.defId === 'sha'), '换弹摸进的应是牌堆剩的那张杀');
  assert.ok(s1.discard.some((c) => c.defId === 'reload-addict'));
  assert.ok(s1.log.some((e) => e.text.includes('换弹')));
  const s2 = testGame({ hands: [makeHand('reload-addict'), []] });
  const s3 = reduce(s2, { type: 'PLAY_CARD', player: 1, cardUid: s2.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s3.players[1].hp, 3, '空手换弹失败应受 1 点伤害');
});

test('中门对狙：接收者先出杀交替，无法出者受 1 点伤害', () => {
  // 用户 2 杀，目标 1 杀：目标先出 → 用户出 → 目标无杀 → 目标 -1
  const s0 = testGame({ hands: [makeHand('mid-door-awp', 'sha', 'sha'), makeHand('sha')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s1.players[1].hp, 3);
  assert.equal(s1.players[0].hand.filter((c) => c.defId === 'sha').length, 1, '用户应消耗一张应对杀');
  assert.equal(s1.players[1].hand.length, 0);
  // 双方都无杀：接收者（目标）直接受 1 点
  const s2 = testGame({ hands: [makeHand('mid-door-awp'), []] });
  const s3 = reduce(s2, { type: 'PLAY_CARD', player: 1, cardUid: s2.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s3.players[1].hp, 3);
  // 决斗伤害不吃火力全开加成
  const s4 = testGame({ characters: ['gunner', 'rookie'], hands: [makeHand('mid-door-awp'), []] });
  const s5 = reduce(s4, { type: 'PLAY_CARD', player: 1, cardUid: s4.players[0].hand[0].uid, targetId: 2 });
  assert.equal(s5.players[1].hp, 3);
});

test('王朝来袭：其他玩家弃杀；完美服务器护盾优先抵消；无杀无事发生', () => {
  // 目标有杀 → 弃
  const s0 = testGame({ hands: [makeHand('dynasty-strike'), makeHand('sha', 'shan')] });
  const s1 = reduce(s0, { type: 'PLAY_CARD', player: 1, cardUid: s0.players[0].hand[0].uid });
  assert.equal(s1.players[1].hand.length, 1, '应弃一张（留闪）');
  assert.equal(s1.players[1].hand[0].defId, 'shan');
  assert.equal(s1.players[0].hand.length, 0, '使用者自己不弃');
  // 目标有护盾 → 抵消且保杀
  const t0 = testGame({ hands: [makeHand('dynasty-strike', 'perfect-server'), makeHand('sha')] });
  const t1 = reduce(t0, { type: 'PLAY_CARD', player: 1, cardUid: t0.players[0].hand[1].uid, targetId: 2 });
  const t2 = reduce(t1, { type: 'PLAY_CARD', player: 1, cardUid: t0.players[0].hand[0].uid });
  assert.equal(t2.players[1].perfectShield, false);
  assert.equal(t2.players[1].hand.length, 1, '杀应保留');
  // 无杀无盾 → 无事发生（原文无惩罚条款）
  const u0 = testGame({ hands: [makeHand('dynasty-strike'), makeHand('shan', 'shan')] });
  const u1 = reduce(u0, { type: 'PLAY_CARD', player: 1, cardUid: u0.players[0].hand[0].uid });
  assert.equal(u1.players[1].hand.length, 2);
  assert.equal(u1.players[1].hp, 4);
});

test('bot：先酒后杀的连招', () => {
  const s0 = testGame({ hands: [makeHand('jiu', 'sha'), []] });
  const a0 = decideAction(s0);
  assert.equal(a0.type, 'PLAY_CARD');
  assert.equal(s0.players[0].hand.find((c) => c.uid === (a0 as { cardUid: number }).cardUid)?.defId, 'jiu');
  const s1 = reduce(s0, a0);
  const a1 = decideAction(s1);
  const s2 = reduce(s1, a1);
  assert.equal(s2.players[1].hp, 2, '酒杀应造成 2 点伤害');
});
