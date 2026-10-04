import WebSocket from 'ws';
import PF from 'pathfinding';

export const baseURL = process.env.MIR_URL ?? 'http://127.0.0.1:18880';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const directions = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const directionTo = (x, y) => directions.findIndex(([dx, dy]) => dx === Math.sign(x) && dy === Math.sign(y));
const collisions = new Map();

export async function waitHealthy() {
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(`${baseURL}/healthz`)).ok) return; } catch {}
    await delay(500);
  }
  throw new Error('OpenMir2 did not become healthy');
}

export async function register(accountID, password) {
  const response = await fetch(`${baseURL}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(baseURL).origin }, body: JSON.stringify({ accountID, password }) });
  if (!response.ok) throw new Error(`Registration HTTP ${response.status}`);
  const result = await response.json();
  if (result.result !== 8) throw new Error(`Registration result ${result.result}`);
}

export class Session {
  events = [];
  objects = new Map();
  items = new Map();
  map = '0';
  constructor() {
    this.socket = new WebSocket(baseURL.replace('http', 'ws') + '/ws', { origin: new URL(baseURL).origin });
    this.socket.on('message', bytes => {
      const packet = JSON.parse(bytes.toString());
      this.events.push(packet);
      const d = packet.data;
      if (packet.type === 'UserInformation') this.user = d;
      if (packet.type === 'MapInformation') { this.map = d.map; this.objects.clear(); }
      if (packet.type === 'UserLocation' && this.user) Object.assign(this.user, d);
      if (['UserAbility', 'UserGold', 'UserExperience', 'LevelChanged', 'HealthChanged', 'UserSlotsRefresh', 'UserMagics'].includes(packet.type) && this.user) Object.assign(this.user, d);
      if (['ObjectPlayer', 'ObjectMonster', 'ObjectNPC', 'ObjectGold', 'ObjectItem'].includes(packet.type)) this.objects.set(d.objectID, { ...d, type: packet.type });
      if (['ObjectWalk', 'ObjectTurn', 'ObjectRun'].includes(packet.type) && this.objects.has(d.objectID)) Object.assign(this.objects.get(d.objectID), d);
      if (packet.type === 'ObjectDied' && this.objects.has(d.objectID)) Object.assign(this.objects.get(d.objectID), { dead: true, location: d.location });
      if (packet.type === 'ObjectRemove') this.objects.delete(d.objectID);
      if (packet.type === 'NewItemInfo') this.items.set(d.info.index, d.info);
      if (packet.type === 'Death') this.dead = true;
    });
    this.socket.on('error', error => { this.error = error; });
  }
  send(type, data = {}) { this.socket.send(JSON.stringify({ type, data })); }
  async wait(type, predicate = () => true, timeout = 15000, after = 0) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const packet = this.events.slice(after).find(p => p.type === type && predicate(p.data));
      if (packet) return packet.data;
      if (this.error) throw this.error;
      if (type === 'LoginSuccess' && this.events.slice(after).some(p => p.type === 'Login')) throw new Error(`Login failed: ${JSON.stringify(this.events.at(-1))}`);
      if (type === 'UserInformation' && this.events.slice(after).some(p => p.type === 'StartGame' || p.type === 'NewCharacter')) throw new Error(`Enter failed: ${JSON.stringify(this.events.at(-1))}`);
      if (this.socket.readyState === WebSocket.CLOSED) throw new Error(`Socket closed while waiting for ${type}; last packets: ${this.events.slice(-5).map(e => e.type).join(', ')}`);
      await delay(25);
    }
    throw new Error(`Timeout waiting for ${type}; last packets: ${this.events.slice(-8).map(e => e.type).join(', ')}`);
  }
  async login(accountID, password) {
    await this.wait('Ready');
    const after = this.events.length;
    this.send('Login', { accountID, password });
    return this.wait('LoginSuccess', () => true, 15000, after);
  }
  async create(name, job = 0, gender = 0) {
    const after = this.events.length;
    this.send('NewCharacter', { name, class: job, gender });
    await this.wait('UserInformation', () => true, 15000, after);
    await this.wait('UserAbility', () => true, 15000, after);
    await this.wait('UserSlotsRefresh', d => d.inventory.some(Boolean), 15000, after);
    return this.user;
  }
  async enter(index) {
    const after = this.events.length;
    this.send('StartGame', { characterIndex: index });
    await this.wait('UserInformation', () => true, 15000, after);
    await this.wait('UserAbility', () => true, 15000, after);
    await delay(500);
    return this.user;
  }
  async walk(direction) {
    const after = this.events.length;
    this.send('Walk', { direction });
    await this.wait('UserLocation', () => true, 5000, after);
    await delay(650);
  }
  async pathTo(x, y, radius = 0) {
    if (!collisions.has(this.map)) collisions.set(this.map, (await (await fetch(`${baseURL}/assets/classic/${this.map === '0' ? '' : `maps/${this.map}/`}collision.json`)).json()).rows);
    const rows = collisions.get(this.map);
    const p = this.user.location, margin = 25;
    const left = Math.max(0, Math.min(p.x, x) - margin), top = Math.max(0, Math.min(p.y, y) - margin);
    const right = Math.min(rows[0].length - 1, Math.max(p.x, x) + margin), bottom = Math.min(rows.length - 1, Math.max(p.y, y) + margin);
    const grid = new PF.Grid(Array.from({ length: bottom - top + 1 }, (_, b) => Array.from({ length: right - left + 1 }, (_, a) => rows[top + b][left + a] === '0' ? 0 : 1)));
    for (const e of this.objects.values()) {
      if (!e.dead && ['ObjectPlayer', 'ObjectMonster', 'ObjectNPC'].includes(e.type) && e.location.x >= left && e.location.x <= right && e.location.y >= top && e.location.y <= bottom) grid.setWalkableAt(e.location.x - left, e.location.y - top, false);
    }
    grid.setWalkableAt(p.x - left, p.y - top, true);
    const finder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
    let best = [];
    for (let a = x - radius; a <= x + radius; a++) for (let b = y - radius; b <= y + radius; b++) {
      if (a < left || a > right || b < top || b > bottom) continue;
      if (radius && !grid.isWalkableAt(a - left, b - top)) continue;
      const candidate = grid.clone();
      candidate.setWalkableAt(a - left, b - top, true);
      const path = finder.findPath(p.x - left, p.y - top, a - left, b - top, candidate);
      if (path.length && (!best.length || path.length < best.length)) best = path;
    }
    return best.map(([a, b]) => [a + left, b + top]);
  }
  async moveNear(x, y, radius = 3) { return this.moveTo(x, y, 300, radius); }
  async moveTo(x, y, maximumSteps = 300, radius = 0) {
    let blocked = 0;
    for (let i = 0; i < maximumSteps; i++) {
      const p = { ...this.user.location };
      if (Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= radius) return;
      const path = await this.pathTo(x, y, radius);
      if (path.length < 2) throw new Error(`No path to ${x}, ${y}`);
      await this.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
      blocked = this.user.location.x === p.x && this.user.location.y === p.y ? blocked + 1 : 0;
      if (blocked >= 3) await delay(500);
      if (blocked >= 12) throw new Error(`Server blocked path at ${p.x}, ${p.y}`);
    }
    throw new Error(`Unable to reach ${x}, ${y}`);
  }
  async equipStarter() {
    const weapon = this.user.inventory.find(i => i && this.items.get(i.itemIndex)?.type === 1);
    if (!weapon) throw new Error('OpenMir2 did not supply a starter weapon');
    const after = this.events.length;
    this.send('EquipItem', { uniqueID: weapon.uniqueID, grid: 1, to: 0 });
    await this.wait('UserSlotsRefresh', d => d.equipment[0]?.uniqueID === weapon.uniqueID, 10000, after);
    return weapon;
  }
  async seekMonster(names, waypoints = [[280, 610], [270, 600], [260, 610], [270, 625]]) {
    for (const [x, y] of waypoints) {
      for (let step = 0; step < 80; step++) {
        const p = this.user.location;
        const found = [...this.objects.values()].filter(o => o.type === 'ObjectMonster' && !o.dead && names.includes(o.name) && Math.max(Math.abs(o.location.x - p.x), Math.abs(o.location.y - p.y)) <= 8)
          .sort((a, b) => Math.hypot(a.location.x - p.x, a.location.y - p.y) - Math.hypot(b.location.x - p.x, b.location.y - p.y))[0];
        if (found) return found;
        if (p.x === x && p.y === y) break;
        const path = await this.pathTo(x, y);
        if (path.length < 2) break;
        await this.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
      }
    }
    throw new Error(`No native ${names.join('/')} found on patrol`);
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise(resolve => this.socket.once('close', resolve));
    this.socket.close();
    await Promise.race([closed, delay(2000).then(() => this.socket.terminate())]);
  }
  async equipClothes() {
    const clothes = this.user.inventory.find(i => i && this.items.get(i.itemIndex)?.type === 2);
    if (!clothes) throw new Error('OpenMir2 did not supply starter clothes');
    const after = this.events.length;
    this.send('EquipItem', { uniqueID: clothes.uniqueID, to: 1 });
    await this.wait('UserSlotsRefresh', d => d.equipment[1]?.uniqueID === clothes.uniqueID, 10000, after);
    return clothes;
  }
  async logout() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise(resolve => this.socket.once('close', resolve));
    this.send('LogOut');
    let timer;
    try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native logout did not close the session')), 10000); })]); }
    finally { clearTimeout(timer); }
    await delay(2000);
  }
  async fight(targetID, maximumActions = 100) {
    const after = this.events.length;
    for (let i = 0; i < maximumActions; i++) {
      const target = this.objects.get(targetID);
      if (target?.dead) return target;
      if (!target) throw new Error('Combat target left the visible area');
      if (this.dead) throw new Error('Player died in combat');
      if (this.user.hp < this.user.maxHP * 0.65) {
        const potion = this.user.inventory.find(item => item?.name.startsWith('金创药'));
        if (potion) { this.send('UseItem', { uniqueID: potion.uniqueID }); await delay(800); }
      }
      const p = this.user.location, m = target.location;
      if (Math.max(Math.abs(p.x - m.x), Math.abs(p.y - m.y)) <= 1) {
        this.send('Attack', { direction: directionTo(m.x - p.x, m.y - p.y) });
        await delay(1050);
      } else {
        const path = await this.pathTo(m.x, m.y);
        if (path.length < 2) throw new Error('Combat target is unreachable');
        await this.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
      }
    }
    throw new Error(`Combat timed out: ${JSON.stringify(this.events.slice(after).filter(p => ['DamageIndicator','Chat','UserExperience'].includes(p.type)).slice(-8))}`);
  }
}
