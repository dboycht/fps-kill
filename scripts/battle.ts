import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playerLabel, renderLog, runBattle } from '../packages/engine/src/index.ts';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version: string };

function argNumber(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  const parsed = hit !== undefined ? Number(hit.slice(prefix.length)) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

const baseSeed = argNumber('seed', 42);
const games = Math.max(1, argNumber('games', 3));

console.log(`FPS杀 自动对局演示 v${pkg.version}`);
const outDir = join(rootDir, 'logs', 'demo');
mkdirSync(outDir, { recursive: true });

for (let i = 0; i < games; i++) {
  const seed = baseSeed + i;
  const { final, steps } = runBattle(seed);
  const winner = final.winner !== null ? playerLabel(final, final.winner) : '无';
  console.log(`对局 ${i + 1}｜seed=${seed} → 胜者 ${winner}｜${final.turn} 回合 / ${steps} 步`);
  writeFileSync(join(outDir, `battle-${seed}.log`), renderLog(final), 'utf8');
  writeFileSync(
    join(outDir, `battle-${seed}.json`),
    JSON.stringify({ seed, winner: final.winner, turns: final.turn, steps, log: final.log }, null, 2),
    'utf8',
  );
}
console.log(`回放目录：${outDir}`);
