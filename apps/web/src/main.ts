import {
  GameError,
  newGame,
  reduce,
  decideAction,
  seatLabel,
  TRICK_SELF_TARGET,
  TRICK_NO_TARGET,
  type Action,
  type CardDef,
  type CardInstance,
  type GameState,
  type PlayerId,
} from '@fpskill/engine';
import { NetSession } from './net.ts';

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
/** local = 原热座；net = 服务器权威联机（state 真相在 net.rs.game） */
let mode: 'local' | 'net' = 'local';
let selectedUid: number | null = null;
let galleryBuilt = false;

const net = new NetSession({
  onRoomState: () => render(),
  onStatus: (text) => {
    const node = document.getElementById('net-status');
    if (node) node.textContent = text;
  },
  onNotice: (text) => toast(text),
});

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

function btn(id: string): HTMLButtonElement {
  const node = byId(id);
  if (!(node instanceof HTMLButtonElement)) throw new Error('#' + id + ' is not a button');
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
  byId('net-btn').addEventListener('click', toggleNetMode);
  byId('btn-end').addEventListener('click', () => {
    const g = viewState();
    if (g === null) return;
    if (!myTurn(g)) {
      toast('还没到你的回合');
      return;
    }
    act({ type: 'END_TURN', player: g.active });
  });
  byId('btn-bot').addEventListener('click', () => {
    const g = viewState();
    if (g === null || g.over) return;
    if (mode === 'net') {
      if (!myTurn(g)) {
        toast('还没到你的回合');
        return;
      }
      net.bot();
      return;
    }
    botTurn();
  });
  byId('btn-new').addEventListener('click', () => {
    if (mode === 'net') {
      netRestartOrStart();
      return;
    }
    restart();
  });
  byId('seed-input').addEventListener('change', () => {
    if (mode === 'net') return; // 联机下 seed 只在点「新对局/开始对局」时生效
    restart();
  });
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

  byId('net-connect').addEventListener('click', () => void connectNet());
  byId('net-sit').addEventListener('click', () => {
    const name = netName();
    net.sit(name);
    toast('已请求落座');
  });
  byId('net-start').addEventListener('click', netStart);
  byId('net-reset').addEventListener('click', () => {
    net.reset();
    toast('已请求重置房间');
  });
  byId('net-disconnect').addEventListener('click', () => {
    net.disconnect();
    render();
  });
  const savedName = localStorage.getItem('fpskill.name');
  if (savedName) (byId('net-name') as HTMLInputElement).value = savedName;

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

function toggleNetMode(): void {
  mode = mode === 'local' ? 'net' : 'local';
  if (mode === 'net') switchTab('battle');
  render();
}

function defaultNetUrl(): string {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function netName(): string {
  const input = byId('net-name') as HTMLInputElement;
  const name = input.value.trim() || '玩家';
  localStorage.setItem('fpskill.name', name);
  return name;
}

async function connectNet(): Promise<void> {
  const urlInput = byId('net-url') as HTMLInputElement;
  const url = urlInput.value.trim() || defaultNetUrl();
  try {
    await net.connect(url, netName());
  } catch (e) {
    net.disconnect();
    toast('连接失败：' + (e instanceof Error ? e.message : String(e)));
  }
  render();
}

function netStart(): void {
  const rs = net.rs;
  if (rs === null || net.mySeat === null) {
    toast('先落座');
    return;
  }
  const seed = parseSeedInput();
  net.start(seed);
}

function netRestartOrStart(): void {
  const rs = net.rs;
  if (rs === null || net.mySeat === null) {
    toast('先落座');
    return;
  }
  const seed = parseSeedInput();
  if (rs.phase === 'lobby') {
    if (rs.seats[1] === null || rs.seats[2] === null) {
      toast('等对手落座后再开局');
      return;
    }
    net.start(seed);
  } else {
    net.restart(seed);
  }
}

function parseSeedInput(): number | null {
  const input = byId('seed-input') as HTMLInputElement;
  const parsed = Math.floor(Number(input.value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

// ---------- 状态视图（local=本地 state；net=服务器房间 state） ----------

function viewState(): GameState | null {
  if (mode === 'local') return state;
  return net.rs?.game ?? null;
}

function myTurn(g: GameState): boolean {
  if (mode === 'local') return true;
  return net.mySeat !== null && g.active === net.mySeat && !g.over;
}

/** 当前应该显示/操作谁的手牌：热座=active 玩家；联机=我的座位 */
function handOwner(g: GameState): (typeof g.players)[number] | null {
  if (mode === 'local') return g.players[g.active - 1];
  if (net.mySeat === null) return null;
  return g.players[net.mySeat - 1];
}

function seatName(seat: PlayerId): string {
  const rs = net.rs;
  if (mode === 'local' || rs === null || seat < 1 || seat > 2) return `玩家${seat}`;
  return rs.names[seat as 1 | 2] ?? `玩家${seat}`;
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
  if (mode === 'net') {
    net.action(action);
    if (action.type === 'PLAY_CARD') selectedUid = null;
    render();
    return;
  }
  try {
    state = reduce(state, action);
    if (action.type === 'PLAY_CARD') selectedUid = null;
  } catch (e) {
    toast(e instanceof GameError ? e.message : String(e));
  }
  render();
}

/** 当前选中的牌定义（无选中返回 null） */
function selectedDef(g: GameState): CardDef | null {
  if (selectedUid === null) return null;
  const owner = handOwner(g);
  const card = owner?.hand.find((c) => c.uid === selectedUid);
  return card ? (g.cardDefs[card.defId] ?? null) : null;
}

function onCardClick(uid: number): void {
  const g = viewState();
  if (g === null || g.over) return;
  if (!myTurn(g)) {
    toast('还没到你出牌');
    return;
  }
  const owner = handOwner(g);
  if (owner === null) return;
  const card = owner.hand.find((c) => c.uid === uid);
  if (!card) return;
  const def = g.cardDefs[card.defId];
  if (def.category === 'response') {
    toast(def.name + ' 只能自动响应「杀」，不能主动打出');
    return;
  }
  // 桃 / 无目标自用牌（酒、充电宝）/ 全场生效牌（王朝来袭）：点了直接结算
  if (def.category === 'restore' || def.category === 'instant' || TRICK_NO_TARGET.has(def.id)) {
    act({ type: 'PLAY_CARD', player: g.active, cardUid: uid });
    return;
  }
  // 杀 / 需目标的技能牌：选中进入指定目标模式
  selectedUid = selectedUid === uid ? null : uid;
  render();
}

function onPlayerClick(pid: PlayerId): void {
  const g = viewState();
  if (g === null) return;
  if (selectedUid === null || g.over) return;
  if (!myTurn(g)) {
    toast('还没到你出牌');
    return;
  }
  if (pid === g.active) {
    // 完美服务器 / 换弹癌可以以自己为目标：点自己的面板
    const def = selectedDef(g);
    if (def !== null && def.category === 'trick' && TRICK_SELF_TARGET.has(def.id)) {
      act({ type: 'PLAY_CARD', player: g.active, cardUid: selectedUid, targetId: pid });
    }
    return;
  }
  act({ type: 'PLAY_CARD', player: g.active, cardUid: selectedUid, targetId: pid });
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
  renderNetPanel();
  const g = viewState();
  if (g === null) {
    renderLobbyPlaceholder();
    return;
  }
  renderMeta(g);
  renderPlayers(g);
  renderHand(g);
  renderPiles(g);
  renderLog(g);
  renderOverlay(g);
  updateButtons(g);
}

function renderNetPanel(): void {
  const panel = byId('net-panel');
  panel.toggleAttribute('hidden', mode !== 'net');
  byId('net-btn').classList.toggle('active', mode === 'net');
  if (mode !== 'net') return;
  const form = byId('net-form');
  const roomRow = byId('net-room');
  form.toggleAttribute('hidden', net.connected);
  roomRow.toggleAttribute('hidden', !net.connected);
  if (!net.connected) return;
  const rs = net.rs;
  const seatText =
    rs === null
      ? '…'
      : `座位1 ${seatName(1)} ｜ 座位2 ${seatName(2)}`;
  const mine = net.mySeat !== null ? `（你=${seatLabel(net.mySeat)}）` : '（未落座）';
  byId('net-info').textContent = `${seatText} ｜ ${mine}`;
  byId('net-sit').toggleAttribute('hidden', net.mySeat !== null);
  const canStart = rs !== null && rs.phase === 'lobby' && net.mySeat !== null;
  byId('net-start').toggleAttribute('hidden', !canStart);
  if (rs !== null && rs.seed !== null) {
    (byId('seed-input') as HTMLInputElement).value = String(rs.seed);
  }
}

function renderLobbyPlaceholder(): void {
  byId('meta').textContent = '联机模式｜未开局';
  const players = byId('players');
  players.innerHTML = '';
  const note = el('div', 'muted', '联机大厅 —— 落座后由任一玩家点「开始对局」');
  note.style.padding = '12px';
  players.appendChild(note);
  byId('hand-title').textContent = '尚未开局';
  byId('hand').innerHTML = '';
  byId('hint').textContent = '';
  byId('piles').textContent = '—';
  byId('log').innerHTML = '';
  byId('overlay').setAttribute('hidden', '');
  btn('btn-end').disabled = true;
  btn('btn-bot').disabled = true;
  btn('btn-new').disabled = net.mySeat === null;
}

function updateButtons(g: GameState): void {
  const turn = myTurn(g);
  btn('btn-end').disabled = !turn;
  btn('btn-bot').disabled = !turn;
  btn('btn-new').disabled = mode === 'net' && net.mySeat === null;
}

function seedOf(): string {
  return (byId('seed-input') as HTMLInputElement).value;
}

function seedText(): string {
  if (mode === 'local') return seedOf();
  const seed = net.rs?.seed;
  return seed === null || seed === undefined ? '—' : String(seed);
}

function renderMeta(g: GameState): void {
  byId('meta').textContent = `${g.over ? '对局结束' : '进行中'}｜回合 ${g.turn}｜seed ${seedText()}`;
}

function renderPlayers(g: GameState): void {
  const wrap = byId('players');
  wrap.innerHTML = '';
  const selDef = selectedDef(g);
  const selfOk = selDef !== null && selDef.category === 'trick' && TRICK_SELF_TARGET.has(selDef.id);
  for (const p of g.players) {
    const def = g.characterDefs[p.characterId];
    const panel = el('div', 'player' + (p.alive ? '' : ' dead'));
    panel.dataset.pid = String(p.id);
    const activeMark = p.id === g.active && !g.over ? ' ▶ 当前回合' : '';
    const who = mode === 'net' ? `${seatName(p.id)}${p.id === net.mySeat ? '（你）' : ''}` : `玩家${p.id}`;
    panel.appendChild(el('div', 'player-head', `${who} · ${def.name}`));
    const hp = el('div', 'hp');
    for (let i = 0; i < p.maxHp; i++) hp.appendChild(el('span', 'hp-cell' + (i < p.hp ? ' full' : '')));
    panel.appendChild(hp);
    const shieldMark = p.perfectShield ? '｜🛡 完美服务器护盾' : '';
    panel.appendChild(
      el('div', 'player-info muted', `手牌 ${p.hand.length} 张${shieldMark}${activeMark}${p.alive ? '' : ' · 出局'}`),
    );
    const canTarget =
      selectedUid !== null && p.alive && myTurn(g) && (p.id !== g.active || selfOk);
    if (canTarget) panel.classList.add('targetable');
    wrap.appendChild(panel);
  }
}

function renderHand(g: GameState): void {
  const owner = handOwner(g);
  const hint = byId('hint');
  byId('hand-title').textContent =
    g.over || owner === null
      ? '对局已结束'
      : `你的手牌 —— ${mode === 'net' ? `${seatName(owner.id)}（你）` : `玩家${owner.id}`}(${
          g.characterDefs[owner.characterId].name
        })`;
  if (g.over) {
    hint.textContent = '';
  } else if (owner === null) {
    hint.textContent = '';
  } else if (!myTurn(g)) {
    hint.textContent = '等待对方行动…';
  } else if (selectedUid !== null) {
    const selDef = selectedDef(g);
    const selfOk =
      selDef !== null && selDef.category === 'trick' && TRICK_SELF_TARGET.has(selDef.id)
        ? '（也可点自己的面板以自己为目标）'
        : '';
    hint.textContent = `已选「${selDef?.name ?? ''}」：点击目标玩家面板出牌${selfOk}；再点一次取消。`;
  } else {
    hint.textContent =
      '点「杀/技能牌」选目标，点「桃/酒/充电宝/王朝来袭」直接结算，「闪」只能自动响应。也可 Bot 代打。';
  }
  const hand = byId('hand');
  hand.innerHTML = '';
  if (g.over) {
    hand.appendChild(el('div', 'muted', '——'));
    return;
  }
  if (owner === null) {
    hand.appendChild(el('div', 'muted', '未落座 —— 在上方联机面板点「落座」'));
    return;
  }
  for (const c of owner.hand) {
    const card = buildCardEl(g, c);
    card.dataset.uid = String(c.uid);
    hand.appendChild(card);
  }
}

function buildCardEl(g: GameState, c: CardInstance): HTMLDivElement {
  const def = g.cardDefs[c.defId];
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

function renderPiles(g: GameState): void {
  byId('piles').textContent = `牌堆 ${g.deck.length} 张｜弃牌堆 ${g.discard.length} 张｜僵局计数 ${g.stallTurns}/40`;
}

function renderLog(g: GameState): void {
  const log = byId('log');
  log.innerHTML = '';
  const view = g.log.slice(-250);
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

function renderOverlay(g: GameState): void {
  const overlay = byId('overlay');
  if (!g.over) {
    overlay.setAttribute('hidden', '');
    return;
  }
  overlay.innerHTML = '';
  const box = el('div', 'overlay-box');
  box.appendChild(
    el('h2', '', g.winner !== null ? `${playerLabelOf(g, g.winner)} 获胜！` : '平局（僵局/回合上限）'),
  );
  const again = el('button', '', '再来一局（新 seed）');
  again.addEventListener('click', () => {
    if (mode === 'net') {
      (byId('seed-input') as HTMLInputElement).value = '';
      netRestartOrStart();
      return;
    }
    (byId('seed-input') as HTMLInputElement).value = '';
    restart();
  });
  const close = el('button', 'ghost', '查看终局面板');
  close.addEventListener('click', () => overlay.setAttribute('hidden', ''));
  box.append(again, close);
  overlay.appendChild(box);
  overlay.removeAttribute('hidden');
}

function playerLabelOf(g: GameState, id: PlayerId): string {
  const p = g.players[id - 1];
  if (mode === 'local') return `玩家${p.id}(${g.characterDefs[p.characterId].name})`;
  return `${seatName(p.id)}(${g.characterDefs[p.characterId].name})`;
}

// ---------- gallery ----------

/** 缩略图地址（scripts/make-thumbs.mjs 生成；缺图时由 onerror 回退原图） */
function thumbSrc(dir: string, file: string): string {
  return `/${dir}/.thumbs/${file.replace(/\.png$/i, '.jpg')}`;
}

function buildGalleryImg(dir: string, file: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  // 缩略图单张 ~27KB，直接 eager：优化已由缩略图完成，且不依赖渲染器懒加载触发时机
  img.alt = alt;
  img.onerror = () => {
    img.onerror = null;
    img.src = `/${dir}/${file}`;
  };
  img.src = thumbSrc(dir, file);
  return img;
}

function buildGallery(): void {
  const root = byId('tab-gallery');
  root.innerHTML = '';

  const cardSec = el('section', 'gallery-sec');
  cardSec.appendChild(
    el('h2', '', `手牌图鉴（${cardsManifest.length} 张，已实装 ${cardsManifest.filter((c) => c.defId !== null).length} 张）`),
  );
  const cardGrid = el('div', 'gallery-grid');
  for (const c of cardsManifest) {
    const item = el('a', 'g-item' + (c.defId === null ? ' pending' : ''));
    (item as HTMLAnchorElement).href = '/cards/' + c.file;
    (item as HTMLAnchorElement).target = '_blank';
    (item as HTMLAnchorElement).rel = 'noopener';
    item.appendChild(buildGalleryImg('cards', c.file, c.name));
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
    const item = el('a', 'g-item');
    (item as HTMLAnchorElement).href = '/characters/' + ch.file;
    (item as HTMLAnchorElement).target = '_blank';
    (item as HTMLAnchorElement).rel = 'noopener';
    item.appendChild(buildGalleryImg('characters', ch.file, ch.skin));
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
      const link = el('a', 'g-link');
      (link as HTMLAnchorElement).href = '/equipment/' + e.file;
      (link as HTMLAnchorElement).target = '_blank';
      (link as HTMLAnchorElement).rel = 'noopener';
      link.appendChild(buildGalleryImg('equipment', e.file, e.name));
      item.appendChild(link);
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
