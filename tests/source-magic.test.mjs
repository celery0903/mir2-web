import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(process.env.MIR_MAGIC_CLIENT_ROOT ?? '.runtime/source-magic-fix/client');
const rules = JSON.parse(await readFile(join(root, 'content/classic-176/magic-effects.json')));
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const classic = { exports: {}, require: () => ({ default: rules }) };
vm.createContext(classic);
vm.runInContext(compile(await readFile(join(root, 'apps/web/src/classic-magic.ts'), 'utf8')), classic);
const clean = value => JSON.parse(JSON.stringify(value));

test('native effect indices distinguish poison, thunder, shield and long cast sequences', () => {
  assert.deepEqual(clean(classic.exports.castSequence(4)), { library: 'Magic', start: 600, count: 10, interval: 60 });
  assert.deepEqual(clean(classic.exports.castSequence(9)), { library: 'Magic2', start: 20, count: 10, interval: 60 });
  assert.deepEqual(clean(classic.exports.castSequence(29)), { library: 'Magic', start: 3880, count: 10, interval: 60 });
  assert.deepEqual(clean(classic.exports.castSequence(26)), { library: 'Magic', start: 3960, count: 20, interval: 30 });
  for (const effect of [0, -1, 32, 49, 1.5]) assert.equal(classic.exports.castSequence(effect), undefined);
});

test('SM_SPELL changes facing while preserving the observed caster location and identity', () => {
  const actor = { id: 91, x: 288, y: 619, direction: 0, feature: 7 };
  assert.deepEqual(clean(classic.exports.spellPose(actor, { x: 294, y: 618 })), { ...actor, direction: 2, action: 'spell' });
  assert.deepEqual(clean(classic.exports.spellPose(actor, actor)), { ...actor, action: 'spell' });
  assert.equal(classic.exports.spellPose(actor, { x: 288, y: 612 }).direction, 0);
  assert.equal(classic.exports.spellPose(actor, { x: 281, y: 619 }).direction, 6);
  assert.equal(classic.exports.spellPose(actor, { x: 291, y: 618 }).direction, 1);
});

test('native impact types select distinct poison, large fireball, talisman and thunder frames', () => {
  const plan = classic.exports.effectPlan;
  assert.equal(plan(2, 2).sequence.start, 370);
  assert.equal(plan(2, 4).sequence.start, 770);
  assert.equal(plan(1, 3).sequence.start, 410);
  assert.equal(plan(1, 3).sequence.impact.start, 570);
  assert.equal(plan(8, 10).sequence.start, 1160);
  assert.equal(plan(9, 11).sequence.impact.start, 1320);
  assert.equal(plan(9, 12).sequence.impact.start, 1340);
  assert.equal(plan(8, 17).sequence.count, 3);
  assert.deepEqual(clean(plan(7, 9).sequence), { library: 'Magic2', start: 10, count: 6, interval: 50 });
  assert.equal(plan(4, 29), undefined);
  assert.equal(plan(1, 31), undefined);
});

test('projectile facing uses the 48 by 32 map pixels', () => {
  assert.equal(classic.exports.projectileDirection({ x: 0, y: 0 }, { x: 1, y: -1 }), 2);
  assert.equal(classic.exports.projectileDirection({ x: 0, y: 0 }, { x: 0, y: -1 }), 0);
  assert.equal(classic.exports.projectileDirection({ x: 0, y: 0 }, { x: 1, y: 0 }), 4);
  assert.equal(classic.exports.projectileDirection({ x: 0, y: 0 }, { x: -1, y: 0 }), 12);
});

const effectSource = compile(await readFile(join(root, 'apps/web/src/magic-effects.ts'), 'utf8'));
function effects() {
  let now = 0;
  const requested = [], callbacks = [], delayed = [], sprites = [];
  class Sprite {
    destroyed = false;
    position = { set: (x, y) => { this.x = x; this.y = y; } };
    pivot = { set: (x, y) => { this.pivotX = x; this.pivotY = y; } };
    destroy() { this.destroyed = true; }
  }
  const context = { exports: {}, performance: { now: () => now }, requestAnimationFrame: callback => callbacks.push(callback),
    window: { setTimeout: (callback, delay) => { delayed.push({ callback, delay }); } },
    fetch: async () => ({ ok: true, json: async () => ({ frames: Object.fromEntries(Array.from({ length: 4010 }, (_, index) => [index, { file: `${index}.png`, offsetX: -20, offsetY: -40 }])) }) }),
    require: name => name === './classic-magic' ? classic.exports : { Sprite, Assets: { load: async url => { requested.push(url); return { source: {}, url }; } } } };
  vm.createContext(context); vm.runInContext(effectSource, context);
  const instance = new context.exports.MagicEffects({ addChild: sprite => sprites.push(sprite) }, id => id === 91 ? { x: 288, y: 619 } : undefined);
  return { instance, requested, callbacks, delayed, sprites, advance(time) { now = time; const pending = callbacks.splice(0); for (const callback of pending) callback(time); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a remote player returns to standing after the spell body frames end', async () => {
  const context = { exports: {}, require: () => ({ Texture: { EMPTY: {} } }) };
  vm.createContext(context);
  vm.runInContext(compile(await readFile(join(root, 'apps/web/src/online-actors.ts'), 'utf8')), context);
  const updates = [], sprite = () => ({ position: { set() {} } });
  const actor = { entity: { id: 91, self: false, action: 'spell', dead: false }, start: 0, interval: 100,
    frames: Array.from({ length: 6 }, () => ({ texture: {}, x: 0, y: 0 })), weaponFrames: [], hairFrames: [],
    body: sprite(), weapon: sprite(), hair: sprite(), update: entity => updates.push(entity) };
  context.exports.OnlineActor.prototype.tick.call(actor, 599);
  assert.equal(updates.length, 0);
  context.exports.OnlineActor.prototype.tick.call(actor, 600);
  assert.deepEqual(clean(updates), [{ id: 91, self: false, action: 'standing', dead: false }]);
});

test('an observed cast loads its effect sequence at the caster and clears across maps', async () => {
  const effect = effects(); effect.instance.cast(91, 4); await settle();
  assert.ok(effect.requested.includes('/effects/Magic/600.png'));
  assert.ok(effect.requested.includes('/effects/Magic/609.png'));
  assert.equal(effect.sprites[0].x, 288 * 48);
  assert.equal(effect.sprites[0].y, 619 * 32);
  effect.advance(0); assert.equal(effect.sprites[0].texture.url, '/effects/Magic/600.png');
  effect.instance.clear(); effect.advance(120);
  assert.equal(effect.sprites[0].destroyed, true);
  assert.equal(effect.instance.debugState().activeSprites, 0);
  assert.deepEqual(clean(effect.instance.debugState().errors), []);
});

test('native poison impact waits for the cast and loads poison instead of healing', async () => {
  const effect = effects(); effect.instance.cast(91, 4); await settle();
  effect.instance.resolve({ casterId: 91, targetId: 0, x: 294, y: 618, effectType: 2, effect: 4 });
  assert.equal(effect.delayed[0].delay, 540);
  effect.delayed[0].callback(); await settle();
  assert.ok(effect.requested.includes('/effects/Magic/770.png'));
  assert.ok(!effect.requested.includes('/effects/Magic/370.png'));
  assert.equal(effect.sprites.at(-1).x, 294 * 48);
  assert.equal(effect.sprites.at(-1).y, 618 * 32);
});

test('cast completion and stale map effect timers release their sprites', async () => {
  const effect = effects(); effect.instance.cast(91, 9); await settle();
  effect.advance(600);
  assert.equal(effect.instance.debugState().activeSprites, 0);
  effect.instance.resolve({ casterId: 91, targetId: 0, x: 294, y: 618, effectType: 7, effect: 9 });
  effect.instance.clear(); effect.delayed[0].callback(); await settle();
  assert.equal(effect.instance.debugState().activeSprites, 0);
});
