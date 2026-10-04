import Phaser from 'phaser';
import PF from 'pathfinding';
import world from '../../shared/world.json';
import { client, type Entity, type Message } from './client';
import { manifest, currentMap, loadMap, walkable, localGrid, nativeFrame, hudBlocksWorld, classicLayout, type Action, type ActorFrames, type Chunk, type Cell } from './classic';

const W = 48, H = 32;
const DIRECTIONS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
export const directionTo = (x: number, y: number) => DIRECTIONS.findIndex(([dx, dy]) => dx === Math.sign(x) && dy === Math.sign(y));
type Actor = { body: Phaser.GameObjects.Container; layers: Phaser.GameObjects.Image[]; label: Phaser.GameObjects.Text; hp: Phaser.GameObjects.Graphics; x: number; y: number };
type Animation = { action: Action; started: number; until: number };

export class WorldScene extends Phaser.Scene {
  actors = new Map<number, Actor>();
  animations = new Map<number, Animation>();
  target?: { x: number; y: number };
  held?: number;
  running = false;
  pointerHeld = false;
  pointerCell?: { x: number; y: number };
  pendingAt = 0;
  lastAction = 0;
  dirty = true;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ring!: Phaser.GameObjects.Ellipse;
  marker!: Phaser.GameObjects.Rectangle;
  atlasJobs = new Map<number, Promise<void>>();
  groundJobs = new Map<number, Promise<void>>();
  chunks = new Map<string, Promise<Chunk>>();
  terrain = new Map<string, { images: Phaser.GameObjects.Image[]; cells: Cell[] }>();
  terrainAt = -1000;
  terrainBusy = false;
  mapLoading = false;
  mapGeneration = 0;
  finder = new PF.AStarFinder({ diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles });
  constructor() { super('world'); }
  create() {
    const camera = this.cameras.main;
    camera.setBackgroundColor('#121312');
    camera.setBounds(0, 0, world.width * W, world.height * H);
    camera.centerOn(world.spawn.x * W + 24, world.spawn.y * H + 16);
    this.ring = this.add.ellipse(0, 0, 38, 20).setStrokeStyle(1, 0xffdd72).setVisible(false);
    this.marker = this.add.rectangle(0, 0, 46, 30).setStrokeStyle(1, 0xe3c76a, 0.7).setVisible(false);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (client.phase !== 'game' || client.dead) return;
      if (hudBlocksWorld(pointer.x, pointer.y)) return;
      const point = pointer.positionToCamera(camera) as Phaser.Math.Vector2;
      const x = Math.floor(point.x / W), y = Math.floor(point.y / H);
      if (this.mapLoading || x < 0 || y < 0 || x >= currentMap.width || y >= currentMap.height) return;
      const entity = this.entityAt(point) ?? [...client.objects.values()].find(e => e.location.x === x && e.location.y === y && !e.dead);
      if (!entity && !walkable(x, y)) return;
      const right = pointer.rightButtonDown();
      client.selected = right ? undefined : entity?.objectID;
      this.running = right;
      this.pointerHeld = true;
      this.pointerCell = { x, y };
      this.target = { x, y }; this.held = undefined; client.changed();
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerHeld || hudBlocksWorld(pointer.x, pointer.y)) return;
      const point = pointer.positionToCamera(camera) as Phaser.Math.Vector2;
      this.pointerCell = { x: Math.floor(point.x / W), y: Math.floor(point.y / H) };
      if (!client.selected && walkable(this.pointerCell.x, this.pointerCell.y)) this.target = this.pointerCell;
    });
    this.input.on('pointerup', () => { this.pointerHeld = false; });
    this.game.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,E,H,ONE,TWO,THREE,FOUR,FIVE,SIX,SHIFT,B,I,F9,F10,F11,F1,F2,F3,F4,F5,F6,F7,F8') as typeof this.keys;
    this.keys.SPACE.on('down', () => { if (!this.typing()) this.attack(); });
    this.keys.E.on('down', () => { if (!this.typing()) this.pickup(); });
    this.keys.H.on('down', () => { if (!this.typing()) this.harvest(); });
    for (const [slot, key] of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'].entries()) this.keys[key].on('down', () => { if (!this.typing()) client.useBelt(slot); });
    for (let key = 1; key <= 8; key++) this.keys[`F${key}`].on('down', () => { if (!this.typing()) this.cast(key); });
    client.addEventListener('change', () => { this.dirty = true; });
    client.addEventListener('packet', event => this.effect((event as CustomEvent<Message>).detail));
    void this.loadTerrain();
  }
  entityAt(point: Phaser.Math.Vector2) {
    const actors = [...this.actors.entries()].sort((a, b) => b[1].body.depth - a[1].body.depth);
    for (const [id, actor] of actors) {
      const entity = client.objects.get(id);
      if (!entity || entity.dead) continue;
      for (const layer of actor.layers) {
        if (!layer.visible) continue;
        const x = Math.floor(point.x - actor.body.x - layer.x), y = Math.floor(point.y - actor.body.y - layer.y);
        if (x >= 0 && y >= 0 && x < layer.width && y < layer.height && this.textures.getPixelAlpha(x, y, layer.texture.key, layer.frame.name) > 0) return entity;
      }
    }
  }
  async ensureAtlas(index: number) {
    if (!this.atlasJobs.has(index)) this.atlasJobs.set(index, (async () => {
      const image = new Image();
      image.src = world.assets + manifest.atlases[index].file;
      await image.decode();
      const texture = this.textures.addImage(`classic-${index}`, image)!;
      for (const [key, frame] of Object.entries(manifest.frames)) if (frame.atlas === index) texture.add(key, 0, frame.x, frame.y, frame.w, frame.h);
      this.dirty = true;
    })());
    return this.atlasJobs.get(index)!;
  }
  async ensureGround(index: number) {
    if (!this.groundJobs.has(index)) this.groundJobs.set(index, (async () => {
      const source = nativeFrame('DnItems', index) || nativeFrame('Items', index);
      if (!source) return;
      const image = new Image(); image.src = source; await image.decode();
      this.textures.addImage(`ground:${index}`, image);
    })());
    return this.groundJobs.get(index)!;
  }
  async loadTerrain() {
    if (this.terrainBusy || this.mapLoading) return;
    this.terrainBusy = true;
    const generation = this.mapGeneration;
    try {
      const camera = this.cameras.main;
      const minX = Math.max(0, Math.floor(camera.scrollX / W) - 8), maxX = Math.min(currentMap.width - 1, Math.ceil((camera.scrollX + camera.width) / W) + 8);
      const minY = Math.max(0, Math.floor(camera.scrollY / H) - 12), maxY = Math.min(currentMap.height - 1, Math.ceil((camera.scrollY + camera.height) / H) + 12);
      const visible = new Set<string>();
      for (const chunk of currentMap.chunks) if (chunk.x <= maxX && chunk.x + chunk.width > minX && chunk.y <= maxY && chunk.y + chunk.height > minY) visible.add(`${chunk.x}-${chunk.y}`);
      for (const [key, chunk] of this.terrain) if (!visible.has(key)) { chunk.images.forEach(image => image.destroy()); this.terrain.delete(key); }
      await Promise.all([...visible].map(async key => {
        if (this.terrain.has(key)) return;
        const descriptor = currentMap.chunks.find(chunk => `${chunk.x}-${chunk.y}` === key)!;
        if (!this.chunks.has(key)) this.chunks.set(key, fetch(world.assets + descriptor.file).then(async response => { if (!response.ok) throw new Error(`Map chunk ${key}: ${response.status}`); return response.json(); }));
        const chunk = await this.chunks.get(key)!;
        const indices = new Set<number>();
        for (const cell of chunk.cells) for (const ref of [cell.back, cell.middle, cell.front]) if (ref && manifest.frames[ref.key]) indices.add(manifest.frames[ref.key].atlas);
        await Promise.all([...indices].map(index => this.ensureAtlas(index)));
        if (this.terrain.has(key) || generation !== this.mapGeneration) return;
        const images: Phaser.GameObjects.Image[] = [];
        for (const cell of chunk.cells) for (const ref of [cell.back, cell.middle, cell.front]) {
          const frame = ref && manifest.frames[ref.key];
          if (!ref || !frame || ref.render === false) continue;
          const image = this.add.image(cell.x * W + ref.drawX, cell.y * H + ref.drawY, `classic-${frame.atlas}`, ref.key).setOrigin(0).setDepth(ref.floor ? -10000 : cell.y * 10);
          if (ref.blend) image.setBlendMode(Phaser.BlendModes.ADD);
          images.push(image);
        }
        this.terrain.set(key, { images, cells: chunk.cells });
      }));
      if (generation === this.mapGeneration) document.querySelector<HTMLElement>('#world')!.dataset.mapReady = 'true';
    } catch (error) {
      console.error(error);
      client.error = '地图资源加载失败，请刷新重试'; client.changed();
    } finally { this.terrainBusy = false; }
  }
  async changeMap(id: string) {
    const generation = ++this.mapGeneration;
    this.mapLoading = true; this.target = undefined; this.pendingAt = 0;
    document.querySelector<HTMLElement>('#world')!.dataset.mapReady = 'false';
    for (const chunk of this.terrain.values()) chunk.images.forEach(image => image.destroy());
    this.terrain.clear(); this.chunks.clear();
    try {
      await loadMap(id);
      if (generation !== this.mapGeneration) return;
      this.cameras.main.setBounds(0, 0, currentMap.width * W, currentMap.height * H);
      client.changed();
    } catch (error) { client.error = '地图资源加载失败'; console.error(error); }
    finally { if (generation === this.mapGeneration) { this.mapLoading = false; this.dirty = true; } }
  }
  typing() { return ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? ''); }
  animate(id: number, action: Action, duration: number) { this.animations.set(id, { action, started: this.time.now, until: this.time.now + duration }); }
  attack() {
    if (!client.user || client.dead || client.phase !== 'game') return;
    let direction = client.user.direction;
    const entity = client.selected && client.objects.get(client.selected);
    if (entity) direction = directionTo(entity.location.x - client.user.location.x, entity.location.y - client.user.location.y);
    client.send('Attack', { direction: direction < 0 ? 4 : direction, spell: 0 });
    this.animate(client.user.objectID, 'attack', 550);
  }
  cast(key: number) {
    if (!client.user || client.dead) return;
    const magic = client.user.magics?.find((magic: any) => magic.key === key);
    if (!magic) return;
    const target = client.selected && client.objects.get(client.selected);
    const location = target ? target.location : client.user.location;
    const direction = directionTo(location.x - client.user.location.x, location.y - client.user.location.y);
    client.send('Magic', { spell: magic.spell, direction: direction < 0 ? client.user.direction : direction, targetID: target ? target.objectID : client.user.objectID, location, objectID: client.user.objectID, spellTargetLock: !!target });
  }
  pickup() { if (!client.dead) client.send('PickUp'); }
  harvest() {
    if (!client.user || client.dead) return;
    const p = client.user.location;
    const corpse = [...client.objects.values()].find(e => e.dead && e.kind === 'monster' && Math.max(Math.abs(e.location.x - p.x), Math.abs(e.location.y - p.y)) <= 2);
    if (!corpse) return;
    const direction = directionTo(corpse.location.x - p.x, corpse.location.y - p.y);
    client.send('Harvest', { objectID: corpse.objectID, x: corpse.location.x, y: corpse.location.y, direction: direction < 0 ? client.user.direction : direction });
    this.animate(client.user.objectID, 'harvest', 600);
  }
  async spriteEffect(frames: string[], x: number, y: number, duration = 700, destination?: { x: number; y: number }) {
    const generation = this.mapGeneration;
    const available = frames.filter(key => manifest.frames[key]);
    if (!available.length) return;
    await Promise.all([...new Set(available.map(key => manifest.frames[key].atlas))].map(index => this.ensureAtlas(index)));
    if (generation !== this.mapGeneration) return;
    const image = this.add.image(0, 0, '__DEFAULT').setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
    const anchor = this.add.container(x, y, image).setDepth(10000);
    let index = 0;
    const render = () => { const key = available[Math.min(index++, available.length - 1)]; const f = manifest.frames[key]; image.setTexture(`classic-${f.atlas}`, key).setPosition(f.offsetX, f.offsetY); };
    render();
    const timer = this.time.addEvent({ delay: duration / available.length, repeat: available.length - 1, callback: render });
    if (destination) this.tweens.add({ targets: anchor, x: destination.x, y: destination.y, duration });
    this.time.delayedCall(duration, () => { timer.remove(); anchor.destroy(true); });
  }
  magicEffect(d: any) {
    const source = d.objectID === client.user?.objectID ? client.user : client.objects.get(d.objectID);
    if (!source) return;
    this.animate(d.objectID, 'cast', 700);
    const origin = { x: source.location.x * W, y: source.location.y * H };
    const target = d.targetID === client.user?.objectID ? client.user : client.objects.get(d.targetID);
    const point = target?.location ?? d.location;
    if (d.effect === 1) {
      const end = { x: point.x * W, y: point.y * H };
      const angle = Math.atan2(end.x - origin.x, origin.y - end.y);
      const direction = (Math.round(angle / (Math.PI / 8)) + 16) % 16;
      void this.spriteEffect(manifest.spellFireBall.cast, origin.x, origin.y);
      void this.spriteEffect(manifest.spellFireBall.projectile[direction], origin.x, origin.y, 500, end);
      this.time.delayedCall(500, () => { void this.spriteEffect(manifest.spellFireBall.hit, end.x, end.y); });
    } else if (d.effect === 2) void this.spriteEffect(Array.from({ length: 10 }, (_, i) => `healing:${370 + i}`), point.x * W, point.y * H, 1000);
  }
  step(direction: number, running = false) {
    if (!client.ready || client.phase !== 'game' || client.dead || (this.pendingAt && performance.now() - this.pendingAt < 1200)) return;
    this.lastAction = this.time.now; this.pendingAt = performance.now();
    const [dx, dy] = DIRECTIONS[direction];
    const point = client.user!.location;
    const clear = (x: number, y: number) => walkable(x, y) && ![...client.objects.values()].some(entity => !entity.dead && ['player', 'monster', 'npc'].includes(entity.kind) && entity.location.x === x && entity.location.y === y);
    const canRun = running && clear(point.x + dx, point.y + dy) && clear(point.x + dx * 2, point.y + dy * 2);
    client.send(canRun ? 'Run' : 'Walk', { direction });
    this.animate(client.user!.objectID, canRun ? 'run' : 'walk', 620);
  }
  effect(message: Message) {
    const d = message.data;
    if (['ObjectDied', 'ObjectRemove'].includes(message.type) && d.objectID === client.selected) {
      this.target = undefined; client.selected = undefined; this.marker.setVisible(false);
    }
    if (message.type === 'MapInformation') void this.changeMap(d.map);
    if (message.type === 'ObjectWalk' || message.type === 'ObjectRun') this.animate(d.objectID, message.type === 'ObjectRun' ? 'run' : 'walk', 620);
    if (message.type === 'ObjectAttack') this.animate(d.objectID, 'attack', 550);
    if (message.type === 'ObjectMagic') this.animate(d.objectID, 'cast', 700);
    if (message.type === 'MagicEffect') this.magicEffect(d);
    if (message.type === 'ObjectHarvest') this.animate(d.objectID, 'harvest', 600);
    if (message.type === 'UserLocation') {
      this.pendingAt = 0;
      if (client.user && (d.location.x !== client.user.location.x || d.location.y !== client.user.location.y)) this.animate(client.user.objectID, d.action === 'Run' ? 'run' : 'walk', 620);
    }
    if (message.type === 'UserInformation') { this.target = undefined; this.pendingAt = 0; this.animations.clear(); }
    if (message.type === 'Magic' && client.user) this.animate(client.user.objectID, 'cast', 700);
  }
  frame(image: Phaser.GameObjects.Image, key: string) {
    const frame = manifest.frames[key];
    if (!frame) { image.setVisible(false); return; }
    if (!this.textures.exists(`classic-${frame.atlas}`)) { image.setVisible(false); void this.ensureAtlas(frame.atlas); return; }
    image.setTexture(`classic-${frame.atlas}`, key).setPosition(frame.offsetX, frame.offsetY).setVisible(true);
  }
  actorFrame(name: string, action: Action, direction: number, started: number, dead = false) {
    const actor: ActorFrames | undefined = manifest.actors[name];
    const frames = actor?.[action]?.[direction] ?? actor?.stand?.[direction];
    if (!frames?.length) return '';
    const index = dead ? frames.length - 1 : Math.floor((this.time.now - started) / (actor?.actionFrameMs[action] ?? 150));
    return frames[action === 'stand' || action === 'walk' ? index % frames.length : Math.min(index, frames.length - 1)];
  }
  sync() {
    const all: Entity[] = [...client.objects.values()];
    if (client.user && client.phase === 'game') all.push({ ...client.user, objectID: client.user.objectID, location: client.user.location, kind: 'player', dead: client.dead });
    const present = new Set(all.map(entity => entity.objectID));
    for (const [id, actor] of this.actors) if (!present.has(id)) { actor.body.destroy(); actor.label.destroy(); actor.hp.destroy(); this.actors.delete(id); this.animations.delete(id); }
    for (const entity of all) {
      const x = entity.location.x * W, y = entity.location.y * H;
      let actor = this.actors.get(entity.objectID);
      if (!actor) {
        const layers = Array.from({ length: 3 }, () => this.add.image(0, 0, '__DEFAULT').setOrigin(0).setVisible(false));
        actor = { body: this.add.container(x, y, layers), layers, label: this.add.text(x + 24, y - 45, entity.name ?? (entity.kind === 'gold' ? `${entity.gold} 金币` : ''), { fontFamily: 'SimSun, serif', fontSize: '12px', color: entity.kind === 'monster' ? '#f5eded' : entity.kind === 'npc' ? '#ffff66' : '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5), hp: this.add.graphics(), x, y };
        this.actors.set(entity.objectID, actor);
      }
      if (actor.x !== x || actor.y !== y) {
        this.tweens.killTweensOf([actor.body, actor.label]);
        this.tweens.add({ targets: actor.body, x, y, duration: 500 });
        this.tweens.add({ targets: actor.label, x: x + 24, y: y - 45, duration: 500 });
        actor.x = x; actor.y = y;
      }
      actor.body.setDepth(entity.location.y * 10 + 5);
      actor.label.setText(entity.name ?? (entity.kind === 'gold' ? '金币' : ''));
      actor.label.setDepth(entity.location.y * 10 + 8).setVisible(!entity.dead);
      actor.hp.clear().setDepth(entity.location.y * 10 + 9);
      if (entity.kind === 'monster' && entity.percent !== undefined && !entity.dead) {
        actor.hp.fillStyle(0x000000).fillRect(x + 4, y - 32, 40, 5);
        actor.hp.fillStyle(0xce1919).fillRect(x + 5, y - 31, 38 * entity.percent / 100, 3);
      }
    }
    if (client.user) { const actor = this.actors.get(client.user.objectID); if (actor) this.cameras.main.startFollow(actor.body, true, 1, 1, -24, -78); }
  }
  drawActors() {
    for (const [id, actor] of this.actors) {
      const entity: Entity | undefined = client.user && id === client.user.objectID ? { ...client.user, objectID: id, location: client.user.location, kind: 'player', dead: client.dead } : client.objects.get(id);
      if (!entity) continue;
      const animation = this.animations.get(id);
      const action: Action = entity.dead ? 'die' : animation && animation.until > this.time.now ? animation.action : 'stand';
      const started = animation && animation.until > this.time.now ? animation.started : 0;
      const direction = Math.max(0, Math.min(7, entity.direction ?? 4));
      actor.layers.forEach(layer => layer.setVisible(false));
      if (entity.kind === 'player') {
        const female = entity.gender === 1 ? 'f' : '';
        const armour = id === client.user?.objectID ? (client.user.equipment[1] ? client.items.get(client.user.equipment[1].itemIndex)?.shape ?? 0 : 0) : entity.armour ?? 0;
        const weapon = id === client.user?.objectID ? (client.user.equipment[0] ? client.items.get(client.user.equipment[0].itemIndex)?.shape ?? 0 : 0) : entity.weapon ?? 0;
        this.frame(actor.layers[0], this.actorFrame(`armour${armour}${female}`, action, direction, started, entity.dead));
        this.frame(actor.layers[1], this.actorFrame(`hair0${female}`, action, direction, started, entity.dead));
        if (weapon) this.frame(actor.layers[2], this.actorFrame(`weapon${weapon}${female}`, action, direction, started, entity.dead));
        actor.body.bringToTop(actor.layers[0]); actor.body.bringToTop(actor.layers[1]);
        if (direction >= 2 && direction <= 6) actor.body.bringToTop(actor.layers[2]);
      } else if (entity.kind === 'monster' || entity.kind === 'npc') this.frame(actor.layers[0], this.actorFrame(`${entity.kind}${entity.image}`, action, entity.kind === 'npc' ? direction % 3 : direction, started, entity.dead));
      else {
        const image = entity.kind === 'gold' ? 116 : entity.image;
        const key = `ground:${image}`;
        const texture = this.textures.get(key);
        if (texture.key !== '__MISSING') actor.layers[0].setTexture(key).setPosition(8, 0).setVisible(true);
        else void this.ensureGround(image);
      }
    }
    const selected = client.selected && client.objects.get(client.selected);
    this.ring.setVisible(false);
  }
  update(time: number) {
    if (this.input.keyboard) this.input.keyboard.enabled = !this.typing();
    if (this.dirty) { this.sync(); this.dirty = false; }
    this.drawActors();
    if (time - this.terrainAt > 250) { this.terrainAt = time; void this.loadTerrain(); }
    if (!client.user || client.phase !== 'game' || client.dead) return;
    if (this.pendingAt && performance.now() - this.pendingAt < 1200 || time - this.lastAction < 620) return;
    const point = client.user.location;
    let direction = this.held;
    if (!this.typing()) {
      const dx = Number(this.cursors.right.isDown || this.keys.D.isDown) - Number(this.cursors.left.isDown || this.keys.A.isDown);
      const dy = Number(this.cursors.down.isDown || this.keys.S.isDown) - Number(this.cursors.up.isDown || this.keys.W.isDown);
      if (dx || dy) { direction = directionTo(dx, dy); this.target = undefined; client.selected = undefined; this.running = this.keys.SHIFT.isDown; }
    }
    const selected = client.selected === undefined ? undefined : client.objects.get(client.selected);
    if (selected && !selected.dead) {
      this.target = selected.location;
      const distance = Math.max(Math.abs(selected.location.x - point.x), Math.abs(selected.location.y - point.y));
      if (selected.kind === 'monster' && distance <= 1) { this.lastAction = time; this.attack(); return; }
      if (selected.kind === 'npc') { this.lastAction = time; client.callNPC(selected.objectID); this.target = undefined; client.selected = undefined; return; }
      if (['item', 'gold'].includes(selected.kind) && distance === 0) { this.lastAction = time; this.pickup(); return; }
    }
    if (direction === undefined && this.target) {
      if (point.x === this.target.x && point.y === this.target.y) { this.target = undefined; this.marker.setVisible(false); return; }
      const local = localGrid(point, this.target);
      const grid = new PF.Grid(local.matrix);
      for (const entity of client.objects.values()) {
        const x = entity.location.x - local.left, y = entity.location.y - local.top;
        if (!entity.dead && ['player', 'monster', 'npc'].includes(entity.kind) && entity.objectID !== client.selected && x >= 0 && y >= 0 && x < grid.width && y < grid.height) grid.setWalkableAt(x, y, false);
      }
      grid.setWalkableAt(this.target.x - local.left, this.target.y - local.top, true);
      const path = this.finder.findPath(point.x - local.left, point.y - local.top, this.target.x - local.left, this.target.y - local.top, grid);
      if (path.length > 1) direction = directionTo(path[1][0] + local.left - point.x, path[1][1] + local.top - point.y);
      else this.target = undefined;
    }
    if (direction !== undefined && direction >= 0) {
      const distance = this.target ? Math.max(Math.abs(this.target.x - point.x), Math.abs(this.target.y - point.y)) : 2;
      this.step(direction, this.running && distance >= 2); this.marker.setVisible(false);
    }
  }
}

export function startGame(parent: HTMLElement) {
  const scene = new WorldScene();
  new Phaser.Game({ type: Phaser.AUTO, parent, backgroundColor: '#121312', antialias: false, pixelArt: true, roundPixels: true, scale: { mode: Phaser.Scale.NONE, width: classicLayout.width, height: classicLayout.height }, scene, input: { keyboard: true } });
  return scene;
}
