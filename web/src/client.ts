export type Data = Record<string, any>;
export type Message = { type: string; data: Data };
export type Entity = Data & { objectID: number; kind: 'player' | 'monster' | 'npc' | 'item' | 'gold'; location: { x: number; y: number } };

export class MirClient extends EventTarget {
  socket?: WebSocket;
  connected = false;
  ready = false;
  phase: 'login' | 'characters' | 'game' = 'login';
  user?: Data;
  characters: Data[] = [];
  objects = new Map<number, Entity>();
  items = new Map<number, Data>();
  baseStats: Data[] = [];
  logs: { text: string; kind: string }[] = [];
  error = '';
  accountID = localStorage.getItem('mir-account') ?? '';
  pendingLogin?: { accountID: string; password: string };
  selected?: number;
  dead = false;
  npcID?: number;
  npcPage: string[] = [];
  shop?: Data;
  selling = false;
  storing = false;
  storageSelected?: number;
  storagePending = false;
  lastLocationAt = 0;
  loggingOut = false;

  connect() {
    this.socket?.close();
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.socket = socket;
    this.error = '';
    socket.onopen = () => { this.connected = true; this.changed(); };
    socket.onmessage = event => this.receive(JSON.parse(event.data));
    socket.onclose = () => {
      if (this.socket !== socket) return;
      const normalLogout = this.loggingOut;
      this.connected = this.ready = false;
      this.pendingLogin = undefined;
      if (this.phase !== 'login' && !this.loggingOut) this.error = '连接已断开，请重新登录';
      this.loggingOut = false;
      this.phase = 'login';
      this.closeNPC();
      this.changed();
      if (normalLogout) setTimeout(() => { if (this.socket === socket) this.connect(); }, 750);
    };
    socket.onerror = () => { this.error = '暂时无法连接服务器'; this.changed(); };
  }
  send(type: string, data: Data = {}) {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, data }));
  }
  login(accountID: string, password: string) {
    this.accountID = accountID;
    localStorage.setItem('mir-account', accountID);
    this.pendingLogin = { accountID, password };
    if (!this.connected) this.connect();
    else if (this.ready) this.send('Login', this.pendingLogin);
  }
  logout() {
    this.loggingOut = true;
    this.send('LogOut');
  }
  log(text: string, kind = 'system') {
    this.logs.push({ text, kind });
    if (this.logs.length > 60) this.logs.shift();
  }
  changed() { this.dispatchEvent(new Event('change')); }
  receive(message: Message) {
    const d = message.data;
    this.dispatchEvent(new CustomEvent('packet', { detail: message }));
    switch (message.type) {
      case 'Ready': this.ready = true; if (this.pendingLogin) this.send('Login', this.pendingLogin); break;
      case 'Login': this.pendingLogin = undefined; this.error = ['登录暂不可用', '账号格式不正确', '密码格式不正确', '账号不存在', '密码不正确', '账号已在线，请稍后重试'][d.result] ?? '登录失败'; break;
      case 'LoginSuccess': this.pendingLogin = undefined; this.error = ''; this.characters = d.characters; this.phase = 'characters'; break;
      case 'NewCharacter': this.error = ['暂不可创建角色', '角色名格式不正确', '请选择性别', '请选择职业', '角色数量已满', '角色名已被使用'][d.result] ?? '创建失败'; break;
      case 'DeleteCharacterFailed': this.error = d.message; break;
      case 'NewCharacterSuccess': this.characters.push(d.charInfo); this.error = ''; this.send('StartGame', { characterIndex: d.charInfo.index }); break;
      case 'StartGame': if (d.result !== 4) this.error = ['暂不可进入游戏', '请先登录', '角色不存在', '进入游戏失败'][d.result] ?? ''; break;
      case 'UserInformation':
        this.user = d; this.dead = false; this.phase = 'game'; this.objects.clear(); this.selected = undefined; this.error = '';
        this.storagePending = false;
        this.log(`${d.name} 来到了比奇省`, 'notice'); break;
      case 'MapInformation': case 'MapChanged':
        this.objects.clear(); this.selected = undefined;
        this.closeNPC();
        if (this.user && d.location) { this.user.location = d.location; this.user.direction = d.direction; this.user.map = d.map; }
        break;
      case 'UserLocation': if (this.user) { this.user.location = d.location; this.user.direction = d.direction; this.lastLocationAt = performance.now(); } break;
      case 'ObjectPlayer': case 'ObjectMonster': case 'ObjectNPC': case 'ObjectItem': case 'ObjectGold': {
        const kinds: Record<string, Entity['kind']> = { ObjectPlayer: 'player', ObjectMonster: 'monster', ObjectNPC: 'npc', ObjectItem: 'item', ObjectGold: 'gold' };
        this.objects.set(d.objectID, { ...d, objectID: d.objectID, location: d.location, kind: kinds[message.type] }); break;
      }
      case 'ObjectWalk': case 'ObjectRun': case 'ObjectTurn': case 'ObjectAttack': {
        const entity = this.objects.get(d.objectID);
        if (entity) { entity.location = d.location; entity.direction = d.direction; }
        break;
      }
      case 'ObjectRemove': this.objects.delete(d.objectID); if (this.selected === d.objectID) this.selected = undefined; break;
      case 'ObjectDied': { const entity = this.objects.get(d.objectID); if (entity) { entity.dead = true; entity.location = d.location; } break; }
      case 'ObjectRevived': { const entity = this.objects.get(d.objectID); if (entity) entity.dead = false; break; }
      case 'ObjectHealth': { const entity = this.objects.get(d.objectID); if (entity) entity.percent = d.percent; break; }
      case 'HealthChanged': if (this.user) { this.user.hp = d.hp; if (d.mp >= 0) this.user.mp = d.mp; } break;
      case 'UserAbility': if (this.user) Object.assign(this.user, d); break;
      case 'UserGold': if (this.user) this.user.gold = d.gold; break;
      case 'UserMagics': if (this.user) this.user.magics = d.magics; break;
      case 'UserExperience': if (this.user) this.user.experience = d.experience; this.log(`经验 +${d.amount}`, 'reward'); break;
      case 'BaseStatsInfo': this.baseStats = d.stats.stats; break;
      case 'GainExperience': if (this.user) this.user.experience += d.amount; this.log(`经验 +${d.amount}`, 'reward'); break;
      case 'LevelChanged': if (this.user) Object.assign(this.user, d); this.log(`升至 ${d.level} 级`, 'reward'); break;
      case 'NewItemInfo': this.items.set(d.info.index, d.info); break;
      case 'NewMagic': if (this.user && !d.hero) { this.user.magics ??= []; const existing = this.user.magics.find((magic: Data) => magic.spell === d.magic.spell); if (existing) Object.assign(existing, d.magic); else { this.user.magics.push(d.magic); this.log(`学会了 ${d.magic.name}`, 'notice'); } } break;
      case 'MagicLeveled': if (this.user) { const magic = this.user.magics?.find((magic: Data) => magic.spell === d.spell); if (magic) Object.assign(magic, d); } break;
      case 'MagicKey': if (this.user) { const magic = this.user.magics?.find((magic: Data) => magic.spell === d.spell); if (magic) magic.key = d.key; } break;
      case 'NPCResponse': this.npcPage = d.page; this.shop = undefined; this.selling = this.storing = false; this.storageSelected = undefined; break;
      case 'NPCGoods': this.shop = d; this.selling = this.storing = false; break;
      case 'NPCSell': this.selling = true; this.storing = false; this.shop = undefined; break;
      case 'NPCStorage': if (this.npcID === d.objectID) { this.storing = true; this.selling = false; this.shop = undefined; this.storageSelected = undefined; } break;
      case 'NPCStorageList': if (this.npcID === d.objectID) { this.shop = { ...d, storage: true }; this.storing = this.selling = false; } break;
      case 'StorageResult': this.storagePending = false; this.storageSelected = undefined; if (!d.success) this.log(d.message); break;
      case 'NPCUpdate': if (d.type === 0) this.closeNPC(); break;
      case 'TransactionFailed': this.log(d.message); break;
      case 'SellItem': if (d.success && this.user) { const index = this.user.inventory.findIndex((item: Data | null) => item?.uniqueID === d.uniqueID); if (index >= 0) { this.user.inventory[index].count -= d.count; if (this.user.inventory[index].count <= 0) this.user.inventory[index] = null; } } break;
      case 'UserSlotsRefresh': if (this.user) { if (d.inventory) this.user.inventory = d.inventory; if (d.equipment) this.user.equipment = d.equipment; } break;
      case 'GainedItem':
        if (this.user) {
          const item = d.item;
          const existing = this.user.inventory.find((i: Data | null) => i?.itemIndex === item.itemIndex && (i?.count ?? 0) < (this.items.get(item.itemIndex)?.stackSize ?? 1));
          if (existing) existing.count += item.count;
          else { const slot = this.user.inventory.findIndex((i: Data | null) => !i); if (slot >= 0) this.user.inventory[slot] = item; }
          this.log(`获得 ${this.items.get(item.itemIndex)?.name ?? '物品'} ×${item.count}`, 'reward');
        } break;
      case 'GainedGold': if (this.user) this.user.gold += d.gold; this.log(`金币 +${d.gold}`, 'reward'); break;
      case 'LoseGold': if (this.user) this.user.gold -= d.gold; break;
      case 'EquipItem':
        if (d.success && this.user) {
          const slot = this.user.inventory.findIndex((i: Data | null) => i?.uniqueID === d.uniqueID);
          if (slot >= 0) { const old = this.user.equipment[d.to]; this.user.equipment[d.to] = this.user.inventory[slot]; this.user.inventory[slot] = old; }
        } break;
      case 'RemoveItem':
        if (d.success && this.user) {
          const slot = this.user.equipment.findIndex((i: Data | null) => i?.uniqueID === d.uniqueID);
          if (slot >= 0) { this.user.inventory[d.to] = this.user.equipment[slot]; this.user.equipment[slot] = null; }
        } break;
      case 'DeleteItem':
        if (this.user) {
          const slot = this.user.inventory.findIndex((i: Data | null) => i?.uniqueID === d.uniqueID);
          if (slot >= 0) { this.user.inventory[slot].count -= d.count; if (this.user.inventory[slot].count <= 0) this.user.inventory[slot] = null; }
        } break;
      case 'UseItem':
        if (d.success && this.user) {
          const slot = this.user.inventory.findIndex((i: Data | null) => i?.uniqueID === d.uniqueID);
          if (slot >= 0) { this.user.inventory[slot].count--; if (this.user.inventory[slot].count <= 0) this.user.inventory[slot] = null; }
        } break;
      case 'ItemCountChanged':
        if (this.user) { const item = this.user.inventory.find((i: Data | null) => i?.uniqueID === d.uniqueID); if (item) item.count = d.count; } break;
      case 'Death': this.dead = true; if (this.user) { this.user.hp = 0; this.user.location = d.location; } break;
      case 'Revived': this.dead = false; break;
      case 'Chat': this.log(d.message, 'chat'); break;
      case 'ObjectChat': this.log(d.text, 'chat'); break;
      case 'ReturnToLogin': case 'Disconnect': this.socket?.close(); break;
      case 'LogOutSuccess':
        this.characters = d.characters; this.user = undefined; this.objects.clear(); this.selected = undefined; this.phase = 'characters'; break;
      case 'LogOutFailed': this.log('当前无法退出，请稍后重试', 'system'); break;
    }
    this.changed();
  }
  maximum(type: number) {
    if (!this.user) return 1;
    if (type === 0 && this.user.maxHP) return this.user.maxHP;
    if (type === 1 && this.user.maxMP) return this.user.maxMP;
    const level = this.user.level, job = this.user.class;
    const stat = this.baseStats.find(s => s.type === type);
    if (!stat) return Math.max(1, type === 0 ? this.user.hp : this.user.mp);
    let result = stat.base;
    if (stat.gain) {
      if (type === 0) result += (level / stat.gain + stat.gainRate + (job === 0 ? level / 20 : 0)) * level;
      else if (job === 1) result += (level / stat.gain + 2) * 2.2 * level + level * stat.gainRate;
      else if (job === 2) result += level / stat.gain * 2.2 * level + level * stat.gainRate;
      else result += level * (stat.gain + stat.gainRate);
    }
    return Math.max(1, Math.floor(result));
  }
  usePotion(mana = false) {
    const item = this.user?.inventory.find((i: Data | null) => i && this.items.get(i.itemIndex)?.name.startsWith(mana ? '魔法药' : '金创药'));
    if (item) this.send('UseItem', { uniqueID: item.uniqueID, grid: 1 });
  }
  useBelt(slot: number) {
    const item = this.user?.inventory[slot];
    if (item && this.items.get(item.itemIndex)?.stdMode <= 3 && !this.dead) this.send('UseItem', { uniqueID: item.uniqueID, grid: 1 });
  }
  setMagicKey(spell: number, key: number) {
    const magic = this.user?.magics?.find((entry: Data) => entry.spell === spell);
    if (!magic || !this.ready) return;
    this.send('MagicKey', { spell, key, oldKey: magic.key });
    for (const entry of this.user!.magics) if (entry.key === key && key) entry.key = 0;
    magic.key = key;
    this.changed();
  }
  equip(item: Data) {
    const info = this.items.get(item.itemIndex);
    if (info?.type === 13 || info?.type === 14) { this.send('UseItem', { uniqueID: item.uniqueID, grid: 1 }); return; }
    const slots: Record<number, number> = { 1: 0, 2: 1, 4: 2, 5: 4, 6: 5, 7: 7, 8: 9, 9: 10, 10: 11, 11: 12 };
    if (info && slots[info.type] !== undefined) {
      let to = slots[info.type];
      if ([6, 7].includes(info.type) && this.user?.equipment[to] && !this.user?.equipment[to + 1]) to++;
      this.send('EquipItem', { uniqueID: item.uniqueID, grid: 1, to });
    }
  }
  callNPC(objectID: number, key = '') { this.npcID = objectID; this.send('CallNPC', { objectID, key }); }
  storageItem(uniqueID: number, deposit: boolean) {
    if (!this.ready || this.dead || !this.npcID || this.storagePending) return;
    this.storagePending = true;
    this.send(deposit ? 'StoreItem' : 'WithdrawItem', { uniqueID });
    this.changed();
  }
  closeNPC() { this.npcID = undefined; this.npcPage = []; this.shop = undefined; this.selling = this.storing = false; this.storageSelected = undefined; }
}
export const client = new MirClient();
