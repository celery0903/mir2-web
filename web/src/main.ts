import { createIcons, Swords, MapPin, VolumeX, Volume2, Backpack, MessagesSquare, X, Send, HeartPulse, Hand, LogOut, LogIn, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flame, Sparkles, UserPlus, Sword, Shirt, Shield, Circle, Pickaxe, Package } from 'lucide';
import { client, type Data } from './client';
import { startGame } from './game';
import './style.css';
import world from '../../shared/world.json';
import { currentMap, nativeFrame, itemImage, portrait } from './classic';
import itemIcons from '../../shared/classic-item-icons.json';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const classes = ['战士', '法师', '道士'];
const classIcons = ['swords', 'flame', 'sparkles'];
let mode: 'login' | 'register' = 'login';
let characterClass = 0;
const icons = { Swords, MapPin, VolumeX, Volume2, Backpack, MessagesSquare, X, Send, HeartPulse, Hand, LogOut, LogIn, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flame, Sparkles, UserPlus, Sword, Shirt, Shield, Circle, Pickaxe, Package };
let panel: 'bag' | 'chat' | 'skills' | 'none' = 'none';
let screen = '';
let inventorySignature = '';
let chatSignature = '';
let submitting = false;
let skillSignature = '';
let npcSignature = '';

$('#app').innerHTML = `
<header class="topbar">
  <a class="brand" href="/">${icon('swords')}<span>热血传奇<span class="brand-dot"> · </span>1.76</span></a>
  <div class="world-name">${icon('map-pin')}<span>比奇省</span><span id="coordinates">288, 615</span></div>
  <div class="server-status"><span id="status-dot" class="status-dot"></span><span id="connection-status">连接中</span></div>
  <button id="sound-toggle" class="icon-button" title="音效" aria-label="音效" aria-pressed="false">${icon('volume-x')}</button>
  <button id="mobile-logout" class="icon-button mobile-only" title="返回角色选择" aria-label="返回角色选择">${icon('log-out')}</button>
</header>
<main class="playfield">
  <div id="world" aria-label="比奇省游戏地图"></div>
  <div id="player-hud" class="player-hud hidden">
    <img id="portrait" class="portrait" alt="">
    <div class="vitals"><div class="player-title"><strong id="player-name"></strong><span id="player-level"></span></div>
      <div class="meter health"><span id="hp-fill"></span><small id="hp-text"></small></div>
      <div class="meter mana"><span id="mp-fill"></span><small id="mp-text"></small></div>
    </div>
  </div>
  <div id="target-hud" class="target-hud hidden"><span id="target-name"></span><div class="meter health"><span id="target-fill"></span></div></div>
  <div id="minimap-wrap" class="minimap-wrap"><canvas id="minimap" width="168" height="132" aria-label="小地图"></canvas><span>比奇省</span></div>
  <aside id="sidepanel" class="sidepanel hidden">
    <div class="panel-tabs"><button id="bag-tab" class="active" title="背包">${icon('backpack')}<span>背包</span></button><button id="chat-tab" title="聊天">${icon('messages-square')}<span>聊天</span></button><button id="close-panel" class="icon-button" title="收起" aria-label="收起">${icon('x')}</button></div>
    <section id="bag-panel"><div class="bag-summary"><span>随身物品</span><strong id="gold">0 金币</strong></div><div id="equipment" class="equipment"></div><div class="section-caption"><span>行囊</span><span id="bag-count"></span></div><div id="inventory" class="inventory"></div></section>
    <section id="chat-panel" class="hidden"><div id="chat-log" class="chat-log" role="log"></div><form id="chat-form"><input id="chat-input" aria-label="聊天消息" placeholder="说点什么…" maxlength="150" autocomplete="off"><button class="icon-button" title="发送" aria-label="发送">${icon('send')}</button></form></section>
    <section id="skills-panel" class="hidden"><h2>技能</h2><div id="skills-list"></div></section>
  </aside>
  <section id="npc-panel" class="npc-panel hidden" aria-label="NPC 对话"><button id="close-npc" class="icon-button" title="关闭对话" aria-label="关闭对话">${icon('x')}</button><div id="npc-page"></div><div id="shop-list"></div></section>
  <div id="toast-log" class="toast-log" aria-live="polite"></div>
  <div id="touch-pad" class="touch-pad hidden" aria-label="移动控制"><button data-dir="0" class="north" title="向上移动" aria-label="向上移动">${icon('chevron-up')}</button><button data-dir="6" class="west" title="向左移动" aria-label="向左移动">${icon('chevron-left')}</button><button data-dir="2" class="east" title="向右移动" aria-label="向右移动">${icon('chevron-right')}</button><button data-dir="4" class="south" title="向下移动" aria-label="向下移动">${icon('chevron-down')}</button></div>
  <div id="modal-layer" class="modal-layer"><section id="modal" class="modal" aria-label="账号与角色"></section></div>
  <div id="death-layer" class="death-layer hidden"><div><h2>胜败乃兵家常事</h2><button id="revive" class="primary">${icon('heart-pulse')}回城复活</button></div></div>
</main>
<footer class="bottom-bar">
  <div class="experience"><span id="experience-fill"></span><small id="experience-text">比奇省</small></div>
  <div class="blood-orb"><span id="orb-hp"></span><span id="orb-mp"></span></div>
  <div class="bottom-content"><div class="realm-label"><span id="realm-vitals"></span><span>比奇 · 边界村</span></div>
    <div class="actions"><button id="attack" class="action attack" title="攻击" aria-label="攻击">${icon('swords')}</button><button id="pickup" class="action" title="拾取" aria-label="拾取">${icon('hand')}</button><button id="health-potion" class="action potion" title="金创药" aria-label="使用金创药">${itemImage(9)}<small id="health-count">0</small></button><button id="mana-potion" class="action potion" title="魔法药" aria-label="使用魔法药">${itemImage(11)}<small id="mana-count">0</small></button><button id="bag-toggle" class="action" title="背包" aria-label="打开背包">${icon('backpack')}</button><button id="chat-toggle" class="action" title="聊天" aria-label="打开聊天">${icon('messages-square')}</button><button id="skills-toggle" class="action" title="技能" aria-label="打开技能">${icon('sparkles')}</button></div>
    <div id="quick-skills" class="quick-skills"></div>
    <div id="classic-chat" class="classic-chat"></div>
    <button id="logout" class="icon-button" title="返回角色选择" aria-label="返回角色选择">${icon('log-out')}</button>
  </div>
</footer>`;
createIcons({ icons });
for (const [property, index] of Object.entries({ 'hud-art': 1, 'blood-art': 4, 'bag-art': 3, 'character-art': 370, 'dialog-art': 384, 'shop-art': 385 })) document.documentElement.style.setProperty(`--${property}`, `url("${nativeFrame('ClassicPrguse', index)}")`);
const scene = startGame($('#world'));
const mapCanvas = $<HTMLCanvasElement>('#minimap');
const mapContext = mapCanvas.getContext('2d')!;
const mapBase = new Image(); mapBase.src = world.assets + 'webui/bichon-map.png';

function renderModal() {
  if (client.phase === 'game') { $('#modal-layer').classList.add('hidden'); screen = 'game'; return; }
  $('#modal-layer').classList.remove('hidden');
  const next = `${client.phase}:${mode}:${client.characters.map(c => c.index).join(',')}`;
  if (next !== screen) {
    screen = next;
    const header = `<div class="modal-brand"><h1>热血传奇<span>1.76</span></h1></div>`;
    if (client.phase === 'login') {
      $('#modal').innerHTML = `${header}<div class="auth-tabs"><button data-mode="login" class="${mode === 'login' ? 'active' : ''}">登录</button><button data-mode="register" class="${mode === 'register' ? 'active' : ''}">注册</button></div><form id="auth-form"><label>账号<input id="account" autocomplete="username" value="${escape(client.accountID)}" pattern="[A-Za-z0-9]{3,15}" minlength="3" maxlength="15" placeholder="3-15 位字母或数字" required></label><label>密码<input id="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" pattern="[A-Za-z0-9]{5,15}" minlength="5" maxlength="15" placeholder="5-15 位字母或数字" required></label><p class="form-error" id="form-error" role="alert"></p><button id="auth-submit" class="primary">${icon('log-in')}${mode === 'login' ? '进入游戏' : '注册并登录'}</button></form>`;
      document.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => button.onclick = () => { mode = button.dataset.mode as typeof mode; client.error = ''; renderModal(); });
      for (const field of ['account', 'password']) {
        const input = $<HTMLInputElement>(`#${field}`);
        input.maxLength = 10;
        input.pattern = field === 'account' ? '[A-Za-z0-9]{3,10}' : '[A-Za-z0-9]{5,10}';
        input.placeholder = field === 'account' ? '3-10 位字母或数字' : '5-10 位字母或数字';
      }
      $('#auth-form').onsubmit = async event => {
        event.preventDefault();
        if (submitting) return;
        submitting = true; client.error = ''; update();
        const accountID = $<HTMLInputElement>('#account').value, password = $<HTMLInputElement>('#password').value;
        try {
          if (mode === 'register') {
            const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID, password }) });
            if (!response.ok) throw new Error(response.status === 429 ? '注册次数已达上限，请稍后再试' : '注册暂不可用');
            const data = await response.json();
            if (data.result !== 8) throw new Error(data.result === 7 ? '账号已存在，请直接登录' : '注册失败，请检查账号和密码');
          }
          client.login(accountID, password);
        } catch (error) { client.error = error instanceof Error ? error.message : '连接失败'; }
        finally { submitting = false; update(); }
      };
    } else {
      $('#modal').innerHTML = `${header}<h2>选择角色</h2><div class="character-preview"><img id="character-preview" src="${world.assets}auth-web/portrait-${characterClass}-0.png" alt="${classes[characterClass]}"></div><div class="characters">${client.characters.map(c => `<button class="character" data-character="${c.index}"><span><strong>${escape(c.name)}</strong><small>${classes[c.class]} · ${c.level} 级</small></span>${icon('chevron-right')}</button>`).join('')}</div><form id="character-form"><label>新角色<input id="character-name" placeholder="角色名字" minlength="3" maxlength="20" pattern="[\u4e00-\u9fa5_A-Za-z0-9]{3,20}" required></label><div class="class-choice" role="group" aria-label="职业">${classes.map((name, i) => `<button type="button" data-class="${i}" aria-pressed="${characterClass === i}" class="${characterClass === i ? 'active' : ''}">${icon(classIcons[i])}${name}</button>`).join('')}</div><label class="gender-field">性别<select id="gender" aria-label="性别"><option value="0">男</option><option value="1">女</option></select></label><p id="form-error" class="form-error" role="alert"></p><button class="primary">${icon('user-plus')}创建并进入</button></form><button id="switch-account" class="text-button">切换账号</button>`;
      document.querySelectorAll<HTMLElement>('[data-character]').forEach(button => button.onclick = () => client.send('StartGame', { characterIndex: Number(button.dataset.character) }));
      document.querySelectorAll<HTMLElement>('[data-class]').forEach(button => button.onclick = () => {
        characterClass = Number(button.dataset.class);
        updateCharacterPreview();
        document.querySelectorAll<HTMLElement>('[data-class]').forEach(b => { b.classList.toggle('active', Number(b.dataset.class) === characterClass); b.setAttribute('aria-pressed', String(Number(b.dataset.class) === characterClass)); });
      });
      $('#gender').onchange = updateCharacterPreview;
      updateCharacterPreview();
      const nameInput = $<HTMLInputElement>('#character-name');
      nameInput.maxLength = 14;
      nameInput.oninput = () => nameInput.setCustomValidity([...nameInput.value].reduce((bytes, character) => bytes + (character.charCodeAt(0) > 127 ? 2 : 1), 0) > 14 ? '角色名最多 7 个汉字或 14 个字母数字' : '');
      $('#character-form').onsubmit = event => { event.preventDefault(); client.error = ''; client.send('NewCharacter', { name: nameInput.value, class: characterClass, gender: Number($<HTMLSelectElement>('#gender').value) }); };
      $('#switch-account').onclick = () => { client.socket?.close(); client.phase = 'login'; client.characters = []; mode = 'login'; update(); client.connect(); };
    }
    createIcons({ icons });
  }
  $('#form-error').textContent = client.error;
  const submit = document.querySelector<HTMLButtonElement>('#auth-submit');
  if (submit) submit.disabled = submitting || (client.connected && !client.ready);
}

function renderBag() {
  const user = client.user;
  if (!user) return;
  const signature = JSON.stringify([user.inventory, user.equipment, [...client.items.keys()]]);
  if (signature === inventorySignature) return;
  inventorySignature = signature;
  const sprite = (item: Data | null) => {
    if (!item) return '';
    const info = client.items.get(item.itemIndex);
    return itemImage(info?.image ?? 30) + (item.count > 1 ? `<small>${item.count}</small>` : '');
  };
  $('#equipment').innerHTML = [0, 1, 2, 4, 5, 6, 7, 8].map((slot, i) => {
    const item = user.equipment[slot];
    const info = item && client.items.get(item.itemIndex);
    const name = escape(info?.name ?? ['武器', '衣服', '头盔', '项链', '左手镯', '右手镯', '左戒指', '右戒指'][i]);
    return `<button class="item-slot equipped" data-equipment="${slot}" title="${name}" aria-label="${name}">${item ? sprite(item) : icon(['sword', 'shirt', 'shield', 'circle', 'circle', 'circle', 'circle', 'circle'][i])}</button>`;
  }).join('');
  $('#inventory').innerHTML = user.inventory.map((item: Data | null, slot: number) => `<button class="item-slot ${item ? 'filled' : ''}" data-item="${slot}" title="${escape(item ? client.items.get(item.itemIndex)?.name ?? '物品' : '空位')}" aria-label="${escape(item ? client.items.get(item.itemIndex)?.name ?? '物品' : '空位')}" ${item ? '' : 'disabled'}>${sprite(item)}</button>`).join('');
  $('#bag-count').textContent = `${user.inventory.filter(Boolean).length} / ${user.inventory.length}`;
  document.querySelectorAll<HTMLElement>('[data-item]').forEach(button => button.onclick = () => { const item = user.inventory[Number(button.dataset.item)]; if (item) { if (client.selling) client.send('SellItem', { uniqueID: item.uniqueID, count: 1 }); else client.equip(item); } });
  document.querySelectorAll<HTMLElement>('[data-equipment]').forEach(button => button.onclick = () => {
    const item = user.equipment[Number(button.dataset.equipment)];
    const slot = user.inventory.findIndex((i: Data | null) => !i);
    if (item && slot >= 0) client.send('RemoveItem', { uniqueID: item.uniqueID, grid: 2, to: slot });
  });
  createIcons({ icons });
}

function updateCharacterPreview() {
  const gender = $<HTMLSelectElement>('#gender').value;
  $<HTMLImageElement>('#character-preview').src = portrait(characterClass, Number(gender));
}

function renderSkills() {
  const magics: Data[] = client.user?.magics ?? [];
  const signature = JSON.stringify(magics);
  if (signature === skillSignature) return;
  skillSignature = signature;
  const passive = (spell: number) => [3, 4, 7, 12].includes(spell);
  $('#skills-list').innerHTML = magics.length ? magics.map(magic => `<div class="skill-row">${itemImage(magic.spell - 1, 'MagIcon')}<span>${escape(magic.name)}<small>${magic.level} 级 · ${magic.training} 熟练度</small></span>${passive(magic.spell) ? '<small>被动</small>' : `<select data-spell="${magic.spell}" aria-label="${escape(magic.name)}快捷键"><option value="0">无</option>${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}" ${magic.key === i + 1 ? 'selected' : ''}>F${i + 1}</option>`).join('')}</select>`}</div>`).join('') : '<p class="empty-state">尚未学会技能</p>';
  $('#quick-skills').innerHTML = magics.filter(magic => magic.key && !passive(magic.spell)).map(magic => `<button data-magic-key="${magic.key}" class="action" title="${escape(magic.name)}" aria-label="施放${escape(magic.name)}">${itemImage(magic.spell - 1, 'MagIcon')}<small>F${magic.key}</small></button>`).join('');
  document.querySelectorAll<HTMLSelectElement>('[data-spell]').forEach(select => select.onchange = () => client.setMagicKey(Number(select.dataset.spell), Number(select.value)));
  document.querySelectorAll<HTMLElement>('[data-magic-key]').forEach(button => button.onclick = () => scene.cast(Number(button.dataset.magicKey)));
}

function renderNPC() {
  const visible = !!client.npcID && (client.npcPage.length > 0 || !!client.shop || client.selling);
  $('#npc-panel').classList.toggle('hidden', !visible);
  const signature = JSON.stringify([client.npcID, client.npcPage, client.shop, client.selling]);
  if (!visible || signature === npcSignature) return;
  npcSignature = signature;
  $('#npc-page').innerHTML = client.npcPage.map(line => {
    const tokens = line.replace(/\\/g, '').split(/(<[^<>]+\/@[A-Za-z0-9_]+>)/g);
    return `<p>${tokens.map(token => { const match = /^<([^<>]+)\/(@[A-Za-z0-9_]+)>$/.exec(token); return match ? `<button class="npc-link" data-npc-key="[${match[2]}]">${escape(match[1])}</button>` : escape(token); }).join('')}</p>`;
  }).join('');
  $('#shop-list').innerHTML = client.shop ? client.shop.list.map((item: Data) => {
    const info = client.items.get(item.itemIndex);
    const name = item.name ?? info?.name;
    const image = info?.image ?? (itemIcons.items as Record<string, number>)[name];
    return `<button class="shop-item" data-purchase="${item.uniqueID}" title="${item.submenu ? '查看' : '购买'}${escape(name)}">${(image === undefined ? '' : itemImage(image)) || icon('package')}<span>${escape(name)}<small>${Math.round((item.price ?? info?.price ?? 0) * client.shop!.rate)} 金币</small></span></button>`;
  }).join('') : client.selling ? '<p>选择要出售的物品</p>' : '';
  document.querySelectorAll<HTMLElement>('[data-npc-key]').forEach(button => button.onclick = () => { if (button.dataset.npcKey === '[@EXIT]') { client.closeNPC(); client.changed(); } else client.callNPC(client.npcID!, button.dataset.npcKey); });
  document.querySelectorAll<HTMLElement>('[data-purchase]').forEach(button => button.onclick = () => client.send('BuyItem', { itemIndex: Number(button.dataset.purchase), count: 1, type: 0 }));
  if (client.selling && panel !== 'bag') { panel = 'bag'; update(); }
}

function update() {
  renderModal();
  const inGame = client.phase === 'game';
  document.body.classList.toggle('in-game', inGame);
  $('#connection-status').textContent = client.ready ? '已连接' : client.connected ? '连接中' : '离线';
  $('#status-dot').classList.toggle('online', client.ready);
  $('#player-hud').classList.toggle('hidden', !inGame);
  $('#sidepanel').classList.toggle('hidden', !inGame || panel === 'none');
  $('#touch-pad').classList.toggle('hidden', !inGame);
  $('#death-layer').classList.toggle('hidden', !inGame || !client.dead);
  $('#bag-panel').classList.toggle('hidden', panel !== 'bag');
  $('#chat-panel').classList.toggle('hidden', panel !== 'chat');
  $('#skills-panel').classList.toggle('hidden', panel !== 'skills');
  $('#bag-tab').classList.toggle('active', panel === 'bag');
  $('#chat-tab').classList.toggle('active', panel === 'chat');
  $('#world').classList.toggle('panel-open', inGame && panel !== 'none');
  if (!client.user || !inGame) return;
  const u = client.user;
  $('#player-name').textContent = u.name;
  $('#player-level').textContent = `${classes[u.class]} · ${u.level} 级`;
  $<HTMLImageElement>('#portrait').src = portrait(u.class, u.gender);
  const maxHP = client.maximum(0), maxMP = client.maximum(1);
  $('#hp-text').textContent = `${u.hp} / ${maxHP}`;
  $('#mp-text').textContent = `${u.mp} / ${maxMP}`;
  $('#hp-fill').style.width = `${Math.min(100, u.hp / maxHP * 100)}%`;
  $('#mp-fill').style.width = `${Math.min(100, u.mp / maxMP * 100)}%`;
  $('#orb-hp').style.clipPath = `inset(${100 - Math.min(100, u.hp / maxHP * 100)}% 50% 0 0)`;
  $('#orb-mp').style.clipPath = `inset(${100 - Math.min(100, u.mp / maxMP * 100)}% 0 0 50%)`;
  $('#realm-vitals').textContent = `HP ${u.hp}/${maxHP}  MP ${u.mp}/${maxMP}`;
  $('#coordinates').textContent = `${u.location.x}, ${u.location.y}`;
  $('.world-name span').textContent = currentMap.name;
  $('#world').setAttribute('aria-label', currentMap.name + '游戏地图');
  $('#minimap-wrap').classList.toggle('hidden', currentMap.id !== '0');
  $('#gold').textContent = `${u.gold.toLocaleString()} 金币`;
  $('#experience-text').textContent = `${u.experience} / ${u.maxExperience} 经验`;
  $('#experience-fill').style.width = `${Math.min(100, u.experience / Math.max(1, u.maxExperience) * 100)}%`;
  $('#health-count').textContent = String(u.inventory.filter((i: Data | null) => i && client.items.get(i.itemIndex)?.name.startsWith('金创药')).reduce((n: number, i: Data) => n + i.count, 0));
  $('#mana-count').textContent = String(u.inventory.filter((i: Data | null) => i && client.items.get(i.itemIndex)?.name.startsWith('魔法药')).reduce((n: number, i: Data) => n + i.count, 0));
  const target = client.selected && client.objects.get(client.selected);
  $('#target-hud').classList.toggle('hidden', !target || target.dead);
  $('#target-hud').dataset.objectId = target ? String(target.objectID) : '';
  if (target) { $('#target-name').textContent = target.name ?? `${target.gold} 金币`; $('#target-fill').style.width = `${target.percent ?? 100}%`; }
  renderBag();
  const logs = JSON.stringify(client.logs);
  if (logs !== chatSignature) {
    chatSignature = logs;
    $('#chat-log').innerHTML = client.logs.map(entry => `<p class="${entry.kind}">${escape(entry.text)}</p>`).join('');
    $('#chat-log').scrollTop = $('#chat-log').scrollHeight;
    $('#toast-log').innerHTML = client.logs.slice(-3).map(entry => `<p class="${entry.kind}">${escape(entry.text)}</p>`).join('');
    $('#classic-chat').innerHTML = client.logs.slice(-4).map(entry => `<p class="${entry.kind}">${escape(entry.text)}</p>`).join('');
  }
  renderSkills(); renderNPC();
  mapContext.imageSmoothingEnabled = false;
  if (mapBase.complete && mapBase.naturalWidth) mapContext.drawImage(mapBase, 0, 0, 168, 132);
  mapContext.fillStyle = '#ffff44'; mapContext.fillRect(u.location.x / world.width * 168 - 2, u.location.y / world.height * 132 - 2, 4, 4);
}

$('#attack').onclick = () => scene.attack();
$('#pickup').onclick = () => scene.pickup();
const harvestButton = document.createElement('button');
harvestButton.className = 'action'; harvestButton.id = 'harvest';
harvestButton.title = '挖取'; harvestButton.setAttribute('aria-label', '挖取'); harvestButton.innerHTML = icon('pickaxe');
$('#pickup').after(harvestButton); harvestButton.onclick = () => scene.harvest();
createIcons({ icons });
for (const id of ['logout', 'mobile-logout']) { $(`#${id}`).title = '退出游戏'; $(`#${id}`).setAttribute('aria-label', '退出游戏'); }
$('#health-potion').onclick = () => client.usePotion();
$('#mana-potion').onclick = () => client.usePotion(true);
$('#revive').onclick = () => client.send('TownRevive');
$('#logout').onclick = () => client.logout();
$('#mobile-logout').onclick = () => client.logout();
$('#bag-toggle').onclick = () => { panel = panel === 'bag' ? 'none' : 'bag'; update(); };
$('#chat-toggle').onclick = () => { panel = panel === 'chat' ? 'none' : 'chat'; update(); };
$('#bag-tab').onclick = () => { panel = 'bag'; update(); };
$('#chat-tab').onclick = () => { panel = 'chat'; update(); };
$('#close-panel').onclick = () => { panel = 'none'; update(); };
$('#skills-toggle').onclick = () => { panel = panel === 'skills' ? 'none' : 'skills'; update(); };
$('#close-npc').onclick = () => { client.closeNPC(); client.changed(); };
document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) return;
  if (['F9', 'F10', 'F11', 'b', 'B', 'Escape'].includes(event.key)) {
    event.preventDefault(); panel = event.key === 'Escape' ? 'none' : event.key === 'F11' ? 'skills' : panel === 'bag' ? 'none' : 'bag';
    if (event.key === 'Escape') client.closeNPC();
    update();
  }
});
$('#chat-form').onsubmit = event => { event.preventDefault(); const input = $<HTMLInputElement>('#chat-input'); const message = input.value.trim(); if (message) client.send('Chat', { message }); input.value = ''; };
document.querySelectorAll<HTMLElement>('[data-dir]').forEach(button => button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); scene.held = Number(button.dataset.dir); scene.target = undefined; scene.step(scene.held); });
document.addEventListener('pointerup', () => { scene.held = undefined; });
document.addEventListener('pointercancel', () => { scene.held = undefined; });
window.addEventListener('blur', () => { scene.held = undefined; });

let audio: AudioContext | undefined;
let sound = false;
$('#sound-toggle').onclick = () => {
  sound = !sound;
  if (sound) { audio ??= new AudioContext(); void audio.resume(); }
  $('#sound-toggle').innerHTML = icon(sound ? 'volume-2' : 'volume-x');
  $('#sound-toggle').setAttribute('aria-pressed', String(sound));
  createIcons({ icons });
};
client.addEventListener('packet', (event: Event) => {
  const packet = (event as CustomEvent).detail;
  if (!sound || !audio || !['DamageIndicator', 'GainedItem', 'LevelChanged'].includes(packet.type)) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'triangle'; oscillator.frequency.value = packet.type === 'DamageIndicator' ? 130 : 620;
  gain.gain.setValueAtTime(0.035, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.16);
});
client.addEventListener('change', update);
client.connect();
update();
setInterval(() => { if (client.phase === 'game') update(); }, 1000);
