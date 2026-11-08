/**
 * 联机会话：mkx-link 客户端封装。
 *
 * - 固定加入房间 `fpskill`（服务器端权威 reducer 房间）。
 * - 服务器 state 到达有三条路：初见 `joined`（join.ok）、重连再入 `joined`、命令后 `update` ——
 *   两者统一汇入 applyState，客户端不持有任何对局真相。
 * - 断线重连（指数退避 + 自动再入房 + join.ok 全量恢复）由 mkx-link 负责。
 */

import { Link, type Room } from '@mkx/client';
import { seatOfPeer, type Action, type RoomState, type Seat } from '@fpskill/engine';

export const GAME_ROOM = 'fpskill';

export interface NetCallbacks {
  /** 服务器房间 state 到达（全量）。 */
  onRoomState: (rs: RoomState) => void;
  /** 连接状态一句话（渲染到联机面板）。 */
  onStatus: (text: string) => void;
  /** 值得 toast 的房间动态（进人/离人）。 */
  onNotice: (text: string) => void;
}

export class NetSession {
  private link: Link | null = null;
  private room: Room | null = null;
  private readonly cb: NetCallbacks;
  rs: RoomState | null = null;
  mySeat: Seat | null = null;

  constructor(cb: NetCallbacks) {
    this.cb = cb;
  }

  get connected(): boolean {
    return this.room !== null;
  }

  async connect(url: string, name: string): Promise<void> {
    this.disconnect();
    // sessionId 按标签页持久（sessionStorage）：刷新页面自动续座；新标签 = 新玩家
    let sid = sessionStorage.getItem('fpskill.sid');
    if (!sid) {
      sid = 'tab-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('fpskill.sid', sid);
    }
    const link = new Link({ url, name, sessionId: sid });
    this.cb.onStatus('连接中…');
    await link.connect();
    const room = await link.join(GAME_ROOM, { name });
    this.link = link;
    this.room = room;
    room.on('update', (state) => this.applyState(state));
    room.on('peerJoin', (peer) => this.cb.onNotice(`${peer.name ?? '有人'} 进入了房间`));
    room.on('peerLeave', (peer, reason) => this.cb.onNotice(`${peer.name ?? '有人'} 离开了（${reason}）`));
    // join.ok（初见与重连再入都走这里）带全量 state
    link.on('joined', (event) => {
      if (event.room === GAME_ROOM) {
        this.applyState(event.state);
        this.cb.onStatus('已连接');
      }
    });
    link.on('error', (event) => this.cb.onNotice(`服务器拒绝：${event.message || event.code}`));
    link.on('disconnected', (event) => {
      if (event.willReconnect) this.cb.onStatus('连接断开，正在重连…');
    });
    this.applyState(room.state);
    this.cb.onStatus('已连接');
  }

  disconnect(): void {
    this.link?.dispose();
    this.link = null;
    this.room = null;
    this.rs = null;
    this.mySeat = null;
  }

  private applyState(raw: unknown): void {
    if (raw === null || raw === undefined || typeof raw !== 'object') return;
    const rs = raw as RoomState;
    if (rs.seats === undefined || rs.phase === undefined) return;
    this.rs = rs;
    this.mySeat = this.computeMySeat(rs);
    this.cb.onRoomState(rs);
  }

  /** 座位绑定键 = 我这个 peer 的 session（服务器同款），重连后 pid 变但 session 不变 */
  private computeMySeat(rs: RoomState): Seat | null {
    const room = this.room;
    if (room === null) return null;
    const pid = room.myPeerId;
    if (pid === undefined) return null;
    const mine = room.peers.get(pid);
    const key = mine?.session ?? pid;
    return seatOfPeer(rs, key);
  }

  /** 我的 peer 绑定键（session 优先）；用于房主判定 */
  myPeerKey(): string | undefined {
    const room = this.room;
    if (room === null) return undefined;
    const pid = room.myPeerId;
    if (pid === undefined) return undefined;
    return room.peers.get(pid)?.session ?? pid;
  }

  sit(name: string): void {
    this.room?.send('game.sit', { name });
  }

  config(capacity: number): void {
    this.room?.send('game.config', { capacity });
  }

  skill(skillId: string, cardUid?: number, targetId?: number): void {
    this.room?.send('game.skill', {
      type: 'SKILL',
      skillId,
      ...(cardUid !== undefined ? { cardUid } : {}),
      ...(targetId !== undefined ? { targetId } : {}),
    });
  }

  start(seed: number | null): void {
    this.room?.send('game.start', seed !== null ? { seed } : {});
  }

  restart(seed: number | null): void {
    this.room?.send('game.restart', seed !== null ? { seed } : {});
  }

  action(action: Action): void {
    this.room?.send('game.action', { action });
  }

  bot(): void {
    this.room?.send('game.bot', {});
  }

  reset(): void {
    this.room?.send('game.reset', {});
  }
}
