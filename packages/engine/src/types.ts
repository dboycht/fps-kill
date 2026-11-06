import type { RngState } from './rng.ts';

export type PlayerId = number;

export type CardCategory = 'attack' | 'response' | 'restore';

export type Suit = 'spade' | 'club' | 'heart' | 'diamond';

export interface CardDef {
  id: string;
  name: string;
  category: CardCategory;
  desc: string;
}

/** 牌堆里的每张牌的唯一实例 */
export interface CardInstance {
  uid: number;
  defId: string;
  /** 花色/点数（来自实体牌堆；测试造牌可省略） */
  suit?: Suit;
  rank?: string;
}

export interface DamageContext {
  source: PlayerId;
  target: PlayerId;
  /** 造成伤害的牌；null 表示非牌类伤害 */
  cardId: string | null;
  /** 当前结算中的伤害值 */
  amount: number;
}

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  /**
   * 伤害修正钩子：返回伤害增量（null / 0 表示不修改）。
   * 进化方向：按需要增加更多事件钩子（摸牌、出牌阶段开始、濒死……）。
   */
  onModifyDamage?: (ctx: DamageContext, state: Readonly<GameState>) => number | null;
}

export interface CharacterDef {
  id: string;
  name: string;
  hp: number;
  /** 引用 SkillDef.id */
  skills: string[];
}

export interface PlayerState {
  id: PlayerId;
  characterId: string;
  hp: number;
  maxHp: number;
  hand: CardInstance[];
  alive: boolean;
}

export interface LogEntry {
  turn: number;
  text: string;
}

/**
 * 全量对局状态：可 JSON 序列化（技能函数不进 state，按 id 从注册表解析）。
 * reducer 输入 = state + action，输出 = 新 state；随机源内嵌（rng），同 seed 同轨迹。
 */
export interface GameState {
  version: 1;
  rng: RngState;
  cardDefs: Record<string, CardDef>;
  characterDefs: Record<string, CharacterDef>;
  players: PlayerState[];
  deck: CardInstance[];
  discard: CardInstance[];
  turn: number;
  active: PlayerId;
  /** 出牌阶段是否已用过「杀」（每回合限一次） */
  shotUsed: boolean;
  /** 僵局计数：连续无体力变化的已完成回合数 */
  stallTurns: number;
  /** 上一回合结束时的全场体力总和（僵局检测基线） */
  lastTotalHp: number;
  log: LogEntry[];
  /** null = 进行中 */
  winner: PlayerId | null;
  /** 对局是否已结束（含平局僵局判定） */
  over: boolean;
}

export type Action =
  | { type: 'PLAY_CARD'; player: PlayerId; cardUid: number; targetId?: PlayerId }
  | { type: 'END_TURN'; player: PlayerId };
