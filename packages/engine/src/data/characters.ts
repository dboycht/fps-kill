import { registerSkill } from '../skills.ts';
import type { CharacterDef, SkillDef } from '../types.ts';

/**
 * 角色与技能表。
 * 添加一个角色 = 在 CHARACTERS 加一条（id / name / hp / skills）。
 * 添加一个技能 = 在 SKILLS 加一条并实现钩子；技能通过 id 被角色引用。
 */

export const SKILLS: SkillDef[] = [
  {
    id: 'firepower',
    name: '火力全开',
    desc: '你造成的「射击」伤害 +1。',
    onModifyDamage: (ctx) => (ctx.cardId === 'shoot' ? 1 : null),
  },
];

export const CHARACTERS: CharacterDef[] = [
  { id: 'rookie', name: '新兵', hp: 4, skills: [] },
  { id: 'gunner', name: '火力手', hp: 4, skills: ['firepower'] },
];

for (const skill of SKILLS) registerSkill(skill);
