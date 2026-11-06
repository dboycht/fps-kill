import {
  GameError,
  newGame,
  reduce,
  decideAction,
  type Action,
  type CardInstance,
  type GameState,
  type PlayerId,
} from '@fpskill/engine';

declare const __APP_VERSION__: string;

interface CardManifestEntry {
  file: string;
  type: string;
  defId: string | null;
  name: string;
  suit: string;
  rank: string;
}
interface CharManifestEntry {
  file: string;
  faction: string;
  factionName: string;
  code: string;
  skin: string;
  nick: string;
  original: string;
}
interface EquipManifestEntry {
  id: string;
  file: string | null;
  name: string;
  suit: string;
  rank: string;
  attackRange: number | null;
  distance: number | null;
  description: string;
  quote: string;
}

const SUIT_TEXT: Record<string, { symbol: string; red: boolean }> = {
  spade: { symbol: '\u2660', red: false },
  club: { symbol: '\u2663', red: false },
  heart: { symbol: '\u2665', red: true },
  diamond: { symbol: '\u2666', red: true },
};

let cardsManifest: CardManifestEntry[] = [];
let charsManifest: CharManifestEntry[] = [];
let equipManifest: EquipManifestEntry[] = [];
const cardImage = new Map<string, CardManifestEntry>();

let state: GameState;
let selectedUid: number | null = null;
let galleryBuilt = false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error('missing #' + id);
  return node;
}

async function boot(): Promise<void> {
  const [cards, chars, equip] = await Promise.all([
    fetch('/cards-manifest.json').then((r) => r.json() as Promise<CardManifestEntry[]>),
    fetch('/characters-manifest.json').then((r) => r.json() as Promise<CharManifestEntry[]>),
    fetch('/equipment-manifest.json').then((r) => r.json() as Promise<EquipManifestEntry[]>),
  ]);
  cardsManifest = cards;
  charsManifest = chars;
  equipManifest = equip;
  for (const c of cards) cardImage.set(`${c.type}.${c.suit}.${c.rank}`, c);

  byId('version').textContent = 'v' + __APP_VERSION__;
  byId('tab-battle-btn').addEventListener('click', () => switchTab('battle'));
  byId('tab-gallery-btn').addEventListener('click', () => switchTab('gallery'));
  byId('btn-end').addEventListener('click', () => act({ type: 'END_TURN', player: state.active }));
  byId('btn-bot').addEventListener('click', botTurn);
  byId('btn-new').addEventListener('click', restart);
  byId('seed-input').addEventListener('change', restart);
  byId('hand').addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest('.card');
    if (!(target instanceof HTMLElement) || target.dataset.uid === undefined) return;
    onCardClick(Number(target.dataset.uid));
  });
  byId('players').addEventListener('click', (ev) => {
    const panel = (ev.target as HTMLElement).closest('.player');
    if (!(panel instanceof HTMLElement) || panel.dataset.pid === undefined) return;
    onPlayerClick(Number(panel.dataset.pid));
  });

  restart();
}

function switchTab(t: 'battle' | 'gallery'): void {
  const battle = t === 'battle';
  byId('tab-battle').toggleAttribute('hidden', !battle);
  byId('tab-gallery').toggleAttribute('hidden', battle);
  byId('tab-battle-btn').classList.toggle('active', battle);
  byId('tab-gallery-btn').classList.toggle('active', !battle);
  if (!battle && !galleryBuilt) {
    buildGallery();
    galleryBuilt = true;
  }
}

function restart(): void {
  const input = byId('seed-input') as HTMLInputElement;
  const parsed = Math.floor(Number(input.value));
  const seed = Number.isFinite(parsed) && parsed >= 1 ? parsed : Math.floor(Math.random() * 90000) + 1000;
  input.value = String(seed);
  state = newGame({ seed });
  selectedUid = null;
  render();
}

function act(action: Action): void {
  try {
    state = reduce(state, action);
    if (action.type === 'PLAY_CARD') selectedUid = null;
  } catch (e) {
    toast(e instanceof GameError ? e.message : String(e));
  }
  render();
}

function onCardClick(uid: number): void {
  if (state.over) return;
  const card = state.players[state.active - 1].hand.find((c) => c.uid === uid);
  if (!card) return;
  const def = state.cardDefs[card.defId];
  if (def.category === 'response') {
    toast(def.name + ' 只能自动响应「杀」，不能主动打出');
    return;
  }
  if (def.category === 'restore') {
    act({ type: 'PLAY_CARD', player: state.active, cardUid: uid });
    return;
  }
  // attack：选中进入指定目标模式
  selectedUid = selectedUid === uid ? null : uid;
  render();
}

function onPlayerClick(pid: PlayerId): void {
  if (selectedUid === null || state.over) return;
  if (pid === state.active) return;
  act({ type: 'PLAY_CARD', player: state.active, cardUid: selectedUid, targetId: pid });
}

function botTurn(): void {
  if (state.over) return;
  const startActive = state.active;
  let guard = 0;
  while (!state.over && state.active === startActive && guard < 60) {
    state = reduce(state, decideAction(state));
    guard += 1;
  }
  render();
}

// ---------- render ----------

function render(): void {
  renderMeta();
  renderPlayers();
  renderHand();
  renderPiles();
  renderLog();
  renderOverlay();
}

function seedOf(): string {
  return (byId('seed-input') as HTMLInputElement).value;
}

function renderMeta(): void {
  byId('meta').textContent = `${state.over ? '对局结束' : '进行中'}｜回合 ${state.turn}｜seed ${seedOf()}`;
}

function renderPlayers(): void {
  const wrap = byId('players');
  wrap.innerHTML = '';
  for (const p of state.players) {
    const def = state.characterDefs[p.characterId];
    const panel = el('div', 'player' + (p.alive ? '' : ' dead'));
    panel.dataset.pid = String(p.id);
    const activeMark = p.id === state.active && !state.over ? ' ▶ 当前回合' : '';
    panel.appendChild(el('div', 'player-head', `玩家${p.id} · ${def.name}`));
    const hp = el('div', 'hp');
    for (let i = 0; i < p.maxHp; i++) hp.appendChild(el('span', 'hp-cell' + (i < p.hp ? ' full' : '')));
    panel.appendChild(hp);
    panel.appendChild(el('div', 'player-info muted', `手牌 ${p.hand.length} 张${activeMark}${p.alive ? '' : ' · 出局'}`));
    if (selectedUid !== null && p.id !== state.active && p.alive) panel.classList.add('targetable');
    wrap.appendChild(panel);
  }
}

function renderHand(): void {
  const active = state.players[state.active - 1];
  const def = state.characterDefs[active.characterId];
  byId('hand-title').textContent = state.over
    ? '对局已结束'
    : `你的手牌 —— 玩家${active.id}(${def.name})`;
  const hint = byId('hint');
  if (state.over) {
    hint.textContent = '';
  } else if (selectedUid !== null) {
    hint.textContent = '已选「杀」：点击对方玩家面板出牌；再点一次取消。';
  } else {
    hint.textContent = '点「杀」选目标，点「桃」直接回血，「闪」只能自动响应。也可 Bot 代打。';
  }
  const hand = byId('hand');
  hand.innerHTML = '';
  if (state.over) {
    hand.appendChild(el('div', 'muted', '——'));
    return;
  }
  for (const c of active.hand) {
    const card = buildCardEl(c);
    card.dataset.uid = String(c.uid);
    hand.appendChild(card);
  }
}

function buildCardEl(c: CardInstance): HTMLDivElement {
  const def = state.cardDefs[c.defId];
  const card = document.createElement('div');
  card.className = 'card' + (def.category === 'response' ? ' response' : '');
  const entry = c.suit && c.rank ? cardImage.get(`${c.defId}.${c.suit}.${c.rank}`) : undefined;
  if (entry) {
    const img = document.createElement('img');
    img.src = '/cards/' + entry.file;
    img.alt = def.name;
    img.draggable = false;
    card.appendChild(img);
  } else {
    card.classList.add('no-art');
    card.appendChild(el('div', 'no-art-name', def.name));
  }
  const suitText = c.suit ? SUIT_TEXT[c.suit] : undefined;
  const badgeText = suitText && c.rank ? `${suitText.symbol}${c.rank}` : '?';
  card.appendChild(el('span', 'badge' + (suitText?.red ? ' red' : ''), badgeText));
  card.appendChild(el('span', 'tag', def.name));
  if (selectedUid === c.uid) card.classList.add('selected');
  return card;
}

function renderPiles(): void {
  byId('piles').textContent = `牌堆 ${state.deck.length} 张｜弃牌堆 ${state.discard.length} 张｜僵局计数 ${state.stallTurns}/40`;
}

function renderLog(): void {
  const log = byId('log');
  log.innerHTML = '';
  const view = state.log.slice(-250);
  for (const entry of view) {
    const line = el(
      'div',
      'log-line' + (entry.text.includes('\u3010') ? ' skill' : ''),
      `T${entry.turn}  ${entry.text}`,
    );
    if (entry.text.includes('对局结束') || entry.text.includes('僵局') || entry.text.includes('回合上限')) {
      line.classList.add('end');
    }
    log.appendChild(line);
  }
  log.scrollTop = log.scrollHeight;
}

function renderOverlay(): void {
  const overlay = byId('overlay');
  if (!state.over) {
    overlay.setAttribute('hidden', '');
    return;
  }
  overlay.innerHTML = '';
  const box = el('div', 'overlay-box');
  box.appendChild(
    el('h2', '', state.winner !== null ? `${playerLabelOf(state.winner)} 获胜！` : '平局（僵局/回合上限）'),
  );
  const again = el('button', '', '再来一局（新 seed）');
  again.addEventListener('click', () => {
    (byId('seed-input') as HTMLInputElement).value = '';
    restart();
  });
  const close = el('button', 'ghost', '查看终局面板');
  close.addEventListener('click', () => overlay.setAttribute('hidden', ''));
  box.append(again, close);
  overlay.appendChild(box);
  overlay.removeAttribute('hidden');
}

function playerLabelOf(id: PlayerId): string {
  const p = state.players[id - 1];
  return `玩家${p.id}(${state.characterDefs[p.characterId].name})`;
}

// ---------- gallery ----------

function buildGallery(): void {
  const root = byId('tab-gallery');
  root.innerHTML = '';

  const cardSec = el('section', 'gallery-sec');
  cardSec.appendChild(
    el('h2', '', `手牌图鉴（${cardsManifest.length} 张，已实装 ${cardsManifest.filter((c) => c.defId !== null).length} 张）`),
  );
  const cardGrid = el('div', 'gallery-grid');
  for (const c of cardsManifest) {
    const item = el('div', 'g-item' + (c.defId === null ? ' pending' : ''));
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = '/cards/' + c.file;
    img.alt = c.name;
    item.appendChild(img);
    const suitText = SUIT_TEXT[c.suit];
    item.appendChild(
      el('div', 'g-label', `${c.name} ${suitText.symbol}${c.rank}` + (c.defId === null ? '｜待实装' : '')),
    );
    cardGrid.appendChild(item);
  }
  cardSec.appendChild(cardGrid);
  root.appendChild(cardSec);

  const charSec = el('section', 'gallery-sec');
  charSec.appendChild(el('h2', '', `武将立绘（${charsManifest.length} 张，机制待定义）`));
  const charGrid = el('div', 'gallery-grid');
  for (const ch of charsManifest) {
    const item = el('div', 'g-item');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = '/characters/' + ch.file;
    img.alt = ch.skin;
    item.appendChild(img);
    item.appendChild(el('div', 'g-label', `${ch.factionName}｜${ch.skin}·${ch.nick}`));
    charGrid.appendChild(item);
  }
  charSec.appendChild(charGrid);
  root.appendChild(charSec);

  const equipSec = el('section', 'gallery-sec');
  equipSec.appendChild(el('h2', '', `装备（${equipManifest.length} 件，机制待实装）`));
  const equipGrid = el('div', 'gallery-grid equip');
  for (const e of equipManifest) {
    const item = el('div', 'g-item equip-item' + (e.file === null ? ' pending' : ''));
    if (e.file !== null) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = '/equipment/' + e.file;
      img.alt = e.name;
      item.appendChild(img);
    }
    const suitText = SUIT_TEXT[e.suit];
    item.appendChild(
      el('div', 'g-label', `${e.name} ${suitText.symbol}${e.rank}｜射程 ${e.attackRange ?? '?'}｜距离 ${e.distance ?? '?'}`),
    );
    const desc = el('div', 'g-desc');
    desc.innerHTML = e.description; // 素材自带文案（含 <b> 等标记）
    item.appendChild(desc);
    if (e.quote) item.appendChild(el('div', 'g-quote muted', e.quote));
    equipGrid.appendChild(item);
  }
  equipSec.appendChild(equipGrid);
  root.appendChild(equipSec);
}

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  const node = byId('toast');
  node.textContent = msg;
  node.removeAttribute('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.setAttribute('hidden', ''), 2200);
}

void boot();
