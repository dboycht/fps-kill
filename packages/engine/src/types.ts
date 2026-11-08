import type { RngState } from './rng.ts';

export type PlayerId = number;

export type CardCategory = 'attack' | 'response' | 'restore' | 'instant' | 'trick';

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
  /** 攻击距离加成（杀 / 拿来吧你 的距离判定） */
  attackRangeBonus?: number;
  /** 本回合可出「杀」的额外次数 */
  onShaLimitBonus?: (state: Readonly<GameState>, self: Readonly<PlayerState>) => number;
  /** 摸牌阶段的额外摸牌数 */
  onDrawBonus?: (state: Readonly<GameState>, self: Readonly<PlayerState>) => number;
  /** 弃牌阶段手牌上限 override（返回最终上限） */
  onHandLimit?: (state: Readonly<GameState>, self: Readonly<PlayerState>, base: number) => number;
  /** 打出「闪」是否生效（false = 判定失败 / 无效） */
  onDodgeCheck?: (state: Readonly<GameState>, self: Readonly<PlayerState>) => boolean;
  /** 「杀」是否不可被闪抵消（载种·锁头：红杀） */
  onShaUnblockable?: (state: Readonly<GameState>, source: Readonly<PlayerState>, card: Readonly<CardInstance>) => boolean;
  /** 受到的伤害修正（车主·正面：+1） */
  onIncomingDamageModify?: (state: Readonly<GameState>, self: Readonly<PlayerState>, amount: number) => number;
  /** 受到伤害后（火仔·芯片 / 老尼·软脚基因） */
  onDamaged?: (state: GameState, self: PlayerState, ctx: DamageContext) => void;
  /** 造成伤害后（海參碎片 / 豪情 / 就很 / 突破首伤 / 载物甩狙） */
  onDamageDealt?: (state: GameState, self: PlayerState, ctx: DamageContext) => void;
  /** 回合开始时的自动效果 */
  onTurnStart?: (state: GameState, self: PlayerState) => void;
  /** 摸牌阶段结束后的自动效果（身法判定 / 鹰精 / 飞龙计牌） */
  onDrawEnd?: (state: GameState, self: PlayerState) => void;
  /** 弃牌阶段开始时的自动效果（海參回收） */
  onDiscardStart?: (state: GameState, self: PlayerState) => void;
  /** 主动技：在自己回合内由玩家点按发动 */
  active?: {
    /** 发动需要：目标 / 手牌 */
    needsTarget?: boolean;
    needsCard?: 'red' | 'shan';
    /** 限用频率 */
    oncePer: 'turn' | 'round';
  };
  /** 主动技结算 */
  executeSkill?: (state: GameState, self: PlayerState, action: Extract<Action, { type: 'SKILL' }>) => void;
}

export interface CharacterDef {
  id: string;
  name: string;
  hp: number;
  /** 阵营（wu / shen / shu / qun / wei），用于阵营类技能 */
  faction: string;
  /** 引用 SkillDef.id */
  skills: string[];
  /** 立绘文件（apps/web 渲染用；引擎不依赖） */
  portrait?: string;
}

export interface PlayerState {
  id: PlayerId;
  characterId: string;
  hp: number;
  maxHp: number;
  hand: CardInstance[];
  alive: boolean;
  /** 本回合是否已用过【酒】（每回合限一次；回合开始重置） */
  jiuUsed: boolean;
  /** 【完美服务器】的抵消护盾：抵消下一次以该玩家为目标的道具牌（一次性） */
  perfectShield: boolean;
  /** 技能标记通用容器（芯片/海参碎片/软脚基因…），键 = 标记名，值 = 数量 */
  marks: Record<string, number>;
  /** 主动技限用记录（键 = skillId），回合开始清 turn 部分、轮开始清 round 部分 */
  skillUsedTurn: Record<string, boolean>;
  skillUsedRound: Record<string, boolean>;
  /** 车主·身法身位：back（背身）= 闪必成；front（正面）= 受伤 +1 */
  posture?: 'back' | 'front';
  /** 老尼·软脚触发后的出牌封印（直到其下次回合结束） */
  playSealed?: boolean;
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
  /** 轮次：所有玩家各行动一次为一轮（roundStartPlayer 再次行动时 +1） */
  round: number;
  active: PlayerId;
  /** 本轮首个行动的玩家（判定一轮的边界） */
  roundStartPlayer: PlayerId;
  /** 本回合已出「杀」次数（上限 = 1 + 技能加成） */
  shaUsed: number;
  /** 僵局计数：连续无体力变化的已完成回合数 */
  stallTurns: number;
  /** 上一回合结束时的全场体力总和（僵局检测基线） */
  lastTotalHp: number;
  /** 本轮是否已有人造成过伤害（火仔·突破） */
  roundFirstDamage: boolean;
  log: LogEntry[];
  /** null = 进行中 */
  winner: PlayerId | null;
  /** 对局是否已结束（含平局僵局判定） */
  over: boolean;
}

export type Action =
  | { type: 'PLAY_CARD'; player: PlayerId; cardUid: number; targetId?: PlayerId }
  | { type: 'END_TURN'; player: PlayerId }
  | { type: 'SKILL'; player: PlayerId; skillId: string; cardUid?: number; targetId?: PlayerId };

export type PlayerMark = string;
