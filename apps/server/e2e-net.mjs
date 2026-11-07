/**
 * 联机端到端验证（真实 WebSocket → 真实服务器）：
 *   1. 双客户端连接、落座、开局（seed=7）
 *   2. 双方轮流 game.bot 把一整局打完
 *   3. 双客户端最终 state 一致（全量快照一致性）
 *   4. B 断线重连（同 sessionId）→ 座位保持、全量恢复
 *   5. game.reset 回大厅后可重新开局
 * 前置：pnpm server 已在本机运行（默认连 7123，可用 FPSKILL_E2E_PORT 指定）。
 */
import { Link } from '../web/node_modules/@mkx/client/dist/index.js';
import assert from 'node:assert/strict';

const URL = `ws://127.0.0.1:${process.env.FPSKILL_E2E_PORT ?? 7123}/ws`;
const ROOM = 'fpskill';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等到 room state 满足 pred（订阅 update + joined 两条到达路径） */
function waitFor(link, pred, label, timeoutMs = 15000) {
  const immediate = currentOf(link);
  if (pred(immediate)) return Promise.resolve(immediate);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout: ' + label));
    }, timeoutMs);
    const off1 = link.client.on('update', tryIt);
    const off2 = link.client.on('joined', tryIt);
    function tryIt(event) {
      if (pred(event.state)) {
        cleanup();
        resolve(event.state);
      }
    }
    function cleanup() {
      clearTimeout(timer);
      off1();
      off2();
    }
  });
}

function currentOf(link) {
  const room = link.client.rooms.get(ROOM);
  return room ? room.state : undefined;
}

const a = new Link({ url: URL, name: '甲', sessionId: 'e2e-a' });
await a.connect();
const b = new Link({ url: URL, name: '乙', sessionId: 'e2e-b' });
await b.connect();
console.log('1. 双客户端已连接');

const ra = await a.join(ROOM);
const rb = await b.join(ROOM);
ra.send('game.reset', {});
await waitFor(a, (s) => s && s.phase === 'lobby' && s.seats[1] === null && s.seats[2] === null, 'clean lobby');
ra.send('game.sit', { name: '甲' });
rb.send('game.sit', { name: '乙' });
const seated = await waitFor(a, (s) => Boolean(s && s.seats[1] && s.seats[2]), 'both seated');
assert.equal(seated.names[1], '甲');
console.log('2. 落座完成:', JSON.stringify(seated.names));

ra.send('game.start', { seed: 7 });
let st = await waitFor(a, (s) => s && s.phase === 'playing' && s.game, 'game started');
console.log('3. 开局 seed=7，active=', st.game.active);

let guard = 0;
for (const [label, link] of [['A', a], ['B', b]]) {
  link.client.on('error', (e) => console.log(`  [diag ${label}] error:`, JSON.stringify(e)));
  link.client.on('disconnected', (e) => console.log(`  [diag ${label}] disconnected:`, JSON.stringify(e)));
  link.client.on('bye', (e) => console.log(`  [diag ${label}] bye:`, JSON.stringify(e)));
  link.client.on('peerLeave', (e) => console.log(`  [diag ${label}] peerLeave:`, JSON.stringify(e)));
}
while (!st.game.over && guard < 400) {
  guard += 1;
  const active = st.game.active;
  (active === 1 ? ra : rb).send('game.bot', {});
  st = await waitFor(
    a,
    (s) => s && s.game && (s.game.over || s.game.active !== active),
    'turn ' + guard,
  );
  if (guard % 25 === 0) {
    console.log(`  [pace] turn=${st.game.turn} seqA=${a.client.rooms.get(ROOM)?.seq} seqB=${currentOf(b)?.seq ?? b.client.rooms.get(ROOM)?.seq}`);
  }
  await sleep(20);
}
assert.ok(st.game.over, '对局应打完');
assert.ok(st.game.turn > 1, '应有多个回合');
console.log(`4. 对局打完：turn=${st.game.turn} winner=${st.game.winner} bot命令数=${guard}`);

const viewB = currentOf(b);
assert.equal(JSON.stringify(viewB.game), JSON.stringify(st.game), '两客户端终局 state 应一致');
console.log('5. 双客户端终局 state 逐字节一致');

// 断线重连：同 sessionId → 座位保持（绑定键 = session）+ 全量恢复
b.dispose();
await sleep(300);
const b2 = new Link({ url: URL, name: '乙', sessionId: 'e2e-b' });
await b2.connect();
const rb2 = await b2.join(ROOM);
const resumed = await waitFor(b2, (s) => s && s.game && s.game.over, 'resumed state');
assert.equal(JSON.stringify(resumed.game), JSON.stringify(st.game), '重连后 state 应全量恢复');
const myPid2 = rb2.myPeerId;
assert.notEqual(myPid2, undefined, '重连后应有新 peer id');
const keptSeat = resumed.seats[1] === 'e2e-b' ? 1 : resumed.seats[2] === 'e2e-b' ? 2 : null;
assert.equal(keptSeat, 2, '重连后应保持座位2（session 稳定绑定）');
console.log(`6. 断线重连：新 pid=${myPid2}，座位2 经 session=e2e-b 保持，state 全量恢复`);

// 重置回大厅并重开
ra.send('game.reset', {});
const lobby = await waitFor(a, (s) => s && s.phase === 'lobby' && s.seats[1] === null, 'reset lobby');
ra.send('game.sit', { name: '甲' });
rb2.send('game.sit', { name: '乙' });
await waitFor(a, (s) => Boolean(s && s.seats[1] && s.seats[2]), 're-seat');
ra.send('game.start', { seed: 9 });
const again = await waitFor(a, (s) => s && s.phase === 'playing' && s.game && s.game.turn === 1, 'restart');
assert.equal(again.seed, 9);
console.log('7. 重置房间后重新开局成功（seed=9）');

a.dispose();
b2.dispose();
await sleep(200);
console.log('E2E ALL PASS');
process.exit(0);
