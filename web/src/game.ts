import Phaser from 'phaser';
import PF from 'pathfinding';
import world from '../../shared/world.json';
import { client, type Entity, type Message } from './client';

const CELL = 48;
const DIRECTIONS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const directionTo = (x: number, y: number) => DIRECTIONS.findIndex(([dx, dy]) => dx === Math.sign(x) && dy === Math.sign(y));
type Actor = { image: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; shadow: Phaser.GameObjects.Ellipse; hp: Phaser.GameObjects.Graphics; x: number; y: number };

export class WorldScene extends Phaser.Scene {
  actors = new Map<number, Actor>();
  grid = new PF.Grid(world.width, world.height);
  target?: { x: number; y: number };
  held?: number;
  pendingAt = 0;
  lastAction = 0;
  dirty = true;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ring!: Phaser.GameObjects.Ellipse;
  marker!: Phaser.GameObjects.Rectangle;
  finder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
  constructor() { super('world'); }
  preload() {
    this.load.spritesheet('town', '/assets/town.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('dungeon', '/assets/dungeon.png', { frameWidth: 16, frameHeight: 16 });
  }
  create() {
    const camera = this.cameras.main;
    camera.setBackgroundColor('#192c23');
    camera.setBounds(0, 0, world.width * CELL, world.height * CELL);
    const paving = this.textures.createCanvas('paving', 16, 16)!;
    const stoneContext = paving.context;
    stoneContext.fillStyle = '#8d9d84'; stoneContext.fillRect(0, 0, 16, 16);
    stoneContext.fillStyle = '#7e9078'; stoneContext.fillRect(0, 7, 16, 1); stoneContext.fillRect(7, 0, 1, 7); stoneContext.fillRect(12, 8, 1, 8);
    stoneContext.fillStyle = '#a0af94'; stoneContext.fillRect(1, 1, 6, 1); stoneContext.fillRect(1, 9, 10, 1);
    paving.refresh();
    for (const [x, y] of world.blocked) this.grid.setWalkableAt(x, y, false);
    world.tiles.forEach((tile, i) => {
      const x = i % world.width, y = Math.floor(i / world.width);
      const frame = tile === 'grass' ? (((x * 13 + y * 7) % 9 === 0) ? 1 : 0) : tile === 'path' ? 13 : tile === 'bridge' ? 81 : 0;
      this.add.image(x * CELL + CELL / 2, y * CELL + CELL / 2, tile === 'stone' ? 'paving' : 'town', tile === 'stone' ? undefined : frame).setScale(3).setDepth(-1000);
      if (tile === 'water') {
        const water = this.add.rectangle(x * CELL + CELL / 2, y * CELL + CELL / 2, CELL, CELL, 0x397d83).setDepth(-999);
        const wave = this.add.rectangle(x * CELL + CELL / 2, y * CELL + 20 + (x * y % 12), 20, 3, 0x70bdb7, 0.38).setDepth(-998);
        this.tweens.add({ targets: [water, wave], alpha: { from: 0.75, to: 1 }, duration: 1400 + y * 30, yoyo: true, repeat: -1 });
      }
    });
    for (const o of world.objects) {
      if (o.kind === 'house') {
        for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
          this.add.image((o.x - 1 + col) * CELL + 24, (o.y - 3 + row) * CELL + 24, 'town', (4 + row) * 12 + col).setScale(3).setDepth(o.y * 10 - 1);
        }
      } else if (o.kind === 'tree') {
        this.add.image(o.x * CELL + 24, o.y * CELL - 24, 'town', 4).setScale(3).setDepth(o.y * 10);
        this.add.image(o.x * CELL + 24, o.y * CELL + 24, 'town', 16).setScale(3).setDepth(o.y * 10);
      } else {
        this.add.image(o.x * CELL + 24, o.y * CELL + 24, 'town', o.kind === 'well' ? 57 : o.kind === 'rock' ? 117 : 2).setScale(o.kind === 'flower' ? 2 : 3).setDepth(o.y * 10 - 2);
      }
    }
    this.add.text(26 * CELL + 24, 19 * CELL, '青 石 镇', { fontFamily: 'serif', fontSize: '23px', color: '#f4ead0', stroke: '#28382a', strokeThickness: 5 }).setOrigin(0.5).setDepth(450);
    this.add.text(35 * CELL, 31 * CELL, '荒野', { fontSize: '16px', color: '#a8b59b', stroke: '#28382a', strokeThickness: 4 }).setDepth(450);
    this.ring = this.add.ellipse(0, 0, 45, 25).setStrokeStyle(2, 0xe9c16c).setVisible(false);
    this.marker = this.add.rectangle(0, 0, 35, 35).setStrokeStyle(1, 0xe9c16c, 0.7).setVisible(false).setDepth(1);
    camera.centerOn(world.spawn.x * CELL + 24, world.spawn.y * CELL + 24);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (client.phase !== 'game' || client.dead) return;
      const location = pointer.positionToCamera(camera) as Phaser.Math.Vector2;
      const x = Math.floor(location.x / CELL), y = Math.floor(location.y / CELL);
      if (x < 0 || x >= world.width || y < 0 || y >= world.height) return;
      const entity = [...client.objects.values()].find(e => e.location.x === x && e.location.y === y && !e.dead);
      client.selected = entity?.objectID;
      this.target = { x, y };
      this.held = undefined;
      client.changed();
    });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,E,ONE,TWO,I') as typeof this.keys;
    this.keys.SPACE.on('down', () => { if (!this.typing()) this.attack(); });
    this.keys.E.on('down', () => { if (!this.typing()) this.pickup(); });
    this.keys.ONE.on('down', () => { if (!this.typing()) client.usePotion(); });
    this.keys.TWO.on('down', () => { if (!this.typing()) client.usePotion(true); });
    const onChange = () => { this.dirty = true; };
    const onPacket = (event: Event) => this.effect((event as CustomEvent<Message>).detail);
    client.addEventListener('change', onChange);
    client.addEventListener('packet', onPacket);
    this.events.once('shutdown', () => { client.removeEventListener('change', onChange); client.removeEventListener('packet', onPacket); });
  }
  typing() { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? ''); }
  attack() {
    if (!client.user || client.dead || client.phase !== 'game') return;
    let direction = client.user.direction;
    const entity = client.selected && client.objects.get(client.selected);
    if (entity) direction = directionTo(entity.location.x - client.user.location.x, entity.location.y - client.user.location.y);
    if (direction < 0) direction = 4;
    client.send('Attack', { direction, spell: 0 });
    this.slash(client.user.objectID);
  }
  pickup() { if (!client.dead) client.send('PickUp'); }
  step(direction: number) {
    if (!client.ready || client.phase !== 'game' || client.dead || (this.pendingAt && performance.now() - this.pendingAt < 1200)) return;
    this.lastAction = this.time.now;
    this.pendingAt = performance.now();
    client.send('Walk', { direction });
  }
  slash(id: number) {
    const actor = this.actors.get(id);
    if (!actor) return;
    const slash = this.add.arc(actor.image.x + 10, actor.image.y - 6, 28, -70, 80, false).setStrokeStyle(3, id === client.user?.objectID ? 0xf4d68a : 0xe78676).setDepth(actor.image.depth + 2);
    this.tweens.add({ targets: slash, alpha: 0, angle: 40, duration: 250, onComplete: () => slash.destroy() });
  }
  effect(message: Message) {
    const d = message.data;
    if (message.type === 'ObjectAttack') this.slash(d.objectID);
    if (message.type === 'UserLocation') this.pendingAt = 0;
    if (message.type === 'UserInformation') { this.target = undefined; this.pendingAt = 0; }
    if (message.type === 'DamageIndicator') {
      const actor = this.actors.get(d.objectID);
      if (!actor) return;
      const label = this.add.text(actor.image.x, actor.image.y - 32, d.damage ? `${Math.abs(d.damage)}` : '闪避', { fontSize: '20px', color: d.objectID === client.user?.objectID ? '#ff9c8b' : '#ffe19f', stroke: '#20251e', strokeThickness: 4 }).setOrigin(0.5).setDepth(1000);
      this.tweens.add({ targets: label, y: label.y - 35, alpha: 0, duration: 750, onComplete: () => label.destroy() });
      actor.image.setTint(0xffbbbb);
      this.time.delayedCall(160, () => { if (actor.image.active) actor.image.clearTint(); });
    }
  }
  sync() {
    const all: Entity[] = [...client.objects.values()];
    if (client.user && client.phase === 'game') all.push({ ...client.user, objectID: client.user.objectID, location: client.user.location, kind: 'player', dead: client.dead });
    const present = new Set(all.map(e => e.objectID));
    for (const [id, actor] of this.actors) {
      if (present.has(id)) continue;
      actor.image.destroy(); actor.label.destroy(); actor.shadow.destroy(); actor.hp.destroy(); this.actors.delete(id);
    }
    for (const e of all) {
      const x = e.location.x * CELL + 24, y = e.location.y * CELL + 24;
      let actor = this.actors.get(e.objectID);
      const frame = e.kind === 'gold' ? 101 : e.kind === 'item' ? (e.image ?? 115) : e.kind === 'player' ? [97, 84, 87][e.class ?? 0] : e.image === 22 ? 122 : e.image === 9 ? 124 : e.image === 6 ? 120 : 111;
      if (!actor) {
        actor = {
          image: this.add.sprite(x, y, 'dungeon', frame).setScale(e.kind === 'item' || e.kind === 'gold' ? 2 : 3),
          label: this.add.text(x, y - 35, e.name ?? (e.kind === 'gold' ? `${e.gold} 金币` : ''), { fontFamily: 'system-ui', fontSize: '12px', color: e.kind === 'player' ? '#edf1dc' : e.kind === 'monster' ? '#f5b1a0' : '#ebcd8a', stroke: '#19271d', strokeThickness: 3 }).setOrigin(0.5),
          shadow: this.add.ellipse(x, y + 17, 28, 10, 0x152216, 0.35),
          hp: this.add.graphics(), x, y
        };
        this.actors.set(e.objectID, actor);
      }
      actor.image.setFrame(frame).setDepth(e.location.y * 10 + 2).setAlpha(e.dead ? 0.35 : 1).setAngle(e.dead ? 75 : 0);
      actor.label.setDepth(e.location.y * 10 + 3).setAlpha(e.dead ? 0.4 : 1);
      actor.shadow.setDepth(e.location.y * 10 + 1);
      actor.hp.clear().setDepth(e.location.y * 10 + 3);
      if (actor.x !== x || actor.y !== y) {
        this.tweens.killTweensOf([actor.image, actor.label, actor.shadow]);
        this.tweens.add({ targets: actor.image, x, y, duration: 240 });
        this.tweens.add({ targets: actor.label, x, y: y - 35, duration: 240 });
        this.tweens.add({ targets: actor.shadow, x, y: y + 17, duration: 240 });
        actor.x = x; actor.y = y;
      }
      if (e.kind === 'monster' && e.percent !== undefined && !e.dead) {
        actor.hp.fillStyle(0x18201a, 0.8).fillRect(x - 17, y - 26, 34, 4);
        actor.hp.fillStyle(0xbe5c53).fillRect(x - 16, y - 25, 32 * e.percent / 100, 2);
      }
    }
    if (client.user) {
      const self = this.actors.get(client.user.objectID);
      if (self) this.cameras.main.startFollow(self.image, true, 0.12, 0.12);
    }
    const selected = client.selected && client.objects.get(client.selected);
    this.ring.setVisible(!!selected && !selected.dead);
    if (selected) this.ring.setPosition(selected.location.x * CELL + 24, selected.location.y * CELL + 38).setDepth(selected.location.y * 10 + 1);
  }
  update(time: number) {
    if (this.input.keyboard) this.input.keyboard.enabled = !this.typing();
    if (this.dirty) { this.sync(); this.dirty = false; }
    if (!client.user || client.phase !== 'game' || client.dead) return;
    if (this.pendingAt && performance.now() - this.pendingAt < 1200) return;
    if (time - this.lastAction < 620) return;
    const p = client.user.location;
    let dir = this.held;
    if (!this.typing()) {
      const dx = Number(this.cursors.right.isDown || this.keys.D.isDown) - Number(this.cursors.left.isDown || this.keys.A.isDown);
      const dy = Number(this.cursors.down.isDown || this.keys.S.isDown) - Number(this.cursors.up.isDown || this.keys.W.isDown);
      if (dx || dy) { dir = directionTo(dx, dy); this.target = undefined; client.selected = undefined; }
    }
    const selected = client.selected === undefined ? undefined : client.objects.get(client.selected);
    if (selected && !selected.dead) {
      this.target = selected.location;
      const distance = Math.max(Math.abs(selected.location.x - p.x), Math.abs(selected.location.y - p.y));
      if (selected.kind === 'monster' && distance <= 1) { this.lastAction = time; this.attack(); return; }
      if ((selected.kind === 'item' || selected.kind === 'gold') && distance === 0) { this.lastAction = time; this.pickup(); return; }
    }
    if (dir === undefined && this.target) {
      if (this.target.x === p.x && this.target.y === p.y) { this.target = undefined; this.marker.setVisible(false); return; }
      const grid = this.grid.clone();
      for (const e of client.objects.values()) if (!e.dead && ['player', 'monster'].includes(e.kind) && e.objectID !== client.selected) grid.setWalkableAt(e.location.x, e.location.y, false);
      if (selected?.kind === 'monster') grid.setWalkableAt(selected.location.x, selected.location.y, true);
      const path = this.finder.findPath(p.x, p.y, this.target.x, this.target.y, grid);
      if (path.length > 1) dir = directionTo(path[1][0] - p.x, path[1][1] - p.y);
      else { this.target = undefined; this.marker.setVisible(false); }
    }
    if (dir !== undefined && dir >= 0) {
      this.step(dir);
      this.marker.setVisible(!!this.target);
      if (this.target) this.marker.setPosition(this.target.x * CELL + 24, this.target.y * CELL + 24);
    }
  }
}

export function startGame(parent: HTMLElement) {
  const scene = new WorldScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent, backgroundColor: '#192c23', pixelArt: true, antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth, height: parent.clientHeight },
    scene, render: { roundPixels: true }, input: { keyboard: true },
  });
  new ResizeObserver(() => game.scale.resize(parent.clientWidth, parent.clientHeight)).observe(parent);
  return scene;
}
