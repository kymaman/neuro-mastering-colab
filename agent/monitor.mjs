// Read-only progress monitor with keepalive. Watches the run cell, keeps the runtime
// alive with real mouse moves, prints new output, stops when MARK is seen.
//   PORT=9333 NBID=<id> MARK="ALL DONE" POLLMIN=120 node monitor.mjs
import { chromium } from 'playwright';
const PORT=parseInt(process.env.PORT||'9333',10);
const NBID=process.env.NBID||'';
const MARK=process.env.MARK||'ALL DONE';
const POLLMIN=parseInt(process.env.POLLMIN||'120',10);
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx=browser.contexts()[0];
const page=ctx.pages().find(p=>NBID&&p.url().includes(NBID))||ctx.pages()[0];
function read(){ return page.evaluate(()=>{
  let f=''; document.querySelectorAll('.cell').forEach(c=>{const t=c.innerText||''; if(t.includes('install deps')||t.includes('RESULT_')||t.includes('Apollo')){ if(t.length>f.length)f=t; }});
  // running indicator says "Выполнение (X мин Y сек)" / "Executing (...)" — NOT "Выполняется"
  const exec=(document.body.innerText.match(/Выполнение \([^)]*\)|Executing \([^)]*\)/)||[])[0]||'';
  return {tail:f.slice(-1100), exec, hasResult:/RESULT_MP3/.test(f)};
}); }
const iters=Math.ceil(POLLMIN*60/40); let last='';
for(let i=0;i<iters;i++){
  try{ await page.mouse.move(220+(i%6)*6, 320+(i%4)*5); await page.mouse.move(232,326); }catch{}  // keepalive
  let r; try{ r=await read(); }catch(e){ r={tail:'(read err '+String(e).slice(0,50)+')',exec:'',hasResult:false}; }
  if(r.tail!==last){ console.log(`\n===== t+${(i*40/60).toFixed(1)}min | ${r.exec||'idle'} =====`); console.log(r.tail.slice(-700)); last=r.tail; }
  else process.stdout.write(' .['+(r.exec||'idle')+']');
  if(new RegExp(MARK).test(r.tail) || r.hasResult){ console.log('\n>>> DONE: mark/result seen'); break; }
  if(/Traceback|CUDA out of memory|ModuleNotFoundError|fatal:/i.test(r.tail)){ console.log('\n!!! possible ERROR (still watching)'); }
  await page.waitForTimeout(40000);
}
console.log('\n===== FINAL =====');
const fin=await read(); console.log(fin.exec||'idle','\n'+fin.tail.slice(-1400));
await browser.close();
console.log('\n[monitor done]');
