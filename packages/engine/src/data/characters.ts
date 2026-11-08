import { registerSkill } from '../skills.ts';
import { rngInt } from '../rng.ts';
import {
  GameError,
  dealDamage,
  isRed,
  judgeTop,
  playerLabel,
  pushLog,
  resolveShaAgainst,
} from '../core.ts';
import type { CharacterDef, GameState, PlayerState, SkillDef } from '../types.ts';

/**
 * 武将与技能表（技能转录自用户 12 张武将卡面）。
 * 本轮实装各将核心技能（判定/阵营/轮次/标记/主动技框架）；依赖装备区、濒死求救窗、
 * 团队定向给牌的部分未实装，逐条见 DEVELOPMENT.md §3.6 解释稿。
 */

function mark(self: PlayerState, key: string): number {
  return self.marks[key] ?? 0;
}

function addMark(self: PlayerState, key: string, by = 1): void {
  self.marks[key] = mark(self, key) + by;
}

function judgeText(state: GameState, prefix: string): { card: ReturnType<typeof judgeTop>; red: boolean } {
  const card = judgeTop(state);
  const red = isRed(card);
  pushLog(state, `${prefix}判定：[${card.defId} ${card.suit ?? ''}${card.rank ?? ''}]，${red ? '红' : '黑'}`);
  return { card, red };
}

/** 小孩·闪电：弃一张闪，对目标连出至多两张无视距离的杀（不占次数，逐张独立闪判定） */
function resolveLightningSha(state: GameState, self: PlayerState, targetId: number): void {
  const target = state.players[targetId - 1];
  if (!target?.alive) throw new GameError('闪电：目标已出局');
  let count = 0;
  for (let i = 0; i < 2; i++) {
    const sha = self.hand.find((c) => c.defId === 'sha');
    if (!sha) break;
    self.hand.splice(self.hand.indexOf(sha), 1);
    state.discard.push(sha);
    count += 1;
    pushLog(state, `【闪电】${playerLabel(state, self.id)} 打出 [杀] → ${playerLabel(state, targetId)}`);
    resolveShaAgainst(state, self, target, sha, { ignoreDistance: true, noCount: true });
    if (!target.alive || state.over) break;
  }
  if (count === 0) pushLog(state, `【闪电】${playerLabel(state, self.id)} 没有可打出的 [杀]`);
}

export const SKILLS: SkillDef[] = [
  // ---------- 妹子（吴·英伦奶爸，5 体力） ----------
  {
    id: 'yuying',
    name: '育婴',
    desc: '一轮仅限一次：丢弃一张红色牌视为使用一张【桃】。',
    active: { needsCard: 'red', oncePer: 'round' },
    executeSkill: (state, self, action) => {
      const idx = self.hand.findIndex((c) => c.uid === action.cardUid);
      if (idx < 0) throw new GameError('育婴：需要选择一张红色手牌');
      const card = self.hand[idx];
      if (!isRed(card)) throw new GameError('育婴：只能丢弃红色牌');
      if (self.hp >= self.maxHp) throw new GameError('体力已满，无法发动【育婴】');
      self.hand.splice(idx, 1);
      state.discard.push(card);
      const from = self.hp;
      self.hp = Math.min(self.maxHp, self.hp + 1);
      pushLog(state, `【育婴】${playerLabel(state, self.id)} 弃红牌当 [桃]，体力 ${from}→${self.hp}`);
    },
  },

  // ---------- 豆豆（吴·蹦跳僵尸，4 体力） ----------
  {
    id: 'jiangshi',
    name: '僵尸',
    desc: '使用【闪】时进行牌顶判定，若为红则【闪】无效。',
    onDodgeCheck: (state, self) => {
      const { red } = judgeText(state, `【僵尸】${playerLabel(state, self.id)} 用 [闪] 时`);
      return !red;
    },
  },

  // ---------- 载物（吴·法国兵器，4 体力） ----------
  {
    id: 'shuaiju',
    name: '甩狙',
    desc: '攻击距离+1；对其他角色造成 2 点及以上伤害时进行判定，若为红牌则自己受到一点伤害并摸一张牌。',
    attackRangeBonus: 1,
    onDamageDealt: (state, self, ctx) => {
      if (ctx.amount < 2 || ctx.target === self.id) return;
      const { red } = judgeText(state, `【甩狙】`);
      if (red) {
        dealDamage(state, self.id, self.id, 1, null);
        const c = state.deck.pop();
        if (c) self.hand.push(c);
        pushLog(state, `【甩狙】反噬：${playerLabel(state, self.id)} 受 1 点伤害并摸 1 张牌`);
      }
    },
  },

  // ---------- 车主（吴·天才少年，5 体力） ----------
  {
    id: 'shenfa',
    name: '身法',
    desc: '摸牌阶段结束后判定，红牌则切换【身位】（背身=闪必生效 / 正面=受伤+1）；初始背身。',
    onDrawEnd: (state, self) => {
      const { red } = judgeText(state, `【身法】`);
      if (red) self.posture = self.posture === 'back' ? 'front' : 'back';
      pushLog(state, `${playerLabel(state, self.id)} 身位：${self.posture === 'front' ? '正面（受伤+1）' : '背身（闪必成）'}`);
    },
  },
  {
    id: 'shenfa_guard',
    name: '身法·背身',
    desc: '背身状态：打出的【闪】必生效。',
    onDodgeCheck: (state, self) => self.posture !== 'front',
  },
  {
    id: 'shenfa_fragile',
    name: '身法·正面',
    desc: '正面状态：受到的伤害 +1。',
    onIncomingDamageModify: (state, self, amount) => (self.posture === 'front' ? amount + 1 : amount),
  },
  {
    id: 'paoche',
    name: '跑车',
    desc: '攻击距离+1。〔致命伤弃装备区免疫：装备区未实装，待后续〕',
    attackRangeBonus: 1,
  },

  // ---------- 火仔（吴·科研大蛇，3 体力） ----------
  {
    id: 'yanfa',
    name: '研发',
    desc: '受到伤害时获得一枚【芯片】；体力归零时仅限一次弃所有【芯片】回满体力。〔濒死救回的数字化近似〕',
    onDamaged: (state, self) => {
      const c = state.deck.pop();
      if (c) {
        state.discard.push(c);
        addMark(self, 'chip');
        pushLog(state, `【研发】${playerLabel(state, self.id)} 获得 1 枚【芯片】（共 ${mark(self, 'chip')}）`);
      }
    },
  },
  {
    id: 'yanfa_save',
    name: '研发·回满',
    desc: '体力归零时仅限一次：弃所有【芯片】并将体力回满（从出局边缘救回）。',
    onDamaged: (state, self) => {
      if (self.alive || self.hp > 0) return;
      if (mark(self, 'chip_save_used') > 0 || mark(self, 'chip') <= 0) return;
      addMark(self, 'chip_save_used');
      const chips = mark(self, 'chip');
      self.marks['chip'] = 0;
      self.alive = true;
      self.hp = self.maxHp;
      pushLog(state, `【研发】${playerLabel(state, self.id)} 消耗 ${chips} 枚【芯片】从出局边缘回满体力！（仅此一次）`);
    },
  },
  {
    id: 'tupo',
    name: '突破',
    desc: '攻击距离+1；出牌阶段造成的伤害若为本轮第一次，摸一张牌。',
    attackRangeBonus: 1,
    onDamageDealt: (state, self, ctx) => {
      if (ctx.target === self.id || state.roundFirstDamage) return;
      state.roundFirstDamage = true;
      const c = state.deck.pop();
      if (c) self.hand.push(c);
      pushLog(state, `【突破】本轮首伤：${playerLabel(state, self.id)} 摸 1 张牌`);
    },
  },

  // ---------- 载种（神·最终兵器，3 体力） ----------
  {
    id: 'suotou',
    name: '锁头',
    desc: '使用的红【杀】不可被抵消。',
    onShaUnblockable: (state, source, card) => isRed(card),
  },
  {
    id: 'toushi',
    name: '透视',
    desc: '弃牌阶段结束后可再弃至多 2 张牌并拿取指定角色等量的牌。〔数字版：每回合一次，弃 1 拿 1（随机）〕',
    active: { needsTarget: true, oncePer: 'turn' },
    executeSkill: (state, self, action) => {
      if (action.targetId === undefined || action.targetId === self.id) throw new GameError('透视：需要指定其他角色');
      const target = state.players[action.targetId - 1];
      if (!target?.alive) throw new GameError('透视：目标已出局');
      if (self.hand.length === 0) throw new GameError('透视：没有手牌可弃');
      const dropped = self.hand.splice(0, 1)[0];
      state.discard.push(dropped);
      if (target.hand.length > 0) {
        const pick = rngInt(state.rng, target.hand.length);
        state.rng = pick.next;
        const stolen = target.hand.splice(pick.value, 1)[0];
        self.hand.push(stolen);
        pushLog(state, `【透视】${playerLabel(state, self.id)} 弃 1 拿 1（${playerLabel(state, target.id)}）`);
      } else {
        pushLog(state, `【透视】${playerLabel(state, self.id)} 弃 1 张，目标无手牌`);
      }
    },
  },

  // ---------- 莽K（神·球状闪电，4 体力） ----------
  {
    id: 'yingjing',
    name: '鹰精',
    desc: '摸牌阶段结束时摸取与场上【蜀】阵营角色数量相同的手牌。〔原文为「猎鹰角色」＝蜀·猎鹰派系〕',
    onDrawEnd: (state, self) => {
      const count = state.players.filter(
        (p) => p.alive && state.characterDefs[p.characterId]?.faction === 'shu',
      ).length;
      if (count <= 0) return;
      for (let i = 0; i < count; i++) {
        const c = state.deck.pop();
        if (!c) break;
        self.hand.push(c);
      }
      pushLog(state, `【鹰精】${playerLabel(state, self.id)} 依据场上 ${count} 名蜀角色摸 ${count} 张牌`);
    },
  },
  {
    id: 'kuaiqiang',
    name: '快枪',
    desc: '回合开始时可直接对一名角色造成 1 点伤害（无视距离、无需手牌、不占出杀次数）。〔原文为直接出一张杀〕',
    active: { needsTarget: true, oncePer: 'turn' },
    executeSkill: (state, self, action) => {
      if (action.targetId === undefined || action.targetId === self.id) throw new GameError('快枪：需要指定其他角色');
      const target = state.players[action.targetId - 1];
      if (!target?.alive) throw new GameError('快枪：目标已出局');
      pushLog(state, `【快枪】${playerLabel(state, self.id)} 直接狙击 ${playerLabel(state, target.id)}`);
      dealDamage(state, self.id, target.id, 1, 'sha');
    },
  },

  // ---------- 老尼（蜀·超级大虾，4 体力） ----------
  {
    id: 'ruanjiao',
    name: '软脚',
    desc: '受到伤害时获得 1 枚【软脚基因】；达 4 枚时弃 2 保 2，且出牌阶段被封印至其下次回合结束。〔原文含「对背身角色无法造成伤害」→ 见软脚·背身〕',
    onDamaged: (state, self) => {
      const c = state.deck.pop();
      if (!c) return;
      state.discard.push(c);
      addMark(self, 'gene');
      pushLog(state, `【软脚基因】${playerLabel(state, self.id)} +1（共 ${mark(self, 'gene')}）`);
      if (mark(self, 'gene') >= 4) {
        self.marks['gene'] = 2;
        self.playSealed = true;
        pushLog(state, `【软脚】触发：${playerLabel(state, self.id)} 弃 2 保 2，出牌阶段封印至其下次回合结束`);
      }
    },
  },
  {
    id: 'ruanjiao_back',
    name: '软脚·背身克制',
    desc: '对【背身】状态的角色无法造成伤害（联动车主·身法）。',
  },

  // ---------- 小孩（蜀·黄色闪电，3 体力） ----------
  {
    id: 'shandian',
    name: '闪电',
    desc: '出牌阶段限一次：弃一张【闪】，对一名角色使用最多两张无距离限制的【杀】（不占杀次数）。',
    active: { needsTarget: true, needsCard: 'shan', oncePer: 'turn' },
    executeSkill: (state, self, action) => {
      const idx = self.hand.findIndex((c) => c.uid === action.cardUid && c.defId === 'shan');
      if (idx < 0) throw new GameError('闪电：需要选择一张【闪】');
      const shan = self.hand.splice(idx, 1)[0];
      state.discard.push(shan);
      if (action.targetId === undefined) throw new GameError('闪电：需要指定目标');
      resolveLightningSha(state, self, action.targetId);
    },
  },
  {
    id: 'haishen',
    name: '海参',
    desc: '造成伤害时获得 1 枚【海参碎片】；达 3 枚后无法造成伤害，该回合弃牌阶段开始时全部回收为手牌。',
    onDamageDealt: (state, self, ctx) => {
      if (ctx.target === self.id) return;
      if (mark(self, 'haishen') >= 3) return;
      addMark(self, 'haishen');
      pushLog(state, `【海参碎片】${playerLabel(state, self.id)} +1（共 ${mark(self, 'haishen')}）`);
    },
    onDiscardStart: (state, self) => {
      const n = mark(self, 'haishen');
      if (n <= 0) return;
      self.marks['haishen'] = 0;
      let recovered = 0;
      for (let i = 0; i < n; i++) {
        const c = state.deck.pop();
        if (!c) break;
        self.hand.push(c);
        recovered += 1;
      }
      pushLog(state, `【海参】${playerLabel(state, self.id)} 回收 ${recovered} 枚碎片为手牌`);
    },
  },

  // ---------- 龙哥（蜀·飞龙在天，3 体力） ----------
  {
    id: 'feilong',
    name: '飞龙',
    desc: '若场上已死亡至少一名【蜀】阵营角色：摸牌阶段多摸 1、可多出一张【杀】、弃牌上限 +1。',
    onDrawBonus: (state) =>
      state.players.some((p) => !p.alive && state.characterDefs[p.characterId]?.faction === 'shu') ? 1 : 0,
    onShaLimitBonus: (state) =>
      state.players.some((p) => !p.alive && state.characterDefs[p.characterId]?.faction === 'shu') ? 1 : 0,
    onHandLimit: (state, self, base) =>
      state.players.some((p) => !p.alive && state.characterDefs[p.characterId]?.faction === 'shu') ? base + 1 : base,
  },

  // ---------- 嘉豪（蜀·豪情在天，3 体力） ----------
  {
    id: 'haoqing',
    name: '豪情',
    desc: '出牌阶段造成的单次伤害 ≥2 时摸 1 张牌，并自动对同一目标追加一张无距离限制的【杀】。〔每回合限一次〕',
    onDamageDealt: (state, self, ctx) => {
      if (ctx.amount < 2 || ctx.target === self.id) return;
      if (self.skillUsedTurn['haoqing']) return;
      self.skillUsedTurn['haoqing'] = true;
      const c = state.deck.pop();
      if (c) self.hand.push(c);
      pushLog(state, `【豪情】触发：${playerLabel(state, self.id)} 摸 1 张牌`);
      const sha = self.hand.find((card) => card.defId === 'sha');
      const target = state.players[ctx.target - 1];
      if (sha && target?.alive) {
        self.hand.splice(self.hand.indexOf(sha), 1);
        state.discard.push(sha);
        pushLog(state, `【豪情】${playerLabel(state, self.id)} 追加 [杀] → ${playerLabel(state, ctx.target)}`);
        resolveShaAgainst(state, self, target, sha, { ignoreDistance: true, noCount: true });
      }
    },
  },
  {
    id: 'jiuhen',
    name: '就很',
    desc: '弃牌阶段开始时若手牌数与场上任何一人都不相同，弃牌上限为 5；对【群】阵营角色造成伤害后自动弃其一张手牌。〔原文为可选择弃〕',
    onHandLimit: (state, self, base) => {
      const same = state.players.some((p) => p.alive && p.id !== self.id && p.hand.length === self.hand.length);
      return same ? base : Math.max(base, 5);
    },
    onDamageDealt: (state, self, ctx) => {
      if (ctx.target === self.id) return;
      const target = state.players[ctx.target - 1];
      if (!target?.alive) return;
      if (state.characterDefs[target.characterId]?.faction !== 'qun') return;
      if (target.hand.length > 0) {
        const pick = rngInt(state.rng, target.hand.length);
        state.rng = pick.next;
        const dropped = target.hand.splice(pick.value, 1)[0];
        state.discard.push(dropped);
        pushLog(state, `【就很】${playerLabel(state, self.id)} 弃掉 ${playerLabel(state, ctx.target)} 的 1 张手牌`);
      }
    },
  },

  // ---------- 大表猪（蜀·救护车主，4 体力） ----------
  {
    id: 'ruanqiang',
    name: '软枪',
    desc: '无法造成足以致死的伤害（受害者体力最低保留 1）；场上仅剩两名存活角色时此条无效。',
  },

  // ---------- 旧角色（保留） ----------
  {
    id: 'firepower',
    name: '火力全开',
    desc: '你造成的「杀」伤害 +1。',
    onModifyDamage: (ctx) => (ctx.cardId === 'sha' ? 1 : null),
  },
];

export const CHARACTERS: CharacterDef[] = [
  { id: 'meizi', name: '妹子', hp: 5, faction: 'wu', skills: ['yuying'], portrait: 'wu/01.png' },
  { id: 'doudou', name: '豆豆', hp: 4, faction: 'wu', skills: ['jiangshi'], portrait: 'wu/03.png' },
  { id: 'zaiwu', name: '载物', hp: 4, faction: 'wu', skills: ['shuaiju'], portrait: 'wu/05.png' },
  { id: 'chezhu', name: '车主', hp: 5, faction: 'wu', skills: ['shenfa', 'shenfa_guard', 'shenfa_fragile', 'paoche'], portrait: 'wu/07.png' },
  { id: 'huozai', name: '火仔', hp: 3, faction: 'wu', skills: ['yanfa', 'yanfa_save', 'tupo'], portrait: 'wu/09.png' },
  { id: 'zaizhong', name: '载种', hp: 3, faction: 'shen', skills: ['suotou', 'toushi'], portrait: 'shen/01.png' },
  { id: 'mangk', name: '莽K', hp: 4, faction: 'shen', skills: ['yingjing', 'kuaiqiang'], portrait: 'shen/03.png' },
  { id: 'laoni', name: '老尼', hp: 4, faction: 'shu', skills: ['ruanjiao', 'ruanjiao_back'], portrait: 'shu/01.png' },
  { id: 'xiaohai', name: '小孩', hp: 3, faction: 'shu', skills: ['shandian', 'haishen'], portrait: 'shu/03.png' },
  { id: 'longge', name: '龙哥', hp: 3, faction: 'shu', skills: ['feilong'], portrait: 'shu/05.png' },
  { id: 'jiahao', name: '嘉豪', hp: 3, faction: 'shu', skills: ['haoqing', 'jiuhen'], portrait: 'shu/07.png' },
  { id: 'dabiaozhu', name: '大表猪', hp: 4, faction: 'shu', skills: ['ruanqiang'], portrait: 'shu/09.png' },
  { id: 'rookie', name: '新兵', hp: 4, faction: 'wei', skills: [] },
  { id: 'gunner', name: '火力手', hp: 4, faction: 'wei', skills: ['firepower'] },
];

for (const skill of SKILLS) registerSkill(skill);
