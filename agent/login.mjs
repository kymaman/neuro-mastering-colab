// Programmatic Google login into the automation Chrome profile (LAST RESORT).
//
// ⚠️ STRONGLY PREFER interactive login: open the automation Chrome window (the one
// cl.mjs launched on PORT) and sign in by hand ONCE. That session is device-bound and
// lasts hours/days. Programmatic login often trips 2FA / "verify it's you" / device
// challenges and is fragile.
//
// Credentials come from ENV ONLY — never hardcode, never commit them:
//   EMAIL=you@gmail.com PW='...' PORT=9333 node login.mjs
import { chromium } from 'playwright';
const PORT=parseInt(process.env.PORT||'9333',10);
const EMAIL=process.env.EMAIL, PW=process.env.PW;
if(!EMAIL||!PW){ console.log('set EMAIL and PW env vars'); process.exit(1); }
const b=await chromium.connectOverCDP({endpointURL:`http://127.0.0.1:${PORT}`,timeout:90000});
const ctx=b.contexts()[0];
let page=ctx.pages().find(p=>/accounts\.google/.test(p.url()))||await ctx.newPage();
await page.bringToFront().catch(()=>{});
await page.goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fcolab.research.google.com%2F&hl=en',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
async function snap(t){ console.log('['+t+']',page.url().slice(0,70),'|',(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,120)))); }
await snap('arrive');
let chooser=await page.$$('div[data-identifier], li[data-identifier]');
if(chooser.length){
  let picked=false;
  for(const el of chooser){ const id=(await el.getAttribute('data-identifier')||'').toLowerCase(); if(id===EMAIL.toLowerCase()){ await el.click(); picked=true; } }
  if(!picked){ await page.getByText(/Use another account|Add account|Использовать другой аккаунт/i).first().click({timeout:5000}).catch(()=>{}); }
  await page.waitForTimeout(3000); await snap('after-chooser');
}
const emailIn=page.locator('input[type=email]:visible, #identifierId').first();
if(await emailIn.count() && await emailIn.isVisible().catch(()=>false)){
  await emailIn.fill(EMAIL,{timeout:8000});
  await page.locator('#identifierNext').first().click({timeout:6000}).catch(()=>emailIn.press('Enter'));
  await page.waitForTimeout(4000); await snap('after-email');
}
const pwIn=page.locator('input[type=password]:visible').first();
await pwIn.waitFor({state:'visible',timeout:25000});
await page.waitForTimeout(700); await pwIn.click().catch(()=>{});
await pwIn.fill(PW,{timeout:10000});
await page.locator('#passwordNext').first().click({timeout:6000}).catch(()=>pwIn.press('Enter'));
console.log('pw submitted'); await page.waitForTimeout(9000); await snap('after-pw');
await page.screenshot({path:'out/login.png'}).catch(()=>{});
await b.close();
