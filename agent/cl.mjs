// Consolidated Colab driver (Playwright over CDP).
// Drives a DEDICATED Chrome profile so it never touches your personal browser.
//
// Env:
//   CHROME_PATH    path to chrome.exe (default: common Windows location)
//   CHROME_PROFILE user-data-dir for the automation profile (default: ./chrome-agent)
//   PORT           CDP debug port (default: 9333 — keep it distinct from other automation)
//   NBID           Colab notebook id (the part after /drive/ in the URL)
//   COOKIES        (optional) Netscape cookies.txt to inject — but PREFER interactive login
//   ACTION         boot | gpu | cmd | poll | state
//   CMD / LABEL    for ACTION=cmd: the cell text to run (LABEL is logged instead of CMD)
//   POLLMIN / MARK for ACTION=poll
//
// IMPORTANT: cookies exported to a file expire in ~1.5h and a full pass is 60-110 min,
// so the run dies mid-way (see docs/ERRORS_AND_GOTCHAS.md). The reliable path is to
// LOG IN INTERACTIVELY once inside this automation profile (device-bound session lasts
// for hours/days). Then just use ACTION=cmd / poll.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
const CHROME=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE=process.env.CHROME_PROFILE||(process.cwd()+'\\chrome-agent');
const PORT=parseInt(process.env.PORT||'9333',10);
const NBID=process.env.NBID||'';
const NB='https://colab.research.google.com/drive/'+NBID;
const COOKIES=process.env.COOKIES||'';
const ACTION=process.env.ACTION||'state';
function parseNetscape(file){ const out=[]; for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){ if(!line||line.startsWith('#'))continue; const p=line.split('\t'); if(p.length<7)continue; const [domain,,path,secure,expiry,name,value]=p; const c={name,value,domain,path,secure:secure==='TRUE',httpOnly:false,sameSite:'Lax'}; const exp=parseInt(expiry,10); if(exp>0)c.expires=exp; out.push(c);} return out; }
async function cdpUp(){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/version`); return r.ok; }catch{ return false; } }
async function ensureChrome(){
  if(await cdpUp()) return;
  const proc=spawn(CHROME,[`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,'--no-first-run','--no-default-browser-check','about:blank'],{detached:true,stdio:'ignore'});
  proc.unref();
  for(let i=0;i<40;i++){ if(await cdpUp())return; await new Promise(r=>setTimeout(r,500)); }
  throw new Error('Chrome did not expose CDP on '+PORT);
}
function mkdir(){ try{fs.mkdirSync('out',{recursive:true});}catch{} }
async function getNB(ctx,open){
  let page=ctx.pages().find(p=>NBID&&p.url().includes(NBID));
  if(!page && open){ page=await ctx.newPage(); await page.goto(NB,{waitUntil:'domcontentloaded',timeout:90000}); await page.waitForTimeout(9000); }
  return page;
}

await ensureChrome();
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx=browser.contexts()[0];
mkdir();

if(ACTION==='boot'){
  if(COOKIES){ try{ const cs=parseNetscape(COOKIES); await ctx.addCookies(cs); console.log('cookies injected:',cs.length,'(WARNING: file cookies expire ~1.5h — prefer interactive login)'); }catch(e){ console.log('cookie err',String(e).slice(0,80)); } }
  let page=ctx.pages().find(p=>NBID&&p.url().includes(NBID))||ctx.pages()[0]||await ctx.newPage();
  await page.goto(NBID?NB:'https://colab.research.google.com/',{waitUntil:'domcontentloaded',timeout:90000}); await page.waitForTimeout(9000);
  const st=await page.evaluate(()=>{
    const signin=/^\s*(Sign in|Войти)/i.test(document.body.innerText) || /accounts\.google\.com/i.test(location.href);
    const conn=Array.from(document.querySelectorAll('*')).filter(e=>e.children.length===0 && /Connect|Подключиться|RAM|Disk|Reconnect|Переподключ/i.test(e.textContent||'')).map(e=>e.textContent.trim()).slice(0,8);
    return {title:document.title,url:location.href,signin,conn,bodyhead:document.body.innerText.replace(/\s+/g,' ').slice(0,260)};
  });
  console.log('TITLE:',st.title,'\nURL:',st.url,'\nSIGNIN?:',st.signin,'\nRUNTIME HINTS:',JSON.stringify(st.conn),'\nBODY:',st.bodyhead);
  await page.screenshot({path:'out/boot.png'}).catch(()=>{});
}
else if(ACTION==='state'){
  const page=await getNB(ctx,false);
  if(!page){ console.log('NB page gone'); await browser.close(); process.exit(0); }
  const st=await page.evaluate(()=>({
    title:document.title, monaco:document.querySelectorAll('.monaco-editor').length,
    reconnect:/Подключиться повторно|Reconnect|Сеанс завершен|disconnected/i.test(document.body.innerText),
    running:(document.body.innerText.match(/Выполнение \([^)]*\)|Executing \([^)]*\)/)||[])[0]||'',
    dialogs:Array.from(document.querySelectorAll('[role=dialog],paper-dialog,mwc-dialog')).filter(e=>e.offsetParent!==null).map(e=>e.textContent.replace(/\s+/g,' ').trim().slice(0,140)),
    bodyhead:document.body.innerText.replace(/\s+/g,' ').slice(0,200)
  }));
  console.log(JSON.stringify(st,null,1));
  await page.screenshot({path:'out/state.png'}).catch(()=>{});
}
else if(ACTION==='gpu'){
  const page=await getNB(ctx,true);
  const m=await page.evaluate(()=>{ const e=Array.from(document.querySelectorAll('.menu-button,[role=menuitem],div')).find(x=>x.children.length<=2 && /^Среда выполнения$|^Runtime$/.test(x.textContent.trim())); if(e){e.click();return true;} return false; });
  console.log('runtime menu:',m); await page.waitForTimeout(1200);
  // NOTE: the correct menu item is "Сменить среду выполнения" / "Change runtime type"
  const ch=await page.evaluate(()=>{ const it=Array.from(document.querySelectorAll('.goog-menuitem,[role=menuitem]')).find(e=>/Сменить среду выполнения|Change runtime type/i.test(e.textContent)); if(it){it.click();return it.textContent.trim();} return null; });
  console.log('change-runtime:',ch); await page.waitForTimeout(2000);
  let picked=false;
  try{ await page.getByText(/Графический процессор T4|T4 GPU|\bT4\b/).first().click({timeout:5000}); picked=true; }catch(e){ console.log('T4 pick err',String(e).slice(0,70)); }
  console.log('T4 picked:',picked); await page.waitForTimeout(600);
  // use getByRole button for Save — exact-text "Сохранить" matches a hidden goog-menuitem
  try{ await page.getByRole('button',{name:/Сохранить|Save/}).first().click({timeout:5000}); console.log('Save clicked'); }catch(e){ console.log('save err',String(e).slice(0,70)); }
  await page.waitForTimeout(2500);
  await page.screenshot({path:'out/gpu.png'}).catch(()=>{});
}
else if(ACTION==='cmd'){
  const CMD=process.env.CMD; const WAIT=parseInt(process.env.WAITSEC||'60',10);
  const page=await getNB(ctx,true);
  try{ await page.evaluate(()=>{ Array.from(document.querySelectorAll('paper-toast,[role=alert]')).forEach(t=>{const c=t.querySelector('[aria-label="close"],paper-icon-button,.close'); if(c)c.click();}); }); }catch{}
  let focused=false;
  for(let a=0;a<6 && !focused;a++){ try{ await page.locator('.monaco-editor').first().click({timeout:6000}); focused=true; }catch(e){ await page.waitForTimeout(2000); } }
  if(!focused){ console.log('FOCUS FAILED'); await browser.close(); process.exit(2); }
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await page.waitForTimeout(200);
  await page.keyboard.insertText(CMD); await page.waitForTimeout(400);   // insertText — Monaco mangles multi-line typing with auto-indent; keep the cell to ONE line
  await page.keyboard.press('Control+Enter'); console.log('RAN:',process.env.LABEL||'(cmd fired)');
  for(let i=0;i<5;i++){ const c=await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button,[role=button],paper-button,mwc-button')).find(e=>e.offsetParent!==null&&/Все равно запустить|Всё равно запустить|Run anyway/i.test(e.textContent)); if(b){b.click();return true;} return false;}); if(c){console.log('run-anyway clicked');break;} await page.waitForTimeout(1200); }
  await page.waitForTimeout(WAIT*1000);
  const out=await page.evaluate(()=>{ let best=''; document.querySelectorAll('.cell,.notebook-cell').forEach(c=>{const t=c.innerText||''; if(t.length>best.length)best=t;}); return best.slice(-1800); });
  console.log('----- OUTPUT tail -----\n'+out);
}
else if(ACTION==='poll'){
  const POLLMIN=parseInt(process.env.POLLMIN||'60',10);
  const MARK=process.env.MARK||'ALL DONE';
  const page=await getNB(ctx,false);
  if(!page){ console.log('NB page gone'); await browser.close(); process.exit(1); }
  function readOut(){ return page.evaluate(()=>{ let best=''; document.querySelectorAll('.cell,.notebook-cell').forEach(c=>{const t=c.innerText||''; if(t.includes('install deps')||t.includes('Apollo')||t.includes('RESULT_')){ if(t.length>best.length)best=t; }}); const i=best.indexOf('=== install deps ==='); return (i>=0?best.slice(i):best).replace(/\n{2,}/g,'\n').trim(); }); }
  const iters=Math.ceil(POLLMIN*60/40); let last='';
  for(let i=0;i<iters;i++){
    try{ await page.mouse.move(200+(i%5)*7, 300+(i%3)*5); await page.mouse.move(210,305); }catch{}  // keepalive: real input events, else Colab idle-disconnects
    let out=''; try{ out=await readOut(); }catch(e){ out='(read err '+String(e).slice(0,50)+')'; }
    if(out!==last){ console.log(`\n===== t+${(i*40/60).toFixed(1)}min =====`); console.log(out.slice(-1000)); last=out; } else process.stdout.write('.');
    if(new RegExp(MARK).test(out)){ console.log('\n>>> MARK matched:',MARK); break; }
    if(/Traceback|CUDA out of memory|ModuleNotFoundError|fatal:/i.test(out)){ console.log('\n!!! possible ERROR (still watching)'); }
    await page.waitForTimeout(40000);
  }
  console.log('\n===== FINAL tail =====\n'+(await readOut()).slice(-2000));
}
await browser.close();
console.log('\n[cl.mjs done: '+ACTION+']');
