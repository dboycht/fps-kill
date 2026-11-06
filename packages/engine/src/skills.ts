import type { SkillDef } from './types.ts';

/**
 * 技能注册表：技能 = 数据 + 函数钩子，按 id 注册与解析。
 * 添加新技能 = 在 data/characters.ts 里定义并注册，不改引擎核心。
 */

const registry = new Map<string, SkillDef>();

export function registerSkill(def: SkillDef): void {
  if (registry.has(def.id)) throw new Error(`技能 id 重复：${def.id}`);
  registry.set(def.id, def);
}

export function getSkill(id: string): SkillDef | undefined {
  return registry.get(id);
}
