import WebSocket from 'ws';
import PF from 'pathfinding';
import { readFile } from 'node:fs/promises';

export const baseURL = process.env.MIR_URL ?? 'http://127.0.0.1:18880';
export const world = JSON.parse(await readFile(new URL('../shared/world.json', import.meta.url)));
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const directions = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const directionTo = (x, y) => directions.findIndex(([dx, dy]) => dx === Math.sign(x) && dy === Math.sign(y));

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
  constructor() {
    this.socket = new WebSocket(baseURL.replace('http', 'ws') + '/ws', { origin: new URL(baseURL).origin });
    this.socket.on('message', bytes => {
      const packet = JSON.parse(bytes.toString());
      this.events.push(packet);
      const d = packet.data;
      if (packet.type === 'UserInformation') this.user = d;
      if (packet.type === 'UserLocation') this.user.location = d.location;
      if (packet.type === 'HealthChanged' && this.user) { this.user.hp = d.hp; this.user.mp = d.mp; }
      if (['ObjectPlayer', 'ObjectMonster', 'ObjectGold', 'ObjectItem'].includes(packet.type)) this.objects.set(d.objectID, { ...d, type: packet.type });
      if (['ObjectWalk', 'ObjectTurn', 'ObjectRun'].includes(packet.type) && this.objects.has(d.objectID)) Object.assign(this.objects.get(d.objectID), d);
      if (packet.type === 'ObjectDied' && this.objects.has(d.objectID)) this.objects.get(d.objectID).dead = true;
      if (packet.type === 'ObjectRemove') this.objects.delete(d.objectID);
      if (packet.type === 'NewItemInfo') this.items.set(d.info.index, d.info);
      if (packet.type === 'GainedGold') this.user.gold += d.gold;
      if (packet.type === 'GainExperience') this.user.experience += d.amount;
      if (packet.type === 'LevelChanged') Object.assign(this.user, d);
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
      if (this.socket.readyState === WebSocket.CLOSED) throw new Error(`Socket closed while waiting for ${type}; last packets: ${this.events.slice(-5).map(e => e.type).join(', ')}`);
      await delay(25);
    }
    throw new Error(`Timeout waiting for ${type}; last packets: ${this.events.slice(-8).map(e => e.type).join(', ')}`);
  }
  async login(accountID, password) {
    await this.wait('Ready');
    this.send('Login', { accountID, password });
    return this.wait('LoginSuccess');
  }
  async create(name, job = 0) {
    this.send('NewCharacter', { name, class: job, gender: 0 });
    const { charInfo } = await this.wait('NewCharacterSuccess');
    this.send('StartGame', { characterIndex: charInfo.index });
    await this.wait('UserInformation');
    await delay(250);
    return this.user;
  }
  async enter(index) {
    this.send('StartGame', { characterIndex: index });
    await this.wait('UserInformation');
    await delay(250);
    return this.user;
  }
  async walk(direction) {
    const after = this.events.length;
    this.send('Walk', { direction });
    await this.wait('UserLocation', () => true, 5000, after);
    await delay(620);
  }
  pathTo(x, y) {
    const grid = new PF.Grid(world.width, world.height);
    world.blocked.forEach(([a, b]) => grid.setWalkableAt(a, b, false));
    for (const e of this.objects.values()) {
      if (e.location && !e.dead && ['ObjectPlayer', 'ObjectMonster'].includes(e.type) && !(e.location.x === x && e.location.y === y)) grid.setWalkableAt(e.location.x, e.location.y, false);
    }
    grid.setWalkableAt(x, y, true);
    return new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles }).findPath(this.user.location.x, this.user.location.y, x, y, grid);
  }
  async moveTo(x, y) {
    for (let i = 0; i < 70; i++) {
      if (this.user.location.x === x && this.user.location.y === y) return;
      const path = this.pathTo(x, y);
      if (path.length < 2) throw new Error(`No path to ${x}, ${y}`);
      const p = this.user.location;
      await this.walk(directionTo(path[1][0] - p.x, path[1][1] - p.y));
    }
    throw new Error(`Unable to reach ${x}, ${y}`);
  }
  async equipStarter() {
    const weapon = this.user.inventory.find(i => i && this.items.get(i.itemIndex)?.type === 1);
    if (!weapon) throw new Error('Crystal did not supply a starter weapon');
    this.send('EquipItem', { uniqueID: weapon.uniqueID, grid: 1, to: 0 });
    await this.wait('EquipItem', d => d.success && d.uniqueID === weapon.uniqueID);
    return weapon;
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    this.socket.close();
    await new Promise(resolve => this.socket.once('close', resolve));
  }
}
