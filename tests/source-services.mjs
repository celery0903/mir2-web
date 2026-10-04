import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import PF from 'pathfinding';
import {PNG} from 'pngjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const base=(process.env.MIR_URL??'http://127.0.0.1:18883').replace(/\/$/,'');
const destination=process.env.MIR_SERVICE_REPORT??'.runtime/reports/source-services';
await mkdir(destination,{recursive:true});await mkdir('.state',{recursive:true});
const resumePath=process.env.MIR_SERVICE_RESUME_REPORT;
const previous=resumePath?JSON.parse(await readFile(resumePath)):undefined;
const repairFixture=process.env.MIR_SERVICE_REPAIR_FIXTURE==='1',project=process.env.MIR_PROJECT??'mir2-rebuild';
const credentials=previous?JSON.parse(await readFile(process.env.MIR_SERVICE_RESUME_CREDENTIALS??'.state/source-services.json')):{account:`m${String(Date.now()).slice(-8)}`,password:'Source987',character:`mer${String(Date.now()).slice(-7)}`};
if(previous){assert.equal(credentials.url,base);assert.equal(previous.url,base);assert.equal(previous.state.self.name.split('\n')[0],credentials.character);}
if(repairFixture){assert.ok(previous);assert.equal(process.env.MIR_TEST_FIXTURES,'1');assert.match(project,/^mir2-(rebuild|skills-test)$/);assert.equal(new URL(base).hostname,'127.0.0.1');assert.match(credentials.account,/^m\d{8}$/);}
await writeFile('.state/source-services.json',JSON.stringify({url:base,...credentials}),{mode:0o600});
const report={checkedAt:new Date().toISOString(),url:base,passed:false,full176Acceptance:false,errors:[],missingResources:[]};
if(previous){report.scope='repair-continuation';report.continuedFrom=resumePath;report.priorPartialChecks={sale:previous.sale,purchase:previous.purchase,combatPreparation:previous.combatPreparation};}
const navigation=new Map();
async function collision(map){
 if(navigation.has(map))return navigation.get(map);
 const response=await fetch(`${base}/maps/${map}/map.json`);assert.equal(response.status,200);
 const world=await response.json(),cells=new Uint8Array(world.width*world.height);
 await Promise.all(world.chunks.map(async chunk=>{
  const response=await fetch(`${base}/maps/${map}/${chunk.file}`);assert.equal(response.status,200);
  const data=new DataView(await response.arrayBuffer());assert.equal(data.byteLength,chunk.width*chunk.height*12);
  for(let x=0;x<chunk.width;x++)for(let y=0;y<chunk.height;y++){
   const offset=(x*chunk.height+y)*12;
   cells[(chunk.y+y)*world.width+chunk.x+x]=((data.getUint16(offset,true)|data.getUint16(offset+4,true))&0x8000)===0?1:0;
  }
 }));
 const grid=new PF.Grid(world.width,world.height);
 for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++)if(!cells[y*world.width+x])grid.setWalkableAt(x,y,false);
 navigation.set(map,grid);return grid;
}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const state=()=>page.evaluate(()=>window.__mir2Agent.snapshot());
const received=[];
page.on('websocket',socket=>socket.on('framereceived',frame=>{const message=JSON.parse(String(frame.payload)).message;if(message&&['npcDialogue','shop','shopDetails','shopSellQuote','shopSellResult','shopPurchaseResult','repairQuote','repairResult','itemActionResult','entityDied'].includes(message.type))received.push(message);}));
const events=async type=>received.filter(message=>message.type===type);
page.on('pageerror',error=>report.errors.push(error.message));
page.on('response',response=>{if(response.status()>=400)report.missingResources.push({path:new URL(response.url()).pathname,status:response.status()});});
async function npc(name){
 if(await page.locator('#npc-dialog').isVisible())await page.locator('#close-dialogue').click();
 const target=(await state()).nearby.find(entity=>entity.name===name);assert.ok(target,`Missing merchant ${name}`);
 if(target.distance>8)await walk(target.x,target.y,(await state()).map);
 await page.locator('[data-window-open="targets"]').click();
 await page.locator('#nearby-targets').getByRole('button',{name:new RegExp(`^${name}`)}).click();
 await expect(page.locator('#npc-dialog')).toBeVisible({timeout:30000});
}
async function select(panel,item,method='click'){
 const slot=page.locator(`${panel} .classic-service-slot`),cell=page.locator(`#inventory-items [data-item-id="${item.makeIndex}"]`);
 if(method==='drag')await cell.dragTo(slot);else await cell.click();
 await expect(slot).toHaveAttribute('data-service-item',String(item.makeIndex));
 await expect.poll(()=>slot.locator('img').first().evaluate(image=>image.complete&&image.naturalWidth>0),{timeout:15000}).toBe(true);
}
async function walk(x,y,map,avoidThreats=false){
 const initial=await state(),initialMap=initial.map,sameMap=initialMap===map,started=Date.now();let retries=0,potionUsed=false,waypoints=0;
 // Only UI clicks perform movement. This grid plans nearby test waypoints.
 const nativeGrid=await collision(initialMap);
 const finder=new PF.AStarFinder({allowDiagonal:true,dontCrossCorners:false,heuristic:PF.Heuristic.chebyshev});
 const route=async(point)=>{
  const mini=page.locator('#mini-map'),box=await mini.boundingBox(),size=await mini.evaluate(el=>({width:el.clientWidth,height:el.clientHeight})),data=(await state()).minimap;
  await page.keyboard.down('Shift');
  try{await page.mouse.click(box.x+(data.drawRect.left+point.x/(data.world.width-1)*data.drawRect.width)*box.width/size.width,box.y+(data.drawRect.top+point.y/(data.world.height-1)*data.drawRect.height)*box.height/size.height);}
  finally{await page.keyboard.up('Shift');}
 };
 while(true){
  const current=await state();
  if(!sameMap&&current.map===map)break;
  if(sameMap&&Math.max(Math.abs(current.self.x-x),Math.abs(current.self.y-y))<=1&&!current.pending)break;
  const grid=nativeGrid.clone();
  for(const entity of current.nearby)if(!entity.dead&&(entity.x!==x||entity.y!==y))grid.setWalkableAt(entity.x,entity.y,false);
  if(avoidThreats){
   for(const entity of current.nearby.filter(entity=>!entity.dead&&['半兽人','森林雪人','毒蜘蛛','多钩猫','钉耙猫'].includes(entity.name))){
    const radius=Math.max(0,Math.min(3,entity.distance-1));
    for(let dx=-radius;dx<=radius;dx++)for(let dy=-radius;dy<=radius;dy++){
     const px=entity.x+dx,py=entity.y+dy;
     if(grid.isInside(px,py)&&(px!==current.self.x||py!==current.self.y)&&(px!==x||py!==y))grid.setWalkableAt(px,py,false);
    }
   }
  }
  const path=finder.findPath(current.self.x,current.self.y,x,y,grid).slice(1);
  assert.ok(path.length,'No route through the served native collision map');
  const cell=path[Math.min(7,path.length-1)],point={x:cell[0],y:cell[1]};waypoints++;
  await route(point);
  await expect.poll(async()=>{
   const current=await state();assert.ok(current.self?.hp>0,'Player died while walking to the merchant');
   assert.ok(Date.now()-started<600000,'Merchant walk exceeded ten minutes');
   if(current.worldReady&&current.render?.framesReady&&((!sameMap&&current.map===map)||(current.map===initialMap&&!current.pending&&Math.max(Math.abs(current.self.x-point.x),Math.abs(current.self.y-point.y))<=1)))return true;
   if(current.self.hp<10&&!potionUsed&&current.itemQuickBar.slots.some(slot=>slot.item==='金创药(小量)')){potionUsed=true;await page.keyboard.press('Digit1');}
   if(current.worldReady&&current.map===initialMap&&!current.pending&&!current.intentions.clickDestination){assert.ok(retries<20,'The map route repeatedly stopped');retries++;return true;}
   return false;
  },{timeout:30000,intervals:[50,100,150]}).toBe(true);
 }
 if(!sameMap)await expect.poll(async()=>{const current=await state();return current.worldReady&&current.map===map&&current.render?.framesReady;},{timeout:15000}).toBe(true);
 (report.walks??=[]).push({x,y,map,running:true,avoidThreats,waypoints,retries,potionUsed,elapsedMs:Date.now()-started});
}
async function returnLink(){await page.locator('#npc-text [data-dialogue-command="@Main"],#npc-text [data-dialogue-command="@main"]').click();}
try{
 if(repairFixture){
  const execute=promisify(execFile);
  await execute('docker',['stop',`${project}-engine-1`],{timeout:65000});
  try{
   const sql=`UPDATE characters SET MapName='0103',CX=12,CY=14 WHERE LoginID='${credentials.account}'; SELECT ROW_COUNT();`;
   const {stdout}=await execute('docker',['exec',`${project}-db-1`,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -N -uroot mir2_db -e "$1"','sh',sql]);
   assert.equal(stdout.trim(),'1');
  }finally{await execute('docker',['start',`${project}-engine-1`]);}
  await expect.poll(async()=>(await execute('docker',['inspect',`${project}-engine-1`,'--format','{{.State.Health.Status}}'])).stdout.trim(),{timeout:60000}).toBe('healthy');
  report.fixture='Only the dedicated isolated character position is set offline to the iron shop (0103 12,14); HP, gold, items, durability and merchant rules are unchanged. The failed long walking route is not accepted by this repair-only check.';
 }
 await collision('0');
 await page.goto(`${base}/?agent=1`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__mir2Agent,{},{timeout:60000});
 await page.locator('#account').fill(credentials.account);await page.locator('#password').fill(credentials.password);await page.locator(previous?'#auth-login-ok':'#register').click();
 await expect(page.locator('[data-auth-select]')).toBeVisible({timeout:30000});
 if(!previous){
 await page.locator('[data-auth-new]').click();await page.locator('#character-name').fill(credentials.character);await page.locator('#auth-create-ok').click();
 await expect(page.locator('[data-auth-select]')).toBeVisible({timeout:30000});
 }
 await page.waitForTimeout(1200);await page.locator('[data-auth-start]').click();
 await expect.poll(async()=>{const current=await state();return current.worldReady&&current.inventory.known&&current.render?.framesReady;},{timeout:60000}).toBe(true);
 const initial=await state();assert.equal(initial.attributes.level,1);let weapon;
 if(previous){
  const stored=previous.state.equipment.slots.find(slot=>slot.item.name==='木剑').item;
  weapon=initial.equipment.slots.find(slot=>slot.item.makeIndex===stored.makeIndex)?.item;
  assert.ok(initial.self.hp>0,'Native login did not revive the dead character');assert.ok(weapon,'Native revival lost the combat-worn weapon');
  assert.equal(weapon.durability,stored.durability);assert.equal(weapon.maxDurability,stored.maxDurability);assert.equal(initial.attributes.gold,previous.state.attributes.gold);
  report.nativeResume={before:previous.state.self,after:initial.self,revived:previous.state.self.dead,sameWeaponMakeIndex:weapon.makeIndex,storedDurabilityPreserved:true,goldPreserved:true};
 }else{
 assert.equal(initial.attributes.gold,0);
 const candle=initial.inventory.items.find(item=>item.name==='蜡烛');weapon=initial.inventory.items.find(item=>item.name==='木剑');assert.ok(candle);assert.ok(weapon);
 report.initialItems=initial.inventory.items.map(({name,makeIndex,durability,maxDurability})=>({name,makeIndex,durability,maxDurability}));
 await page.keyboard.press('F9');
 for(const name of ['木剑','布衣(男)']){await page.locator('#inventory-items').getByRole('button',{name,exact:true}).dblclick();await expect.poll(async()=>(await state()).equipment.slots.some(slot=>slot.item.name===name),{timeout:15000}).toBe(true);}
 await page.keyboard.press('F9');
 await npc('边界杂货店');await page.locator('#npc-text').getByRole('button',{name:'卖',exact:true}).click();
 await expect(page.locator('#shop-panel')).toHaveCSS('width','140px');await expect(page.locator('#shop-panel')).toHaveCSS('height','181px');await expect(page.locator('#inventory-window')).toBeVisible();
 await select('#shop-panel',candle,'drag');
 await expect(page.locator('#shop-panel').getByRole('button',{name:'卖出',exact:true})).toBeEnabled({timeout:15000});
 const quoted=(await events('shopSellQuote')).at(-1);assert.equal(quoted.item.makeIndex,candle.makeIndex);assert.ok(quoted.price>0);
 await page.locator('#shop-panel .classic-service-slot').click();
 await expect(page.locator('#shop-panel').getByRole('button',{name:'卖出',exact:true})).toBeDisabled();assert.ok((await state()).inventory.items.some(item=>item.makeIndex===candle.makeIndex));
 await select('#shop-panel',candle);
 await expect(page.locator('#shop-panel').getByRole('button',{name:'卖出',exact:true})).toBeEnabled({timeout:15000});
 await page.screenshot({path:`${destination}/sale-desktop.png`});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${destination}/sale-mobile.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#shop-panel').getByRole('button',{name:'卖出',exact:true}).click();
 await expect.poll(async()=>(await state()).inventory.items.some(item=>item.makeIndex===candle.makeIndex),{timeout:15000}).toBe(false);
 await expect.poll(async()=>(await state()).attributes.gold,{timeout:15000}).toBe(quoted.price);
 report.sale={originalDimensions:true,dragAndCancel:true,mobileConfirmation:true,makeIndex:candle.makeIndex,price:quoted.price,authoritativeGold:(await state()).attributes.gold};
 console.log('PASS native sale: original slot, drag/cancel, mobile confirmation and authoritative gold.');
 await page.setViewportSize({width:1440,height:900});
 await returnLink();await page.locator('#npc-text').getByRole('button',{name:'买',exact:true}).click();
 await expect(page.locator('#shop-panel')).toHaveCSS('width','308px');
 let goods=(await events('shop')).at(-1).items.find(item=>item.name==='蜡烛');assert.ok(goods);
 await page.locator('#shop-panel [data-service-item="goods:蜡烛"]').click();
 if(goods.subMenu>=1){
  await page.locator('#shop-panel').getByRole('button',{name:'购买',exact:true}).click();
  await expect(page.locator('#shop-panel [data-service-item^="detail:"]').first()).toBeVisible({timeout:15000});
  goods={...goods,...(await events('shopDetails')).at(-1).items[0]};await page.locator(`#shop-panel [data-service-item="detail:${goods.makeIndex}"]`).click();
 }
 const purchaseGold=(await state()).attributes.gold;
 if(purchaseGold>=goods.price){
  await page.locator('#shop-panel').getByRole('button',{name:'购买',exact:true}).click();
  await expect.poll(async()=>(await state()).inventory.items.some(item=>item.name==='蜡烛'),{timeout:15000}).toBe(true);
  const acquired=(await state()).inventory.items.find(item=>item.name==='蜡烛');assert.notEqual(acquired.makeIndex,candle.makeIndex);
  report.purchase={price:goods.price,newItemInstance:acquired.makeIndex,authoritativeGold:(await state()).attributes.gold};
 }else{
  await page.locator('#shop-panel').getByRole('button',{name:'购买',exact:true}).click();
  await expect.poll(async()=>(await events('shopPurchaseResult')).length,{timeout:15000}).toBe(1);
  const result=(await events('shopPurchaseResult')).at(-1);assert.equal(result.accepted,false);assert.equal(result.reason,3);assert.equal((await state()).attributes.gold,purchaseGold);
  assert.ok(!(await state()).inventory.items.some(item=>item.name==='蜡烛'));report.purchase={insufficientGoldRejected:true,price:goods.price,goldPreserved:true};
 }
 console.log('PASS native purchase: server detail list and gold validation.');
 await page.locator('#shop-panel .classic-window-close').click();await page.locator('#close-dialogue').click();
 await page.keyboard.press('F9');
 if((await state()).self.hp<10)await page.keyboard.press('Digit1');
 let target;const creatures=['鸡','鹿','稻草人','多钩猫','钉耙猫'],explored=new Set();
 for(let attempt=0;attempt<4&&!target;attempt++){
  const current=await state();
  const candidate=current.nearby.filter(entity=>!entity.dead&&creatures.includes(entity.name)).sort((a,b)=>a.distance-b.distance||creatures.indexOf(a.name)-creatures.indexOf(b.name))[0];
  if(!candidate){
   const excluded=new Set(current.nearby.filter(entity=>!creatures.includes(entity.name)).map(entity=>`entity-${entity.id}`));
   const marker=current.minimap.markers.filter(marker=>marker.kind==='monster'&&!excluded.has(marker.id)&&!explored.has(marker.id)).sort((a,b)=>Math.max(Math.abs(a.x-current.self.x),Math.abs(a.y-current.self.y))-Math.max(Math.abs(b.x-current.self.x),Math.abs(b.y-current.self.y)))[0];
   assert.ok(marker,'No observed wildlife marker to approach');explored.add(marker.id);await walk(marker.x,marker.y,current.map);continue;
  }
  if(candidate.distance>7)await walk(candidate.x,candidate.y,'0');
  target=(await state()).nearby.find(entity=>!entity.dead&&creatures.includes(entity.name)&&entity.distance<=8);
 }
 assert.ok(target,'No basic monster in the visible target list after approaching');
 await page.locator('[data-window-open="targets"]').click();await page.locator(`#nearby-targets [data-entity-id="${target.id}"]`).click();
 let potionUsed=false;
 await expect.poll(async()=>{const current=await state();assert.ok(current.self.hp>0);if(current.self.hp<8&&!potionUsed&&current.inventory.items.some(item=>item.stdMode===0)){potionUsed=true;await page.keyboard.press('Digit1');}const equipped=current.equipment.slots.find(slot=>slot.item.makeIndex===weapon.makeIndex)?.item;return equipped&&equipped.durability<equipped.maxDurability;},{timeout:30000}).toBe(true);
 await page.locator('#classic-window-close').click();
 report.combatPreparation={target:target.name,authoritativeWear:true};
 const well=page.locator('.hud-orb-well.hp');
 await expect(well).toHaveAttribute('data-red-only','true');
 await expect.poll(()=>well.evaluate(element=>element.style.backgroundImage.includes('/5.'))).toBe(true);
 const nativeUi=await(await fetch(`${base}/ui-national/prguse/library.json`)).json();
 const emptyOrb=PNG.sync.read(Buffer.from(await(await fetch(`${base}/ui-national/prguse/${nativeUi.frames[5].file}`)).arrayBuffer()));
 const orb=PNG.sync.read(await well.screenshot()),fillHeight=await well.locator('.hud-orb-fill').evaluate(element=>parseFloat(element.style.height));
 assert.equal(orb.width,96);assert.equal(orb.height,92);
 let checkedEmptyPixels=0,matchingEmptyPixels=0;
 for(let y=0;y<Math.min(8,Math.floor(92-fillHeight)-2);y++)for(let x=10;x<86;x++){
  const offset=(y*96+x)*4;if(emptyOrb.data[offset+3]!==255)continue;checkedEmptyPixels++;
  if(orb.data.subarray(offset,offset+3).equals(emptyOrb.data.subarray(offset,offset+3)))matchingEmptyPixels++;
 }
 assert.equal(matchingEmptyPixels,checkedEmptyPixels,'Injured low-level warrior orb exposes a split backdrop instead of the native frame');
 report.combatPreparation.grayBackdrop={originalFrame:5,checkedEmptyPixels,matchingEmptyPixels};
 }
 console.log('PASS combat preparation: server confirmed weapon wear.');
 if(!repairFixture)await walk(335,299,'0103',true);
 else assert.equal(initial.map,'0103');
 await walk(12,14,'0103');
 await page.keyboard.press('F10');
 const weaponSlot=(await state()).equipment.slots.find(slot=>slot.item.makeIndex===weapon.makeIndex).slot;
 await page.locator(`#equipment-items [data-slot="${weaponSlot}"]`).click();await expect.poll(async()=>(await state()).inventory.items.some(item=>item.makeIndex===weapon.makeIndex),{timeout:15000}).toBe(true);weapon=(await state()).inventory.items.find(item=>item.makeIndex===weapon.makeIndex);
 report.weaponWornByCombat=weapon.durability<weapon.maxDurability;
 assert.equal(report.weaponWornByCombat,true);
 console.log(`PASS combat preparation: weapon durability ${weapon.durability}/${weapon.maxDurability}.`);
 await page.keyboard.press('F10');await page.keyboard.press('Escape');
 await npc('卫家店');await page.locator('#npc-text').getByRole('button',{name:'修理',exact:true}).click();
 console.log('PASS opening the original iron shop repair service.');
 await expect(page.locator('#repair-panel')).toHaveCSS('width','140px');await expect(page.locator('#repair-panel')).toHaveCSS('height','181px');await expect(page.locator('#inventory-window')).toBeVisible();
 await select('#repair-panel',weapon,'drag');
 await expect.poll(async()=>(await events('repairQuote')).at(-1)?.item.makeIndex,{timeout:15000}).toBe(weapon.makeIndex);
 const repairQuote=(await events('repairQuote')).at(-1);report.repair={originalDimensions:true,dragSelection:true,price:repairQuote.price,before:weapon};
 await page.mouse.move(10,10);await page.screenshot({path:`${destination}/repair-desktop.png`});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${destination}/repair-mobile.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(repairQuote.price<0){
  await expect(page.locator('#repair-panel').getByRole('button',{name:'修理',exact:true})).toBeDisabled();report.repair.rejectedQuoteDisabled=true;
  assert.fail('The native iron merchant refused the combat-worn wood sword');
 }else{
  const goldBefore=(await state()).attributes.gold;
  const responseStart=received.length;
  await page.locator('#repair-panel').getByRole('button',{name:'修理',exact:true}).click();
  await expect.poll(async()=>(await events('repairResult')).at(-1)?.item.makeIndex,{timeout:15000}).toBe(weapon.makeIndex);
  const result=(await events('repairResult')).at(-1);report.repair.accepted=result.accepted;
  report.repair.responseOrder=received.slice(responseStart).map(message=>message.type);
  assert.equal(result.accepted,true,'The native repair must confirm the worn sword');
  report.repair.serverItem={durability:result.item.durability,maxDurability:result.item.maxDurability};
  await expect(page.locator('#world-status')).toContainText('修理完成',{timeout:15000});
  await expect.poll(async()=>{const item=(await state()).inventory.items.find(item=>item.makeIndex===weapon.makeIndex);return item&&item.durability===result.item.durability&&item.maxDurability===result.item.maxDurability;},{timeout:15000}).toBe(true);
  const after=(await state()).inventory.items.find(item=>item.makeIndex===weapon.makeIndex);assert.ok(after);report.repair.after=after;
  if(result.accepted){assert.equal(after.durability,after.maxDurability);assert.equal((await state()).attributes.gold,goldBefore-repairQuote.price);report.repair.authoritativeDurability=true;}
  else{assert.equal(after.durability,weapon.durability);assert.equal((await state()).attributes.gold,goldBefore);report.repair.rejectedWithoutMutation=true;}
 }
 const remainingPotion=(await state()).inventory.items.find(item=>item.stdMode===0);
 if(remainingPotion){
  await page.keyboard.press('Digit1');
  await expect.poll(async()=>(await events('itemActionResult')).some(result=>result.kind==='use'&&result.makeIndex===remainingPotion.makeIndex&&result.accepted),{timeout:15000}).toBe(true);
  await expect.poll(async()=>{const current=await state();return !current.inventory.items.some(item=>item.makeIndex===remainingPotion.makeIndex)&&!current.itemQuickBar.slots.some(slot=>slot.makeIndex===remainingPotion.makeIndex);},{timeout:15000}).toBe(true);
 }
 report.consumedItemsSynchronized=[];
 for(const result of (await events('itemActionResult')).filter(message=>message.kind==='use'&&message.accepted)){
  const current=await state();assert.ok(!current.inventory.items.some(item=>item.makeIndex===result.makeIndex));assert.ok(!current.itemQuickBar.slots.some(slot=>slot.makeIndex===result.makeIndex));
  report.consumedItemsSynchronized.push({makeIndex:result.makeIndex,name:result.item.name});
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.missingResources,[]);report.passed=true;
}catch(error){
 report.error=String(error);report.state=await state().catch(()=>undefined);delete report.state?.dialogue;
 await page.screenshot({path:`${destination}/failure.png`}).catch(()=>{});process.exitCode=1;
}finally{
 await browser.close();await writeFile(`${destination}/evidence.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
