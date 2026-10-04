import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.skip(process.env.MIR_HEALING_VISUAL !== '1', 'Requires an injured Tao fixture with a learned and bound healing skill');
test.use({ trace: 'off' });

test('native healing animation through the browser skill button', async ({ page, baseURL }) => {
  const fixture = JSON.parse(await readFile('.state/native-fixtures.json','utf8')).find((f:any)=>f.job===2);
  expect(fixture.magic).toEqual({spell:2,key:1});
  const errors: string[] = [];
  page.on('pageerror', error=>errors.push(error.message));
  page.on('response', response=>{if(response.status()>=400 && response.url().includes('/assets/')) errors.push(response.url());});
  await page.addInitScript(()=>{
    const target = window as any, Original = window.WebSocket;
    target.healingEvidence = {user:null,castAt:0};
    window.WebSocket = class extends Original {
      constructor(url:string|URL,protocols?:string|string[]) {
        super(url,protocols);
        this.addEventListener('message',event=>{
          const packet=JSON.parse(event.data),state=target.healingEvidence;
          if(packet.type==='UserInformation') state.user=packet.data;
          if(['UserAbility','HealthChanged'].includes(packet.type) && state.user) Object.assign(state.user,packet.data);
          if(packet.type==='MagicEffect' && packet.data.effect===2) state.castAt=Date.now();
        });
      }
    };
  });
  await page.goto(baseURL!);
  await expect(page.locator('#connection-status')).toHaveText('已连接');
  await page.locator('#account').fill(fixture.accountID);
  await page.locator('#password').fill(fixture.password);
  await page.locator('#auth-submit').click(); await page.locator('.character').click(); await page.locator('#start-character').click();
  await expect(page.locator('#world')).toHaveAttribute('data-map-ready','true');
  await expect.poll(()=>page.evaluate(()=>{
    const u=(window as any).healingEvidence.user; return u && u.hp>0 && u.hp<u.maxHP;
  }),{timeout:30000}).toBe(true);
  await page.keyboard.press('F1');
  await expect.poll(()=>page.evaluate(()=>(window as any).healingEvidence.castAt)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await page.screenshot({path:'test-results/healing.png'});
  await page.getByRole('button',{name:'退出游戏',exact:true}).first().click();
  await expect(page.locator('#auth-submit')).toBeVisible();
  expect(errors).toEqual([]);
});
