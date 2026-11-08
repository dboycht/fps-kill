/**
 * 联机端到端验证（真实 WebSocket → 真实服务器）· 1.1.0 多人版：
 *   1. 房主连接 → 配置 3 人房 → 三客户端落座
 *   2. 非房主开局被拒；房主开局（seed=7）→ 随机发放 3 名不重复武将
 *   3. 三方轮流 game.bot 把一整局打完（环形距离生效）
 *   4. 三客户端终局 state 一致
 *   5. B 断线重连（同 sessionId）→ 座位保持、全量恢复
 *   6. 房主重开一局（game.restart）成功
 * 前置：pnpm server 已在本机运行（默认连 7123，可用 FPSKILL_E2E_PORT 指定）。
 */
import { Link } from '../web/node_modules/@mkx/client/dist/index.js';
import assert from 'node:assert/strict';

const URL = `ws://127.0.0.1:${process.env.FPSKILL_E2E_PORT ?? 7123}/ws`;
const ROOM = 'fpskill';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function currentOf(link) {
  const room = link.client.rooms.get(ROOM);
  return room ? room.state : undefined;
}

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

const host = new Link({ url: URL, name: '房主', sessionId: 'e2e-host' });
await host.connect();
const b = new Link({ url: URL, name: '乙', sessionId: 'e2e-b' });
await b.connect();
const c = new Link({ url: URL, name: '丙', sessionId: 'e2e-c' });
await c.connect();
console.log('1. 三客户端已连接');

const rh = await host.join(ROOM);
const rb = await b.join(ROOM);
const rc = await c.join(ROOM);
rh.send('game.reset', {});
await waitFor(host, (s) => s && s.phase === 'lobby' && !s.seats[1], 'clean lobby');

// 房主先落座（成为房主），配置 3 人，其余落座
rh.send('game.sit', { name: '房主' });
await waitFor(host, (s) => Boolean(s.seats[1]), 'host seated');
rh.send('game.config', { capacity: 3 });
rb.send('game.sit', { name: '乙' });
rc.send('game.sit', { name: '丙' });
const seated = await waitFor(host, (s) => s.capacity === 3 && s.seats[1] && s.seats[2] && s.seats[3], 'all seated');
console.log('2. 3 人房配置与落座完成:', JSON.stringify(seated.names));

// 非房主开局被拒
rb.send('game.start', { seed: 7 });
await sleep(300);
assert.equal(currentOf(host).phase, 'lobby', '非房主开局应被拒');

rh.send('game.start', { seed: 7 });
let st = await waitFor(host, (s) => s && s.phase === 'playing' && s.game, 'game started');
const heroIds = st.game.players.map((p) => p.characterId);
assert.equal(new Set(heroIds).size, 3, '武将不重复');
console.log('3. 房主开局 seed=7，随机武将:', heroIds.join('/'));

let guard = 0;
while (!st.game.over && guard < 900) {
  guard += 1;
  const active = st.game.active;
  const room = active === 1 ? rh : active === 2 ? rb : rc;
  room.send('game.bot', {});
  st = await waitFor(
    host,
    (s) => s && s.game && (s.game.over || s.game.active !== active),
    'turn ' + guard,
  );
  if (guard % 30 === 0) console.log(`  [pace] turn=${st.game.turn} round=${st.game.round}`);
  await sleep(20);
}
assert.ok(st.game.over, '对局应打完');
console.log(`4. 三人局打完：turn=${st.game.turn} round=${st.game.round} winner=${st.game.winner} bot命令数=${guard}`);

for (const [label, link] of [['乙', b], ['丙', c]]) {
  const view = currentOf(link);
  assert.equal(JSON.stringify(view.game), JSON.stringify(st.game), `${label} 终局 state 应一致`);
}
console.log('5. 三客户端终局 state 逐字节一致');

// 断线重连：同 sessionId → 座位保持 + 全量恢复
b.dispose();
await sleep(300);
const b2 = new Link({ url: URL, name: '乙', sessionId: 'e2e-b' });
await b2.connect();
const rb2 = await b2.join(ROOM);
const resumed = await waitFor(b2, (s) => s && s.game && s.game.over, 'resumed state');
assert.equal(JSON.stringify(resumed.game), JSON.stringify(st.game), '重连后 state 应全量恢复');
const kept = Object.entries(resumed.seats).find(([, k]) => k === 'e2e-b');
assert.ok(kept, '重连后应保持座位（session 稳定绑定）');
console.log(`6. 断线重连：新 pid=${rb2.myPeerId ?? '?'}，座位${kept[0]} 经 session 保持`);

// 房主重开
rh.send('game.restart', { seed: 9 });
const again = await waitFor(host, (s) => s && s.phase === 'playing' && s.game && s.game.turn === 1, 'restart');
assert.equal(again.seed, 9);
assert.equal(again.game.players.length, 3);
console.log('7. 房主重开一局成功（seed=9，仍 3 人）');

host.dispose();
b2.dispose();
c.dispose();
await sleep(200);
console.log('E2E ALL PASS');
process.exit(0);
