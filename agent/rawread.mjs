// Raw-CDP read of the Colab page (bypasses Playwright's all-target attach, which
// HANGS when a stray accounts.google.com sign-in tab is open). Use this to check
// progress / detect a zombie kernel without connectOverCDP timing out.
//   PORT=9333 node rawread.mjs
import 'isomorphic-ws';  // remove if your Node has global WebSocket (Node 21+)
const PORT=process.env.PORT||'9333';
const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
const colab=list.find(t=>t.type==='page'&&/colab\.research\.google\.com\/drive/.test(t.url));
const signin=list.filter(t=>t.type==='page'&&/accounts\.google\.com/.test(t.url));
console.log('colab target:',colab?colab.id:'(none)','| busyFavicon:',colab?/busy/.test(colab.faviconUrl||''):'-');
console.log('signin tabs:',signin.length,'(close them if connectOverCDP hangs)');
if(!colab){ console.log('NO COLAB PAGE'); process.exit(1); }
const ws=new WebSocket(colab.webSocketDebuggerUrl);
const expr=`(function(){
  let f=''; document.querySelectorAll('.cell').forEach(c=>{const t=c.innerText||''; if(t.includes('install deps')||t.includes('RESULT_')||t.includes('Apollo')){ if(t.length>f.length)f=t; }});
  const exec=(document.body.innerText.match(/\\u0412\\u044b\\u043f\\u043e\\u043b\\u043d\\u0435\\u043d\\u0438\\u0435 \\([^)]*\\)|Executing \\([^)]*\\)/)||[])[0]||'';
  const signin=/accounts\\.google\\.com/.test(location.href);
  return JSON.stringify({exec, signin, url:location.href.slice(0,60), tail:f.slice(-900)});
})()`;
const res=await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(new Error('timeout')),25000);
  ws.onopen=()=>{ ws.send(JSON.stringify({id:1,method:'Runtime.enable'})); ws.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:expr,returnByValue:true}})); };
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id===2){ clearTimeout(t); resolve(m); } };
  ws.onerror=e=>{ clearTimeout(t); reject(new Error('ws '+(e.message||''))); };
});
ws.close();
if(res.error){ console.log('eval error:',JSON.stringify(res.error).slice(0,200)); process.exit(1); }
const d=JSON.parse(res.result.result.value);
console.log('EXEC:',d.exec||'(none — idle OR zombie if it WAS running)','| SIGNIN:',d.signin);
console.log('--- TAIL ---\n'+d.tail);
// ZOMBIE check: if EXEC shows a running timer but two reads ~90s apart are IDENTICAL
// (tail unchanged, timer frozen), the kernel is dead — restart the runtime.
