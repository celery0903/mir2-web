import { createIcons, Swords, MapPin, VolumeX, Volume2, Backpack, MessagesSquare, X, Send, HeartPulse, Hand, LogOut, LogIn, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flame, Sparkles, UserPlus, Sword, Shirt, Shield, Circle, Pickaxe, Package } from 'lucide';
import { client, type Data } from './client';
import { startGame } from './game';
import { ClassicAudio } from './audio';
import './style.css';
import world from '../../shared/world.json';
import { currentMap, nativeFrame, nativeFrameSize, itemImage, portrait, portraitSprite } from './classic';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const icon = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const classes = ['战士', '法师', '道士'];
let mode: 'login' | 'register' = 'login';
let characterClass = 0;
let characterGender = 0;
let creatingCharacter = false;
let selectedCharacter: number | undefined;
let deletingCharacter = false;
const icons = { Swords, MapPin, VolumeX, Volume2, Backpack, MessagesSquare, X, Send, HeartPulse, Hand, LogOut, LogIn, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Flame, Sparkles, UserPlus, Sword, Shirt, Shield, Circle, Pickaxe, Package };
let panel: 'bag' | 'chat' | 'skills' | 'none' = 'none';
let screen = '';
let inventorySignature = '';
let chatSignature = '';
let submitting = false;
let skillSignature = '';
let npcSignature = '';
let characterOpen = false;
let shopTop = 0;
let selectedGood: number | undefined;
let selectedItem: number | undefined;
let shopContents = '';
const nativeButton = (id: string, frame: number, label: string, className = '') => `<button id="${id}" class="native-button ${className}" title="${label}" aria-label="${label}" style="background-image:url('${nativeFrame('ClassicPrguse', frame)}')"></button>`;

$('#app').innerHTML = `
<header class="topbar">
  <a class="brand" href="/">${icon('swords')}<span>热血传奇</span></a>
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
    <section id="bag-panel"><div id="inventory" class="inventory"></div><div class="bag-summary"><strong id="gold">0 金币</strong><span id="bag-count"></span></div><div id="item-description"></div><button id="use-selected" class="native-use" title="使用选中的物品" aria-label="使用选中的物品">使用</button><button id="close-bag" class="native-close" title="关闭背包" aria-label="关闭背包"></button></section>
    <section id="chat-panel" class="hidden"><div id="chat-log" class="chat-log" role="log"></div><form id="chat-form"><input id="chat-input" aria-label="聊天消息" placeholder="说点什么…" maxlength="150" autocomplete="off"><button class="icon-button" title="发送" aria-label="发送">${icon('send')}</button></form></section>
  </aside>
  <section id="character-window" class="character-window hidden" aria-label="人物"><strong id="character-title"></strong><button id="close-character" class="native-close" title="关闭人物" aria-label="关闭人物"></button><div id="paperdoll"><img id="doll-body" alt=""><div id="doll-clothes"></div><div id="equipment" class="equipment"></div></div><section id="skills-panel" class="hidden"><div id="skills-list"></div></section>${nativeButton('character-skills', 372, '查看技能')}${nativeButton('character-equipment', 373, '查看装备')}<div id="character-details"></div></section>
  <section id="npc-panel" class="npc-panel hidden" aria-label="NPC 对话"><button id="close-npc" class="native-close" title="关闭对话" aria-label="关闭对话"></button><div id="npc-page"></div></section>
  <section id="shop-window" class="shop-window hidden" aria-label="商店"><div class="shop-head"><span>名称</span><span>价格</span><span>持久</span></div><div id="shop-list"></div>${nativeButton('shop-prev', 388, '上一页')}${nativeButton('shop-next', 387, '下一页')}${nativeButton('shop-buy', 386, '购买选中商品')}<button id="close-shop" class="native-close" title="关闭商店" aria-label="关闭商店"></button></section>
  <section id="storage-window" class="storage-window hidden" aria-label="保管物品"><span>保管物品:</span><button id="storage-slot" class="item-slot" title="保管物品" aria-label="保管物品"></button>${nativeButton('storage-confirm', 393, '存入选中物品')}<button id="close-storage" class="native-close" title="关闭保管框" aria-label="关闭保管框"></button></section>
  <div id="toast-log" class="toast-log" aria-live="polite"></div>
  <div id="touch-pad" class="touch-pad hidden" aria-label="移动控制"><button data-dir="0" class="north" title="向上移动" aria-label="向上移动">${icon('chevron-up')}</button><button data-dir="6" class="west" title="向左移动" aria-label="向左移动">${icon('chevron-left')}</button><button data-dir="2" class="east" title="向右移动" aria-label="向右移动">${icon('chevron-right')}</button><button data-dir="4" class="south" title="向下移动" aria-label="向下移动">${icon('chevron-down')}</button></div>
  <div id="modal-layer" class="modal-layer"><section id="modal" class="modal" aria-label="账号与角色"></section></div>
  <div id="death-layer" class="death-layer hidden"><div><h2>胜败乃兵家常事</h2><button id="revive" class="primary">${icon('heart-pulse')}回城复活</button></div></div>
</main>
<footer class="bottom-bar">
  <div class="experience"><span id="experience-fill"></span><small id="experience-text">比奇省</small></div>
  <div class="blood-orb"><span id="orb-hp"></span><span id="orb-mp"></span></div>
  <div id="belt" class="belt"></div><div class="weight-meter"><span id="weight-fill"></span></div>
  <div class="bottom-content"><div class="realm-label"><span id="realm-vitals"></span><span>比奇 · 边界村</span></div>
    <div class="actions"><button id="attack" class="action attack" title="攻击" aria-label="攻击">${icon('swords')}</button><button id="pickup" class="action" title="拾取" aria-label="拾取">${icon('hand')}</button><button id="health-potion" class="action potion" title="金创药" aria-label="使用金创药">${itemImage(9)}<small id="health-count">0</small></button><button id="mana-potion" class="action potion" title="魔法药" aria-label="使用魔法药">${itemImage(11)}<small id="mana-count">0</small></button><button id="bag-toggle" class="action" title="背包" aria-label="打开背包">${icon('backpack')}</button><button id="chat-toggle" class="action" title="聊天" aria-label="打开聊天">${icon('messages-square')}</button><button id="skills-toggle" class="action" title="技能" aria-label="打开技能">${icon('sparkles')}</button></div>
    <div id="quick-skills" class="quick-skills"></div>
    <div id="classic-chat" class="classic-chat"></div>
    ${nativeButton('character-toggle', 1, '打开人物', 'round-control')}
    ${nativeButton('native-bag-toggle', 1, '打开背包', 'round-control')}
    ${nativeButton('native-skills-toggle', 1, '打开技能', 'round-control')}
    ${nativeButton('native-sound-toggle', 1, '音效', 'round-control')}
    ${nativeButton('map-toggle', 130, '地图')}
    ${nativeButton('logout', 138, '退出游戏')}
  </div>
</footer>`;
createIcons({ icons });
for (const [property, index] of Object.entries({ 'hud-art': 1, 'blood-art': 4, 'red-art': 6, 'bag-art': 3, 'character-art': 370, 'dialog-art': 384, 'shop-art': 385, 'storage-art': 392, 'progress-art': 7, 'skills-art': 383, 'login-art': 60, 'register-art': 63, 'select-art': 65, 'create-art': 73, 'submit-art': 61 })) document.documentElement.style.setProperty(`--${property}`, `url("${nativeFrame('ClassicPrguse', index)}")`);
const fitClassicScreen = () => document.documentElement.style.setProperty('--classic-scale', String(Math.min(document.documentElement.clientWidth / 800, document.documentElement.clientHeight / 600)));
window.addEventListener('resize', fitClassicScreen);
fitClassicScreen();
const scene = startGame($('#world'));
const mapCanvas = $<HTMLCanvasElement>('#minimap');
const mapContext = mapCanvas.getContext('2d')!;
const mapBase = new Image(); mapBase.src = world.assets + 'webui/bichon-map.png';

const accountField = (id: string, label: string, x: number, y: number, width: number, type = 'text', attributes = '') => `<label class="native-field" style="left:${x}px;top:${y}px;width:${width}px"><span class="sr-only">${label}</span><input id="${id}" name="${id}" type="${type}" aria-label="${label}" ${attributes}></label>`;
function characterPortrait(job: number, gender: number, slot = 0, frozen = false, id = '') {
  const p = portraitSprite(job, gender, slot, frozen);
  return `<div ${id ? `id="${id}"` : ''} class="chr-portrait ${frozen ? '' : 'animated'}" role="img" aria-label="${gender ? '女' : '男'}${classes[job]}" data-frame-width="${p.w}" data-frame-height="${p.h}" style="left:${p.left}px;top:${p.top}px;width:${p.w}px;height:${p.h}px;background-image:url('${p.source}');background-position:0 ${frozen ? -p.h * 4 : 0}px"></div>`;
}

function renderModal() {
  if (client.phase === 'game') { $('#modal-layer').classList.add('hidden'); screen = 'game'; return; }
  $('#modal-layer').classList.remove('hidden');
  const next = `${client.phase}:${mode}:${creatingCharacter}:${selectedCharacter}:${deletingCharacter}:${client.characters.map(c => `${c.index}:${c.name}`).join(',')}`;
  if (next !== screen) {
    screen = next;
    $('#modal').className = `modal ${client.phase === 'login' ? mode === 'login' ? 'login-window' : 'register-window' : 'select-window'}`;
    if (client.phase === 'login') {
      const registering = mode === 'register';
      const extraFields = registering ? [
        accountField('confirm-password', '确认密码', 160, 157, 117, 'password', 'autocomplete="new-password" required'),
        accountField('userName', '你的名字', 160, 185, 117, 'text', 'maxlength="20"'),
        accountField('identity', '身份证号', 160, 205, 117, 'text', 'maxlength="14"'),
        accountField('birthDay', '生日', 160, 225, 117, 'text', 'maxlength="10"'),
        accountField('question', '密保问题', 160, 255, 165, 'text', 'maxlength="20"'),
        accountField('answer', '密保答案', 160, 275, 165, 'text', 'maxlength="12"'),
        accountField('question2', '第二密保问题', 160, 295, 165, 'text', 'maxlength="20"'),
        accountField('answer2', '第二密保答案', 160, 315, 165, 'text', 'maxlength="12"'),
        accountField('phone', '电话号码', 160, 345, 165, 'tel', 'maxlength="14"'),
        accountField('mobile', '手机号码', 160, 365, 165, 'tel', 'maxlength="11"'),
        accountField('email', '电子邮箱', 160, 386, 167, 'email', 'maxlength="40"')
      ].join('') : '';
      $('#modal').innerHTML = `<h1 class="sr-only">热血传奇</h1><div class="auth-tabs"><button data-mode="login">登录</button><button data-mode="register">注册</button>${registering ? '<button id="register-cancel" data-mode="login" aria-label="返回登录" title="返回登录"></button>' : ''}</div><form id="auth-form">${accountField('account', '账号', registering ? 160 : 98, registering ? 114 : 85, registering ? 117 : 137, 'text', `autocomplete="username" value="${escape(client.accountID)}" pattern="[A-Za-z0-9]{3,10}" minlength="3" maxlength="10" required`)}${accountField('password', '密码', registering ? 160 : 98, registering ? 135 : 117, registering ? 117 : 137, 'password', `autocomplete="${registering ? 'new-password' : 'current-password'}" pattern="[A-Za-z0-9]{5,10}" minlength="5" maxlength="10" required`)}${extraFields}<p class="form-error" id="form-error" role="alert"></p><button id="auth-submit" class="primary">${registering ? '注册并登录' : '进入游戏'}</button></form>`;
      document.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => button.onclick = () => { mode = button.dataset.mode as typeof mode; client.error = ''; renderModal(); });
      $('#auth-form').onsubmit = async event => {
        event.preventDefault();
        if (submitting) return;
        submitting = true; client.error = ''; update();
        const accountID = $<HTMLInputElement>('#account').value, password = $<HTMLInputElement>('#password').value;
        try {
          if (mode === 'register') {
            if (password !== $<HTMLInputElement>('#confirm-password').value) throw new Error('两次密码不一致');
            const profile = Object.fromEntries(['userName', 'identity', 'birthDay', 'question', 'answer', 'question2', 'answer2', 'phone', 'mobile', 'email'].map(id => [id, $<HTMLInputElement>(`#${id}`).value.trim()]));
            const response = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountID, password, ...profile }) });
            if (!response.ok) throw new Error(response.status === 429 ? '注册次数已达上限，请稍后再试' : '注册暂不可用');
            const data = await response.json();
            if (data.result !== 8) throw new Error(data.result === 7 ? '账号已存在，请直接登录' : '注册失败，请检查账号和密码');
          }
          client.login(accountID, password);
        } catch (error) { client.error = error instanceof Error ? error.message : '连接失败'; }
        finally { submitting = false; update(); }
      };
    } else {
      if (!client.characters.some(c => c.index === selectedCharacter)) selectedCharacter = client.characters[0]?.index;
      const createForm = creatingCharacter ? `<form id="character-form" class="create-window"><h2 class="sr-only">创建角色</h2>${accountField('character-name', '新角色', 71, 107, 133, 'text', 'minlength="3" maxlength="14" pattern="[\u4e00-\u9fa5_A-Za-z0-9]{3,14}" required')}<div class="class-choice" role="group" aria-label="职业">${classes.map((name, i) => `<button type="button" data-class="${i}" aria-label="${name}" title="${name}" aria-pressed="${characterClass === i}" style="left:${48 + i * 45}px;background-image:url('${nativeFrame('ClassicPrguse', 74 + i)}')"></button>`).join('')}</div><div class="gender-choice" role="group" aria-label="性别">${['男', '女'].map((name, i) => `<button type="button" data-gender="${i}" aria-label="${name}" title="${name}" aria-pressed="${characterGender === i}" style="left:${93 + i * 45}px;background-image:url('${nativeFrame('ClassicPrguse', 77 + i)}')"></button>`).join('')}</div><button class="native-submit" aria-label="创建并进入" title="创建并进入"></button><button type="button" id="cancel-create" class="native-close" aria-label="返回角色列表" title="返回角色列表"></button></form>` : '';
      $('#modal').innerHTML = `<h2 class="sr-only">选择角色</h2>${creatingCharacter ? characterPortrait(characterClass, characterGender, 0, false, 'character-preview') : client.characters.map((c, slot) => characterPortrait(c.class, c.gender, slot, c.index !== selectedCharacter)).join('')}<div class="characters ${creatingCharacter ? 'hidden' : ''}">${client.characters.map((c, slot) => `<button class="character" data-character="${c.index}" aria-label="选择角色 ${escape(c.name)}" aria-pressed="${c.index === selectedCharacter}" style="left:${slot ? 681 : 133}px;top:455px;width:76px;height:30px"></button><div class="character-data" style="left:${117 + slot * 554}px;top:494px">${escape(c.name)}</div><div class="character-data" style="left:${117 + slot * 554}px;top:${slot ? 527 : 523}px">${c.level}</div><div class="character-data" style="left:${117 + slot * 554}px;top:${slot ? 557 : 553}px">${classes[c.class]}</div>`).join('')}</div>${nativeButton('start-character', 68, '进入游戏')}${nativeButton('new-character', 69, '创建角色')}${nativeButton('delete-character', 70, '删除人物')}${createForm}<p id="form-error" class="form-error" role="alert"></p><button id="switch-account" class="native-close" aria-label="切换账号" title="切换账号"></button>`;
      document.querySelectorAll<HTMLElement>('[data-character]').forEach(button => button.onclick = () => { selectedCharacter = Number(button.dataset.character); renderModal(); });
      $<HTMLButtonElement>('#start-character').disabled = selectedCharacter === undefined || deletingCharacter;
      $<HTMLButtonElement>('#new-character').disabled = client.characters.length >= 2 || deletingCharacter;
      $<HTMLButtonElement>('#delete-character').disabled = selectedCharacter === undefined || deletingCharacter;
      $('#start-character').onclick = () => client.send('StartGame', { characterIndex: selectedCharacter });
      $('#new-character').onclick = () => { creatingCharacter = true; client.error = ''; renderModal(); };
      $('#delete-character').onclick = () => {
        const character = client.characters.find(c => c.index === selectedCharacter);
        if (character && !deletingCharacter && window.confirm(`是否删除角色 ${character.name}？`)) { deletingCharacter = true; client.send('DeleteCharacter', { characterIndex: selectedCharacter }); renderModal(); }
      };
      if (creatingCharacter) {
        document.querySelectorAll<HTMLElement>('[data-class]').forEach(button => button.onclick = () => { characterClass = Number(button.dataset.class); updateCharacterPreview(); });
        document.querySelectorAll<HTMLElement>('[data-gender]').forEach(button => button.onclick = () => { characterGender = Number(button.dataset.gender); updateCharacterPreview(); });
        const nameInput = $<HTMLInputElement>('#character-name');
        nameInput.oninput = () => nameInput.setCustomValidity([...nameInput.value].reduce((bytes, character) => bytes + (character.charCodeAt(0) > 127 ? 2 : 1), 0) > 14 ? '角色名最多 7 个汉字或 14 个字母数字' : '');
        $('#character-form').onsubmit = event => { event.preventDefault(); client.error = ''; client.send('NewCharacter', { name: nameInput.value, class: characterClass, gender: characterGender }); };
        $('#cancel-create').onclick = () => { creatingCharacter = false; client.error = ''; renderModal(); };
      }
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
  const equipmentSlots = [[0, 47, 80, 47, 87], [1, 96, 122, 53, 112], [2, 168, 48, 36, 32], [4, 168, 87, 36, 32], [5, 168, 176, 36, 32], [6, 42, 176, 36, 32], [7, 168, 215, 36, 32], [8, 42, 215, 36, 32]];
  $('#equipment').innerHTML = equipmentSlots.map(([slot, x, y, width, height], i) => {
    const item = user.equipment[slot];
    const info = item && client.items.get(item.itemIndex);
    const name = escape(info?.name ?? ['武器', '衣服', '头盔', '项链', '左手镯', '右手镯', '左戒指', '右戒指'][i]);
    return `<button class="item-slot equipped" data-equipment="${slot}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px" title="${name}" aria-label="${name}">${item && slot > 1 ? sprite(item) : ''}</button>`;
  }).join('');
  $('#doll-body').setAttribute('src', nativeFrame('ClassicPrguse', user.gender === 1 ? 377 : 376));
  $('#doll-clothes').innerHTML = [1, 0].map(slot => {
    const item = user.equipment[slot], info = item && client.items.get(item.itemIndex);
    const frame = info && nativeFrameSize('Stateitem', info.image);
    return frame ? `<img src="${nativeFrame('Stateitem', info.image)}" style="left:${frame.offsetX}px;top:${frame.offsetY}px" alt="">` : '';
  }).join('');
  const itemButton = (item: Data | null, slot: number, belt = false) => `<button class="item-slot ${item ? 'filled' : ''} ${selectedItem === slot ? 'selected' : ''}" data-item="${slot}" title="${escape(item ? client.items.get(item.itemIndex)?.name ?? '物品' : '空位')}" aria-label="${escape(item ? client.items.get(item.itemIndex)?.name ?? '物品' : '空位')}" ${item ? '' : 'disabled'}>${sprite(item)}${belt ? `<small class="belt-key">${slot + 1}</small>` : ''}</button>`;
  $('#inventory').innerHTML = user.inventory.slice(6, 46).map((item: Data | null, slot: number) => itemButton(item, slot + 6)).join('');
  $('#belt').innerHTML = user.inventory.slice(0, 6).map((item: Data | null, slot: number) => itemButton(item, slot, true)).join('');
  $('#bag-count').textContent = `${user.inventory.filter(Boolean).length} / ${user.inventory.length}`;
  document.querySelectorAll<HTMLElement>('[data-item]').forEach(button => {
    const slot = Number(button.dataset.item);
    button.onclick = () => {
      if (client.storing) { client.storageSelected = user.inventory[slot]?.uniqueID; client.changed(); return; }
      if (slot < 6) {
        const item = user.inventory[slot];
        if (client.selling && item) client.send('SellItem', { uniqueID: item.uniqueID, count: 1 });
        else client.useBelt(slot);
        return;
      }
      selectedItem = slot;
      document.querySelectorAll<HTMLElement>('#inventory [data-item]').forEach(cell => cell.classList.toggle('selected', Number(cell.dataset.item) === slot));
      const item = user.inventory[slot], info = item && client.items.get(item.itemIndex);
      $('#item-description').textContent = info ? `${info.name}  ${item.maxDurability ? `持久 ${Math.floor(item.durability / 1000)}/${Math.floor(item.maxDurability / 1000)}` : ''}  重量 ${info.weight}` : '';
    };
    button.ondblclick = () => useSelectedItem(slot);
    button.draggable = !!user.inventory[slot];
    button.ondragstart = event => { event.dataTransfer?.setData('text/plain', String(user.inventory[slot]?.uniqueID)); };
  });
  document.querySelectorAll<HTMLElement>('[data-equipment]').forEach(button => button.onclick = () => {
    const item = user.equipment[Number(button.dataset.equipment)];
    const slot = user.inventory.findIndex((i: Data | null, index: number) => index >= 6 && !i);
    if (item && slot >= 0) client.send('RemoveItem', { uniqueID: item.uniqueID, grid: 2, to: slot });
  });
  const item = selectedItem === undefined ? undefined : user.inventory[selectedItem];
  const info = item && client.items.get(item.itemIndex);
  $('#item-description').textContent = info ? `${info.name}  ${item.maxDurability ? `持久 ${Math.floor(item.durability / 1000)}/${Math.floor(item.maxDurability / 1000)}` : ''}  重量 ${info.weight}` : '';
  createIcons({ icons });
}

function useSelectedItem(slot = selectedItem) {
  const item = slot === undefined ? undefined : client.user?.inventory[slot];
  if (!item) return;
  if (client.storing) { client.storageSelected = item.uniqueID; client.changed(); }
  else if (client.selling) client.send('SellItem', { uniqueID: item.uniqueID, count: 1 });
  else client.equip(item);
}

function updateCharacterPreview() {
  $('#character-preview').outerHTML = characterPortrait(characterClass, characterGender, 0, false, 'character-preview');
  document.querySelectorAll<HTMLElement>('[data-class]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.class) === characterClass)));
  document.querySelectorAll<HTMLElement>('[data-gender]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.gender) === characterGender)));
}

function renderSkills() {
  const magics: Data[] = client.user?.magics ?? [];
  const signature = JSON.stringify(magics);
  if (signature === skillSignature) return;
  skillSignature = signature;
  const passive = (spell: number) => [3, 4, 7, 12].includes(spell);
  $('#skills-list').innerHTML = magics.length ? magics.map(magic => `<div class="skill-row">${itemImage(magic.spell - 1, 'MagIcon')}<span>${escape(magic.name)}<small>${magic.level} 级 · ${magic.training} 熟练度</small></span>${passive(magic.spell) ? '<small>被动</small>' : `<select data-spell="${magic.spell}" aria-label="${escape(magic.name)}快捷键"><option value="0">无</option>${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}" ${magic.key === i + 1 ? 'selected' : ''}>F${i + 1}</option>`).join('')}</select>`}</div>`).join('') : '';
  $('#quick-skills').innerHTML = magics.filter(magic => magic.key && !passive(magic.spell)).map(magic => `<button data-magic-key="${magic.key}" class="action" title="${escape(magic.name)}" aria-label="施放${escape(magic.name)}">${itemImage(magic.spell - 1, 'MagIcon')}<small>F${magic.key}</small></button>`).join('');
  document.querySelectorAll<HTMLSelectElement>('[data-spell]').forEach(select => select.onchange = () => client.setMagicKey(Number(select.dataset.spell), Number(select.value)));
  document.querySelectorAll<HTMLElement>('[data-magic-key]').forEach(button => button.onclick = () => scene.cast(Number(button.dataset.magicKey)));
}

function renderNPC() {
  const visible = !!client.npcID && (client.npcPage.length > 0 || !!client.shop || client.selling || client.storing);
  $('#npc-panel').classList.toggle('hidden', !visible);
  if (visible) { characterOpen = false; $('#character-window').classList.add('hidden'); }
  $('#shop-window').classList.toggle('hidden', !visible || !client.shop);
  $('#storage-window').classList.toggle('hidden', !visible || !client.storing);
  $('#shop-window').classList.toggle('storage-list', !!client.shop?.storage);
  $('#shop-window').setAttribute('aria-label', client.shop?.storage ? '取回物品' : '商店');
  const contents = JSON.stringify([client.npcID, client.shop?.list]);
  if (contents !== shopContents) { shopContents = contents; shopTop = 0; selectedGood = undefined; }
  const signature = JSON.stringify([client.npcID, client.npcPage, client.shop, client.selling, client.storing, client.storageSelected, client.storagePending, shopTop]);
  if (!visible || signature === npcSignature) return;
  npcSignature = signature;
  const stored = client.user?.inventory.find((item: Data | null) => item?.uniqueID === client.storageSelected);
  $('#storage-slot').innerHTML = stored ? itemImage(client.items.get(stored.itemIndex)?.image ?? 30) : '';
  $('#storage-slot').title = stored?.name ?? '保管物品';
  $<HTMLButtonElement>('#storage-confirm').disabled = !stored || client.storagePending;
  $('.shop-head').innerHTML = client.shop?.storage ? '<span>保管物品</span><span>持久</span><span></span>' : '<span>名称</span><span>价格</span><span>持久</span>';
  $('#shop-buy').title = client.shop?.storage ? '取回选中物品' : '购买选中商品';
  $('#shop-buy').setAttribute('aria-label', $('#shop-buy').title);
  $('#npc-page').innerHTML = client.npcPage.map(line => {
    const tokens = line.replace(/\\/g, '').split(/(<[^<>]+\/@[A-Za-z0-9_]+>)/g);
    return `<p>${tokens.map(token => { const match = /^<([^<>]+)\/(@[A-Za-z0-9_]+)>$/.exec(token); return match ? `<button class="npc-link" data-npc-key="[${match[2]}]">${escape(match[1])}</button>` : escape(token); }).join('')}</p>`;
  }).join('');
  $('#shop-list').innerHTML = client.shop ? client.shop.list.slice(shopTop, shopTop + 10).map((item: Data) => {
    const info = client.items.get(item.itemIndex);
    const name = item.name ?? info?.name;
    return `<button class="shop-item ${item.uniqueID === selectedGood ? 'selected' : ''}" data-purchase="${item.uniqueID}" ${client.storagePending ? 'disabled' : ''} title="${client.shop!.storage ? '取回' : item.submenu ? '查看' : '购买'}${escape(name)}"><span>${escape(name)}</span><span>${client.shop!.storage ? `${Math.floor(item.durability / 1000)}/${Math.floor(item.maxDurability / 1000)}` : Math.round((item.price ?? info?.price ?? 0) * (client.shop!.rate ?? 1))}</span><span>${!client.shop!.storage && item.durability ? Math.floor(item.durability / 1000) : ''}</span></button>`;
  }).join('') : '';
  document.querySelectorAll<HTMLElement>('[data-npc-key]').forEach(button => button.onclick = () => { if (button.dataset.npcKey === '[@EXIT]') { client.closeNPC(); client.changed(); } else client.callNPC(client.npcID!, button.dataset.npcKey); });
  document.querySelectorAll<HTMLElement>('[data-purchase]').forEach(button => {
    button.onclick = () => {
      selectedGood = Number(button.dataset.purchase);
      document.querySelectorAll<HTMLElement>('[data-purchase]').forEach(row => row.classList.toggle('selected', Number(row.dataset.purchase) === selectedGood));
      $<HTMLButtonElement>('#shop-buy').disabled = client.storagePending;
    };
    button.ondblclick = () => activateGood(Number(button.dataset.purchase));
  });
  $<HTMLButtonElement>('#shop-buy').disabled = selectedGood === undefined || client.storagePending;
  if ((client.selling || client.storing || client.shop?.storage) && panel !== 'bag') { panel = 'bag'; update(); }
}

function activateGood(uniqueID: number) {
  if (client.shop?.storage) client.storageItem(uniqueID, false);
  else client.send('BuyItem', { itemIndex: uniqueID, count: 1, type: 0 });
}

function update() {
  renderModal();
  const inGame = client.phase === 'game';
  document.body.classList.toggle('in-game', inGame);
  $('#connection-status').textContent = client.ready ? '已连接' : client.connected ? '连接中' : '离线';
  $('#status-dot').classList.toggle('online', client.ready);
  $('#player-hud').classList.toggle('hidden', !inGame);
  $('#sidepanel').classList.toggle('hidden', !inGame || !['bag', 'chat'].includes(panel));
  $('#character-window').classList.toggle('hidden', !inGame || (!characterOpen && panel !== 'skills'));
  $('#paperdoll').classList.toggle('hidden', panel === 'skills');
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
  $('#character-title').textContent = u.name;
  $('#character-details').textContent = `${classes[u.class]} ${u.level} 级`;
  $('#player-level').textContent = `${classes[u.class]} · ${u.level} 级`;
  $<HTMLImageElement>('#portrait').src = portrait(u.class, u.gender);
  const maxHP = client.maximum(0), maxMP = client.maximum(1);
  $('#hp-text').textContent = `${u.hp} / ${maxHP}`;
  $('#mp-text').textContent = `${u.mp} / ${maxMP}`;
  $('#hp-fill').style.width = `${Math.min(100, u.hp / maxHP * 100)}%`;
  $('#mp-fill').style.width = `${Math.min(100, u.mp / maxMP * 100)}%`;
  $('#orb-hp').style.clipPath = `inset(${100 - Math.min(100, u.hp / maxHP * 100)}% 50% 0 0)`;
  $('#orb-mp').style.clipPath = `inset(${100 - Math.min(100, u.mp / maxMP * 100)}% 0 0 50%)`;
  const redOnly = u.class === 0 && u.level < 28;
  $('.blood-orb').classList.toggle('red-only', redOnly);
  if (redOnly) $('#orb-hp').style.clipPath = `inset(${100 - Math.min(100, u.hp / maxHP * 100)}% 0 0 0)`;
  $('#realm-vitals').textContent = `HP ${u.hp}/${maxHP}  MP ${u.mp}/${maxMP}`;
  $('#coordinates').textContent = `${u.location.x}, ${u.location.y}`;
  $('.world-name span').textContent = currentMap.name;
  $('.realm-label > span:last-child').textContent = `${currentMap.name} ${u.location.x}:${u.location.y}`;
  $('#world').setAttribute('aria-label', currentMap.name + '游戏地图');
  $('#minimap-wrap').classList.toggle('hidden', currentMap.id !== '0');
  $('#gold').textContent = `金币 ${u.gold.toLocaleString()}`;
  $('#experience-text').textContent = `${u.experience} / ${u.maxExperience} 经验`;
  $('#experience-fill').style.width = `${Math.min(100, u.experience / Math.max(1, u.maxExperience) * 100)}%`;
  $('#weight-fill').style.width = `${Math.min(100, (u.weight ?? 0) / Math.max(1, u.maxWeight ?? 1) * 100)}%`;
  $('.experience').title = `经验 ${u.experience}/${u.maxExperience}`;
  $('.weight-meter').title = `负重 ${u.weight ?? 0}/${u.maxWeight ?? 0}`;
  $('#health-count').textContent = String(u.inventory.filter((i: Data | null) => i && client.items.get(i.itemIndex)?.name.startsWith('金创药')).reduce((n: number, i: Data) => n + i.count, 0));
  $('#mana-count').textContent = String(u.inventory.filter((i: Data | null) => i && client.items.get(i.itemIndex)?.name.startsWith('魔法药')).reduce((n: number, i: Data) => n + i.count, 0));
  const target = client.selected && client.objects.get(client.selected);
  $('#target-hud').classList.add('hidden');
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
$('#native-bag-toggle').onclick = () => { panel = panel === 'bag' ? 'none' : 'bag'; update(); };
$('#native-skills-toggle').onclick = () => { panel = panel === 'skills' ? 'none' : 'skills'; update(); };
$('#character-toggle').onclick = () => { characterOpen = !characterOpen; if (panel === 'skills') panel = 'none'; update(); };
$('#close-character').onclick = () => { characterOpen = false; if (panel === 'skills') panel = 'none'; update(); };
$('#character-equipment').onclick = () => { panel = 'none'; characterOpen = true; update(); };
$('#character-skills').onclick = () => { panel = 'skills'; update(); };
$('#close-bag').onclick = () => { panel = 'none'; update(); };
$('#use-selected').onclick = () => useSelectedItem();
$('#map-toggle').onclick = () => $('#minimap-wrap').classList.toggle('minimap-hidden');
$('#shop-prev').onclick = () => { shopTop = Math.max(0, shopTop - 10); renderNPC(); };
$('#shop-next').onclick = () => { if (client.shop && shopTop + 10 < client.shop.list.length) shopTop += 10; renderNPC(); };
$('#shop-buy').onclick = () => { if (selectedGood !== undefined) activateGood(selectedGood); };
$('#storage-confirm').onclick = () => { if (client.storageSelected !== undefined) client.storageItem(client.storageSelected, true); };
$('#storage-slot').onclick = () => { client.storageSelected = undefined; client.changed(); };
$('#storage-slot').ondragover = event => { if (client.storing && !client.storagePending) event.preventDefault(); };
$('#storage-slot').ondrop = event => {
  event.preventDefault();
  const id = Number(event.dataTransfer?.getData('text/plain'));
  if (client.storing && !client.storagePending && client.user?.inventory.some((item: Data | null) => item?.uniqueID === id)) { client.storageSelected = id; client.changed(); }
};
$('#close-storage').onclick = () => { client.storing = false; client.storageSelected = undefined; client.changed(); };
$('#close-shop').onclick = () => { client.shop = undefined; client.changed(); };
$('#close-npc').onclick = () => { client.closeNPC(); client.changed(); };
document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) return;
  if (['F9', 'F10', 'F11', 'b', 'B', 'Escape'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'F10') { characterOpen = !characterOpen; if (panel === 'skills') panel = 'none'; }
    else if (event.key === 'Escape') { panel = 'none'; characterOpen = false; client.closeNPC(); }
    else panel = event.key === 'F11' ? panel === 'skills' ? 'none' : 'skills' : panel === 'bag' ? 'none' : 'bag';
    update();
  }
  if (event.key === 'Enter' && client.phase === 'game') { event.preventDefault(); panel = 'chat'; update(); $('#chat-input').focus(); }
});
$('#chat-form').onsubmit = event => { event.preventDefault(); const input = $<HTMLInputElement>('#chat-input'); const message = input.value.trim(); if (message) client.send('Chat', { message }); input.value = ''; };
document.querySelectorAll<HTMLElement>('[data-dir]').forEach(button => button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); scene.held = Number(button.dataset.dir); scene.target = undefined; scene.step(scene.held); });
document.addEventListener('pointerup', () => { scene.held = undefined; });
document.addEventListener('pointercancel', () => { scene.held = undefined; });
window.addEventListener('blur', () => { scene.held = undefined; });

const audio = new ClassicAudio();
$('#sound-toggle').onclick = async () => {
  const sound = await audio.toggle();
  $('#sound-toggle').innerHTML = icon(sound ? 'volume-2' : 'volume-x');
  $('#sound-toggle').setAttribute('aria-pressed', String(sound));
  createIcons({ icons });
};
$('#native-sound-toggle').onclick = () => $('#sound-toggle').click();
client.addEventListener('packet', (event: Event) => {
  const packet = (event as CustomEvent).detail;
  if (packet.type === 'LoginSuccess' || packet.type === 'DeleteCharacterFailed' || packet.type === 'Ready') deletingCharacter = false;
  if (packet.type === 'UserInformation') { mode = 'login'; creatingCharacter = false; panel = 'none'; characterOpen = false; selectedItem = undefined; inventorySignature = ''; skillSignature = ''; }
  if (packet.type === 'MagicEffect' && packet.data.effect === 1) { void audio.play('M31-0'); void audio.play('M31-1', .5); }
  if (packet.type === 'MagicEffect' && packet.data.effect === 2) { void audio.play('M61-0'); void audio.play('M61-2', .5); }
  if (packet.type === 'DamageIndicator' && packet.data.objectID === client.user?.objectID) void audio.play(client.user?.gender === 1 ? '139' : '138');
  if (packet.type === 'Death') void audio.play(client.user?.gender === 1 ? '145' : '144');
  if (packet.type === 'GainedGold') void audio.play('106');
});
client.addEventListener('change', update);
client.connect();
update();
setInterval(() => { if (client.phase === 'game') update(); }, 1000);
let portraitFrame = 0;
setInterval(() => {
  if (document.hidden || client.phase !== 'characters') return;
  portraitFrame = (portraitFrame + 1) % 16;
  document.querySelectorAll<HTMLElement>('.chr-portrait.animated').forEach(node => { node.style.backgroundPosition = `${-(portraitFrame % 4) * Number(node.dataset.frameWidth)}px ${-Math.floor(portraitFrame / 4) * Number(node.dataset.frameHeight)}px`; });
}, 300);
