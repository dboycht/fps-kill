/**
 * FPS杀 联机服务器 = mkx-link 中继 + 权威对局房间 + 静态托管游戏页（一个端口）。
 *
 * 用法：node apps/server/src/main.ts [--port 7000] [--host 0.0.0.0]
 * 局域网玩家开 http://<本机IP>:<port>/ 即玩；隧道玩法见 mkx-link docs/TUNNELING.md。
 * 服务器无持久化：进程重启 = 房间清空（与 mkx-link 一致）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RelayServer } from '@mkx/server';
import { GAME_ROOM, gameRoom } from './room.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg !== undefined && arg.startsWith('--') && arg !== '--') {
    const next = process.argv[i + 1];
    args.set(arg.slice(2), next !== undefined && !next.startsWith('--') ? next : '');
  }
}

const port = Number(args.get('port') ?? '') || 7000;
const host = args.get('host') || '0.0.0.0';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

const distDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
const staticDir = existsSync(distDir) ? distDir : undefined;

const relay = new RelayServer({
  host,
  port,
  version: pkg.version,
  ...(staticDir !== undefined ? { staticDir } : {}),
  link: { rooms: { [GAME_ROOM]: gameRoom } },
});

await relay.start();

const lanAddresses: string[] = [];
for (const list of Object.values(networkInterfaces())) {
  for (const entry of list ?? []) {
    if (entry.family === 'IPv4' && !entry.internal) lanAddresses.push(entry.address);
  }
}
const pageHost = host === '0.0.0.0' || host === '::' ? null : host;

const lines = [
  `FPS杀 联机服务器 v${pkg.version}`,
  `  ws:   ${relay.wsUrl}`,
  `  房间: ${GAME_ROOM}（权威 reducer 房间；手牌荣誉制，详见 README）`,
];
if (staticDir !== undefined) {
  const pageUrls = (pageHost !== null ? [`http://${pageHost}:${relay.port}/`] : []).concat(
    lanAddresses.map((ip) => `http://${ip}:${relay.port}/`),
  );
  for (const url of pageUrls) lines.push(`  页面: ${url}`);
} else {
  lines.push('  ⚠ 未找到 apps/web/dist —— 游戏页未托管；先跑 pnpm web:build 再重启可获得页面托管');
}
process.stdout.write(lines.join('\n') + '\n');

const shutdown = (signal: string): void => {
  process.stdout.write(`\n${signal} received, shutting down\n`);
  void relay.stop().then(() => {
    process.exitCode = 0;
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
