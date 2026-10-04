import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import PF from 'pathfinding';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test.skip(process.env.MIR_BROWSER_FEATURES !== '1', 'Requires the explicitly prepared seven-level qa fixtures');
test.use({ actionTimeout: 10000, trace: 'off' });

async function observe(page: Page) {
  await page.addInitScript(() => {
    const target = window as any;
    target.mirEvidence = { events: [], user: null, objects: {}, classificationErrors: [] };
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          const packet = JSON.parse(event.data), d = packet.data, state = target.mirEvidence;
          if (['ObjectDied','ObjectGold','ObjectItem','DamageIndicator','MagicEffect','HealthChanged'].includes(packet.type)) state.events.push(packet);
          if (packet.type === 'UserInformation') state.user = d;
          if (['UserLocation','UserAbility','UserGold','UserExperience','UserSlotsRefresh','UserMagics','HealthChanged','LevelChanged'].includes(packet.type) && state.user) Object.assign(state.user, d);
          if (packet.type === 'MapInformation') { state.objects = {}; if (state.user) Object.assign(state.user, d); }
          if (['ObjectPlayer','ObjectMonster','ObjectNPC','ObjectGold','ObjectItem'].includes(packet.type)) {
            state.objects[d.objectID] = { ...d, type: packet.type };
            const expected = ({ player: 'ObjectPlayer', monster: 'ObjectMonster', npc: 'ObjectNPC' } as Record<string,string>)[d.kind];
            if (expected && packet.type !== expected) state.classificationErrors.push(`${d.objectID}: ${d.kind} emitted as ${packet.type}`);
          }
          if (['ObjectWalk','ObjectRun','ObjectTurn','ObjectAttack'].includes(packet.type) && state.objects[d.objectID]) Object.assign(state.objects[d.objectID], d);
          if (packet.type === 'ObjectDied' && state.objects[d.objectID]) Object.assign(state.objects[d.objectID], d, { dead: true });
          if (packet.type === 'ObjectRemove') delete state.objects[d.objectID];
        });
      }
    };
  });
}
const state = (page: Page) => page.evaluate(() => (window as any).mirEvidence);
const directions = [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]];
const keys = [['ArrowUp'],['ArrowUp','ArrowRight'],['ArrowRight'],['ArrowRight','ArrowDown'],['ArrowDown'],['ArrowDown','ArrowLeft'],['ArrowLeft'],['ArrowLeft','ArrowUp']];

async function consume(page: Page, name: string) {
  const slot = (await state(page)).user.inventory.findIndex((item: any) => item?.name === name);
  if (slot < 0) return;
  if (slot < 6) await page.keyboard.press(String(slot + 1));
  else {
    await page.keyboard.press('F9');
    await page.locator(`#inventory [data-item="${slot}"]`).dblclick();
    await page.keyboard.press('F9');
  }
}

function monsters(s: any, names: string[], nearby = false) {
  const p = s.user.location;
  return (Object.values(s.objects) as any[]).filter(o => o.type === 'ObjectMonster' && !o.dead && names.includes(o.name) && (!nearby || Math.abs(o.location.x-p.x)<8 && Math.abs(o.location.y-p.y)<6))
    .sort((a,b) => Math.hypot(a.location.x-p.x,a.location.y-p.y)-Math.hypot(b.location.x-p.x,b.location.y-p.y));
}

async function move(page: Page, x: number, y: number, radius = 0, destinationMap?: string, stopFor?: string[]) {
  const initial = await state(page), map = initial.user.map ?? '0';
  const rows = await page.evaluate(async id => (await (await fetch(`/assets/classic/${id === '0' ? '' : `maps/${id}/`}collision.json`)).json()).rows, map);
  for (let step = 0; step < 130; step++) {
    const s = await state(page), p = s.user.location;
    if (s.user.map !== map) {
      if (s.user.map === destinationMap) return;
      throw new Error(`Unexpected map transition ${map} -> ${s.user.map}`);
    }
    if (stopFor && monsters(s, stopFor, true).length) return;
    if (Math.max(Math.abs(p.x-x),Math.abs(p.y-y)) <= radius) return;
    const left = Math.max(0, Math.min(p.x,x)-15), top = Math.max(0,Math.min(p.y,y)-15);
    const right = Math.min(rows[0].length-1,Math.max(p.x,x)+15), bottom = Math.min(rows.length-1,Math.max(p.y,y)+15);
    const grid = new PF.Grid(Array.from({length:bottom-top+1},(_,b)=>Array.from({length:right-left+1},(_,a)=>rows[top+b][left+a] === '0' ? 0 : 1)));
    for (const o of Object.values(s.objects) as any[]) if (!o.dead && ['ObjectPlayer','ObjectMonster','ObjectNPC'].includes(o.type) && o.location.x >= left && o.location.x <= right && o.location.y >= top && o.location.y <= bottom) grid.setWalkableAt(o.location.x-left,o.location.y-top,false);
    grid.setWalkableAt(p.x-left,p.y-top,true);
    const finder = new PF.AStarFinder({diagonalMovement:PF.DiagonalMovement.OnlyWhenNoObstacles});
    let path: number[][] = [];
    for (let a=x-radius;a<=x+radius;a++) for (let b=y-radius;b<=y+radius;b++) {
      if (a<left||a>right||b<top||b>bottom||(radius&&!grid.isWalkableAt(a-left,b-top))) continue;
      const candidate=grid.clone(); candidate.setWalkableAt(a-left,b-top,true);
      const found=finder.findPath(p.x-left,p.y-top,a-left,b-top,candidate);
      if (found.length&&(!path.length||found.length<path.length)) path=found;
    }
    if (path.length < 2) {
      const blocker = monsters(s,['稻草人','多钩猫','钉耙猫']).find(o => Math.max(Math.abs(o.location.x-p.x),Math.abs(o.location.y-p.y)) <= 1);
      if (blocker) {
        const selected = await selectMonster(page,blocker), until = Date.now()+30000;
        let healedAt = 0;
        while (Date.now()<until) {
          const combat = await state(page), actor = combat.objects[selected.objectID];
          if (!actor || actor.dead) break;
          expect(combat.user.hp).toBeGreaterThan(0);
          if (combat.user.hp<combat.user.maxHP*0.65 && Date.now()-healedAt>4000 && combat.user.inventory.some((i:any)=>i?.name==='金创药(小量)')) {
            await consume(page,'金创药(小量)'); healedAt=Date.now();
          }
          await page.waitForTimeout(650);
        }
      } else await page.waitForTimeout(650);
      continue;
    }
    const direction = directions.findIndex(([dx,dy])=>dx===Math.sign(path[1][0]+left-p.x)&&dy===Math.sign(path[1][1]+top-p.y));
    for (const key of keys[direction]) await page.keyboard.down(key);
    try { await expect.poll(async()=>JSON.stringify((await state(page)).user.location),{timeout:2000}).not.toBe(JSON.stringify(p)); }
    catch { expect((await state(page)).user.hp, 'A rejected step must leave the player alive to recalculate a route').toBeGreaterThan(0); }
    finally { for (const key of keys[direction]) await page.keyboard.up(key); }
    await page.waitForTimeout(650);
  }
  throw new Error(`Browser could not reach ${x},${y}`);
}

async function seekMonster(page: Page, names: string[]) {
  for (const [x,y] of [[280,625],[280,610],[270,600],[260,610],[270,625],[255,625]]) {
    const s = await state(page), nearby = monsters(s,names,true)[0];
    if (nearby) return nearby;
    const visible = monsters(s,names)[0];
    if (visible) await move(page,visible.location.x,visible.location.y,3,undefined,names);
    else await move(page,x,y,1,undefined,names);
    const target = monsters(await state(page),names,true)[0];
    if (target) return target;
  }
  throw new Error(`No reachable visible monster found: ${names.join(', ')}`);
}

async function tile(page: Page, x: number, y: number, objectID?: number) {
  await page.waitForTimeout(800);
  const s = await state(page), box = (await page.locator('#world canvas').boundingBox())!, p = s.user.location;
  if (objectID !== undefined) {
    const current = s.objects[objectID];
    if (!current || current.dead) return false;
    x = current.location.x; y = current.location.y;
  }
  const rows = await page.evaluate(async id => (await (await fetch(`/assets/classic/${id === '0' ? '' : `maps/${id}/`}collision.json`)).json()).rows, s.user.map ?? '0');
  const scrollX = Math.max(0,Math.min(rows[0].length*48-800,p.x*48+24-400));
  const scrollY = Math.max(0,Math.min(rows.length*32-600,p.y*32+78-300));
  await page.mouse.click(box.x+(x*48+24-scrollX)*box.width/800,box.y+(y*32+16-scrollY)*box.height/600);
  return true;
}

async function selectMonster(page: Page, target: any) {
  for (let attempt=0;attempt<8;attempt++) {
    const observed = (await state(page)).objects[target.objectID];
    if (!observed || observed.dead) target = await seekMonster(page, [target.name]);
    else target = observed;
    if (!await tile(page,target.location.x,target.location.y,target.objectID)) continue;
    await page.waitForTimeout(150);
    const selected=Number(await page.locator('#target-hud').getAttribute('data-object-id'));
    const current=(await state(page)).objects[selected];
    if (current?.type==='ObjectMonster' && !current.dead && current.name===target.name) {
      return current;
    }
    if (attempt % 2 === 1) await move(page, target.location.x, target.location.y, 2);
  }
  throw new Error(`Browser could not select live monster ${target.objectID}`);
}

async function leaveBookshop(page: Page) {
  await move(page,14,15,0,'0');
  if ((await state(page)).user.map === '0132') await page.keyboard.press('ArrowDown',{delay:120});
  await expect(page.locator('.world-name')).toContainText('比奇省');
  await expect(page.locator('#world')).toHaveAttribute('data-map-ready','true');
}

test('native merchant, map transition, three-job combat and skills through browser controls', async ({ page, baseURL }) => {
  test.setTimeout(900000);
  const fixtures = JSON.parse(await readFile('.state/native-fixtures.json','utf8'));
  expect(fixtures.every((f:any)=>/^qa[012]\d{7}$/.test(f.accountID))).toBe(true);
  const project=process.env.MIR_COMPOSE_PROJECT??'mir2-rebuild',run=promisify(execFile);
  expect(/^[a-z0-9-]+$/.test(project)).toBe(true);
  await run('docker',['stop',`${project}-engine-1`],{timeout:65000});
  for (const f of fixtures) {
    await run('docker',['exec',`${project}-db-1`,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot mir2_db -e "$1"','sh',`DELETE m FROM characters_magic m JOIN characters c ON m.PlayerId=c.Id WHERE c.LoginID='${f.accountID}'; UPDATE characters_ablity a JOIN characters c ON a.PlayerId=c.Id SET a.Hp=30,a.Mp=30 WHERE c.LoginID='${f.accountID}';`]);
  }
  await run('docker',['start',`${project}-engine-1`]);
  await expect.poll(async()=>{try{return (await page.request.get(`${baseURL}/healthz`)).ok();}catch{return false;}},{timeout:90000}).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status()>=400 && response.url().includes('/assets/')) errors.push(`${response.status()} ${response.url()}`); });
  await observe(page);
  const evidence: any[] = [];
  for (const f of fixtures) {
    await page.goto(baseURL!);
    await expect(page.locator('#connection-status')).toHaveText('已连接');
    await page.locator('#account').fill(f.accountID); await page.locator('#password').fill(f.password);
    await page.locator('#auth-submit').click(); await page.locator('.character').click(); await page.locator('#start-character').click();
    await expect(page.locator('#player-hud')).toBeVisible({timeout:15000});
    await expect(page.locator('#world')).toHaveAttribute('data-map-ready','true');
    if ((await state(page)).user.map === '0132') await leaveBookshop(page);
    if (f.job === 0 || f.job === 1) {
      await move(page,288,609,3);
      await tile(page,288,609);
      await expect(page.locator('#npc-panel')).toBeVisible();
      await page.locator('[data-npc-key="[@buy]"]').click();
      const potion = page.locator('.shop-item').filter({hasText:'魔法药(小量)'});
      await expect(potion).toBeVisible();
      const before = (await state(page)).user.gold;
      const oldItems = new Set((await state(page)).user.inventory.filter(Boolean).map((i:any)=>i.uniqueID));
      await potion.dblclick();
      await expect.poll(async()=>(await state(page)).user.gold).toBeLessThan(before);
      const bought = (await state(page)).user.inventory.find((i:any)=>i?.name==='魔法药(小量)'&&!oldItems.has(i.uniqueID));
      expect(bought).toBeTruthy();
      await page.locator('[data-npc-key="[@Main]"]').click();
      await page.locator('[data-npc-key="[@sell]"]').click();
      const slot = (await state(page)).user.inventory.findIndex((i:any)=>i?.uniqueID===bought.uniqueID);
      if (slot < 6) await page.locator(`#belt [data-item="${slot}"]`).click();
      else await page.locator(`#inventory [data-item="${slot}"]`).dblclick();
      await expect.poll(async()=>(await state(page)).user.inventory.some((i:any)=>i?.uniqueID===bought.uniqueID)).toBe(false);
      if (f.job===0) {
        await page.locator('[data-npc-key="[@Main]"]').click();
        await page.locator('[data-npc-key="[@buy]"]').click();
        const healing=page.locator('.shop-item').filter({hasText:'金创药(小量)'});
        const supplyCount=(await state(page)).user.inventory.filter((i:any)=>i?.name==='金创药(小量)').length;
        for (let n=supplyCount;n<10;n++) {
          const oldGold=(await state(page)).user.gold;
          await healing.dblclick();
          await expect.poll(async()=>(await state(page)).user.gold).toBeLessThan(oldGold);
        }
      }
      await page.screenshot({path:'test-results/shop.png'});
      await page.getByRole('button',{name:'关闭对话',exact:true}).click();
      await page.locator('#close-bag').click();
    }
    const skill = ['基本剑术','火球术','治愈术'][f.job];
    if ((await state(page)).user.map !== '0132') {
      await move(page,283,636,0,'0132');
      if ((await state(page)).user.map === '0') await page.keyboard.press('ArrowLeft',{delay:120});
    }
    await expect(page.locator('.world-name')).toContainText('边界书店');
    await expect(page.locator('#world')).toHaveAttribute('data-map-ready','true');
    await move(page,12,13); await tile(page,10,11);
    await expect(page.locator('#npc-panel')).toBeVisible();
    await page.locator('[data-npc-key="[@buy]"]').click();
    const book=page.locator('.shop-item').filter({hasText:skill});
    await expect(book).toBeVisible();
    const oldBooks=new Set((await state(page)).user.inventory.filter(Boolean).map((i:any)=>i.uniqueID));
    await book.dblclick();
    await expect.poll(async()=>(await state(page)).user.inventory.some((i:any)=>i?.name===skill&&!oldBooks.has(i.uniqueID))).toBe(true);
    const bookID=(await state(page)).user.inventory.find((i:any)=>i?.name===skill&&!oldBooks.has(i.uniqueID)).uniqueID;
    if (f.job===1) await page.screenshot({path:'test-results/bookshop.png'});
    await page.getByRole('button',{name:'关闭对话',exact:true}).click();
    await page.getByRole('button',{name:'打开背包',exact:true}).click();
    const bookSlot=(await state(page)).user.inventory.findIndex((i:any)=>i?.uniqueID===bookID);
    await page.locator(`#inventory [data-item="${bookSlot}"]`).dblclick();
    await expect.poll(async()=>(await state(page)).user.magics.some((m:any)=>m.name===skill)).toBe(true);
    await page.locator('#close-bag').click();
    await leaveBookshop(page);
    console.log(`PASS: browser job ${f.job} bought and learned ${skill} through the bookshop and inventory controls.`);
    await page.getByRole('button',{name:'打开技能',exact:true}).click();
    await expect(page.locator('#skills-list')).toContainText(skill);
    if (f.job !== 0) await page.getByLabel(`${skill}快捷键`).selectOption('1');
    await page.locator('#close-character').click();
    await page.locator('body').click({position:{x:10,y:10}});
    if (f.job === 0) {
      let pickedUp = false;
      for (let attempt = 0; attempt < 12 && !pickedUp; attempt++) {
        let target=await seekMonster(page,['稻草人','多钩猫','钉耙猫']);
        const after=(await state(page)).events.length;
        target=await selectMonster(page,target);
        const until=Date.now()+60000;
        let died=false;
        while (Date.now()<until) {
          const combat=await state(page);
          died=combat.events.slice(after).some((e:any)=>e.type==='ObjectDied'&&e.data.objectID===target.objectID);
          if (died) break;
          expect(combat.user.hp).toBeGreaterThan(0);
          if (combat.user.hp<combat.user.maxHP*0.65) await consume(page,'金创药(小量)');
          await page.waitForTimeout(700);
        }
        expect(died).toBe(true);
        await page.waitForTimeout(800);
        const s=await state(page), corpse=s.events.slice(after).find((e:any)=>e.type==='ObjectDied'&&e.data.objectID===target.objectID).data;
        const drop=s.events.slice(after).find((e:any)=>['ObjectItem','ObjectGold'].includes(e.type)&&Math.max(Math.abs(e.data.location.x-corpse.location.x),Math.abs(e.data.location.y-corpse.location.y))<=5);
        if (!drop) continue;
        await page.screenshot({path:'test-results/combat.png'});
        await move(page,drop.data.location.x,drop.data.location.y);
        const before=(await state(page)).user, count=before.inventory.filter(Boolean).length, gold=before.gold;
        await page.keyboard.press('E');
        await expect.poll(async()=>Boolean((await state(page)).objects[drop.data.objectID])).toBe(false);
        if (drop.type==='ObjectGold') await expect.poll(async()=>(await state(page)).user.gold).toBeGreaterThan(gold);
        else await expect.poll(async()=>(await state(page)).user.inventory.filter(Boolean).length).toBeGreaterThan(count);
        pickedUp=true;
        evidence.push({job:f.job,skill,learnedFromPurchasedBook:true,mapTransitions:['0','0132','0'],shopBoughtAndSold:true,loot:{monster:target.name,drop:drop.data.name,pickedUp:true}});
        console.log(`PASS: browser warrior killed ${target.name} and picked up ${drop.data.name}.`);
      }
      expect(pickedUp).toBe(true);
    }
    let castTarget:any;
    if (f.job===1 || f.job===2) {
      castTarget=await seekMonster(page,f.job===1?['鹿','稻草人']:['稻草人','多钩猫','钉耙猫']);
      if (f.job===1) castTarget=await selectMonster(page,castTarget);
      else {
        await move(page,castTarget.location.x,castTarget.location.y,1);
        await expect.poll(async()=>(await state(page)).user.hp,{timeout:30000}).toBeLessThan((await state(page)).user.maxHP);
        await page.keyboard.press('ArrowDown',{delay:120});
      }
    }
    if (f.job !== 0) {
      const before=await state(page),after=before.events.length,mana=before.user.mp,health=before.user.hp;
      await page.keyboard.press('F1');
      await expect.poll(async()=>(await state(page)).events.slice(after).some((e:any)=>e.type==='MagicEffect'&&e.data.effect===(f.job===1?1:2))).toBe(true);
      await expect.poll(async()=>(await state(page)).events.slice(after).some((e:any)=>e.type==='HealthChanged'&&e.data.mp<mana)).toBe(true);
      if (f.job===1) await expect.poll(async()=>(await state(page)).events.slice(after).some((e:any)=>e.type==='DamageIndicator'&&e.data.objectID===castTarget.objectID&&e.data.damage>0),{timeout:10000}).toBe(true);
      else await expect.poll(async()=>(await state(page)).events.slice(after).some((e:any)=>e.type==='HealthChanged'&&e.data.hp>health),{timeout:15000}).toBe(true);
      evidence.push({job:f.job,skill,learnedFromPurchasedBook:true,mapTransitions:['0','0132','0'],shopBoughtAndSold:f.job===1,manaConsumed:true,targetDamaged:f.job===1,healthIncreased:f.job===2});
      console.log(`PASS: browser job ${f.job} cast ${skill}, consumed mana and ${f.job===1?'damaged its target':'restored health'}.`);
      await page.waitForTimeout(150);
      await page.screenshot({path:`test-results/${f.job===1?'fireball':'healing'}.png`});
    }
    await page.keyboard.press('Escape');
    const s=await state(page), u=s.user;
    expect(s.classificationErrors).toEqual([]);
    const learned=u.magics.find((m:any)=>m.name===skill);
    Object.assign(f,{location:u.location,map:u.map??'0',gold:u.gold,level:u.level,experience:u.experience,equipment:u.equipment.map((i:any)=>i?.uniqueID??null),inventory:u.inventory.filter(Boolean).map((i:any)=>i.uniqueID),magic:{spell:learned.spell,key:f.job===0?learned.key:1}});
    await page.getByRole('button',{name:'退出游戏',exact:true}).first().click();
    await expect(page.locator('#auth-submit')).toBeVisible(); await page.waitForTimeout(2500);
    await writeFile('.state/native-fixtures.json',JSON.stringify(fixtures,null,2)+'\n');
  }
  await writeFile('.state/native-fixtures.json',JSON.stringify(fixtures,null,2)+'\n');
  expect(errors).toEqual([]);
  await writeFile('.state/browser-feature-evidence.json',JSON.stringify({controls:'Browser clicks and keyboard only; WebSocket observer is passive.',classificationErrors:[],errors,evidence},null,2)+'\n');
});
