// Create a FRESH Colab notebook and print its NBID.
// A fresh notebook always works because the code + track come from the GitHub repo
// (clone in the first cell) — no dependency on any specific Drive notebook.
//   PORT=9333 node newnb.mjs   ->  prints NEW NBID (feed it back as NBID= to cl.mjs)
import { chromium } from 'playwright';
const PORT=parseInt(process.env.PORT||'9333',10);
const b=await chromium.connectOverCDP({endpointURL:`http://127.0.0.1:${PORT}`,timeout:90000});
const ctx=b.contexts()[0];
let page=ctx.pages().find(p=>/colab\.research\.google\.com/.test(p.url()))||await ctx.newPage();
await page.bringToFront().catch(()=>{});
await page.goto('https://colab.research.google.com/#create=true',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(6000);
if(!/\/drive\/|\/notebook/.test(page.url())){
  const c=await page.evaluate(()=>{ const el=Array.from(document.querySelectorAll('a,button,div,paper-button,mwc-button')).find(e=>e.offsetParent!==null && /^(New notebook|Создать блокнот|\+ Создать блокнот)$/i.test(e.textContent.trim())); if(el){el.click();return el.textContent.trim();} return null; });
  console.log('clicked new:',c); await page.waitForTimeout(7000);
}
await page.waitForTimeout(3000);
const url=page.url();
const m=url.match(/\/drive\/([A-Za-z0-9_-]+)/)||url.match(/\/notebook[^#]*#([A-Za-z0-9_-]+)/);
console.log('NEW URL:',url.slice(0,100));
console.log('NEW NBID:', m?m[1]:'(none)');
await page.screenshot({path:'out/newnb.png'}).catch(()=>{});
await b.close();
