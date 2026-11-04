// Disposable native clipboard/activation witness; no live profile or app database.
// Node >=22, Chromium headless platform; real client proof, simulated HTTP keeper.
// Native read permission is granted only after writes, to inspect cancellation.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const profile=await mkdtemp(join(tmpdir(),'dojo-copy-witness-'));
let fixture, png, delay=0;
const page=`<!doctype html><button id="copy" style="position:absolute;left:20px;top:20px;width:180px;height:60px">Copy verified link</button>
<script>window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));</script>
<script type="module">
import {liveForkRef} from '/assets/js/link.js';
import {copyText} from '/assets/js/utils/clipboard.js';
import {writeSnap} from '/assets/js/keep/kinds/snap.js';
import {name} from '/assets/js/keep/entry.js';
import {genesisBytes} from '/assets/js/keep/genesis.js';
import {signingHand,keepProof} from '/assets/js/keep/auth.js';
try {
 const hand=await signingHand(); const birth=genesisBytes(a=>a.fill(3),{t:0,n:0},hand.auth);
 const source='goto 5 0\\nlet p';
 const message=writeSnap({root:name(birth),source,choices:{v:1,inputs:[]},ts:{t:1,n:0}});
 const id=name(message), proof=await keepProof(message,birth,hand.privateKey);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
 canvas.getContext('2d').fillRect(0,0,2,2);
 const image=await new Promise(r=>canvas.toBlob(r,'image/png'));
 const binary=new Uint8Array(await image.arrayBuffer());
 const bitmap=await createImageBitmap(image); bitmap.close();
 await fetch('/fixture',{method:'POST',body:JSON.stringify({id,message,source,proof,png:btoa(String.fromCharCode(...binary))})});
 window.readings=[]; window.id=id;
 window.permission=await navigator.permissions.query({name:'clipboard-write'}).then(p=>p.state).catch(()=>null);
 window.current=true;window.mode='baseline';window.caseLabel='';
 document.querySelector('#copy').onclick=async e=>{
  const start=performance.now(), before=navigator.userActivation.isActive, mode=window.mode, label=window.caseLabel;
  let ref=null, after=null, took=false, failure=null;
  const prepare=async()=>{
   ref=await liveForkRef({id});after=navigator.userActivation.isActive;
   if(!ref||!window.current)throw new DOMException('not live or retired','AbortError');
   return location.origin+'/?fork='+encodeURIComponent(ref)+'#'+label;
  };
  try {
   if(mode==='promised'){
    took=await copyText(prepare());
   }else{took=await copyText(await prepare());}
  }catch(error){failure=error.name;}
  window.readings.push({label,mode,trusted:e.isTrusted,secure:isSecureContext,before,after,took,failure,ref,elapsed:Math.round(performance.now()-start),clipboard:!!navigator.clipboard?.writeText,permission:window.permission});
 };
 window.ready=true;
} catch(e) {window.failed=String(e.stack||e);}
</script>`;
const server=createServer(async(req,res)=>{
 try {
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname==='/fixture'&&req.method==='POST'){
   let text='';for await(const b of req)text+=b;
   const f=JSON.parse(text);png=Buffer.from(f.png,'base64');delete f.png;fixture=f;
   res.writeHead(204).end();return;
  }
  if(u.pathname==='/delay'){delay=Number(u.searchParams.get('n'));res.writeHead(204).end();return;}
  if(u.pathname==='/'){res.setHeader('content-type','text/html');res.end(page);return;}
  if(fixture&&u.pathname===`/keeps/${fixture.id}/image`){res.setHeader('content-type','image/png');res.end(png);return;}
  if(fixture&&u.pathname===`/keeps/${fixture.id}`){
   await new Promise(r=>setTimeout(r,delay));res.setHeader('x-dojo-keep-read',u.searchParams.get('read'));
   res.setHeader('cache-control','no-cache');res.setHeader('content-type','application/json');res.end(JSON.stringify(fixture));return;
  }
  if(u.pathname.startsWith('/assets/js/')||u.pathname==='/priv/keep/skeleton.json'){
   const path=resolve(repo,'.'+u.pathname);if(!path.startsWith(repo+'/')){res.writeHead(403).end();return;}
   res.setHeader('content-type',path.endsWith('.json')?'application/json':'application/javascript');res.end(await readFile(path));return;
  }
  res.writeHead(404).end();
 } catch(e){res.writeHead(500).end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const chrome=spawn('chromium',['--headless=new','--ozone-platform=headless','--no-sandbox','--disable-gpu','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{detached:true,stdio:'ignore'});
let launchError=null;
chrome.on('error',error=>{launchError=error;});
let ws;
try {
 let port;
 for(let i=0;i<100;i++){
  if(launchError)throw launchError;
  try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}
  catch{await new Promise(r=>setTimeout(r,50));}
 }
 if(!port)throw Error('fresh Chromium CDP not ready');
 const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
 const target=targets.find(p=>p.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let serial=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++serial;
  const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);
  pending.set(id,{
   resolve:value=>{clearTimeout(timer);resolve(value);},
   reject:error=>{clearTimeout(timer);reject(error);},
  });
  ws.send(JSON.stringify({id,method,params}));
 });
 ws.onclose=()=>{for(const p of pending.values())p.reject(Error('fresh Chromium disconnected'));pending.clear();};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Page.enable');await call('Runtime.enable');await call('Page.navigate',{url:base});
 const ready=await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.failed){clearInterval(t);reject(Error(window.failed))}else if(window.ready){clearInterval(t);resolve(true)}else if(++n>200){clearInterval(t);reject(Error(JSON.stringify(window.errors))) }},50)})`);
 assert.equal(ready,true);
 await call('Page.bringToFront');
 for(const [label,mode,n,cancel] of [
  ['baseline-fast','baseline',0,false],['baseline-slow','baseline',6500,false],
  ['promised-slow','promised',6500,false],['promised-cancelled','promised',6500,true]
 ]){
  await evaluate(`fetch('/delay?n=${n}').then(()=>{window.mode='${mode}';window.caseLabel='${label}';window.current=true;return true})`);
  const count=await evaluate('readings.length');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:80,y:45,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:80,y:45,button:'left',clickCount:1});
  if(cancel)await evaluate('window.current=false');
  const row=await evaluate(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(readings.length>${count}){clearInterval(t);resolve(readings.at(-1))}else if(++n>400){clearInterval(t);reject(Error(JSON.stringify(window.errors))) }},50)})`);
  assert.equal(row.trusted,true);assert.equal(row.ref,'keep:'+fixture.id);
  if(label!=='baseline-slow')assert.equal(row.took,label==='baseline-fast'||label==='promised-slow');
  console.log(JSON.stringify({delay:n,...row}));
 }
 await call('Browser.grantPermissions',{origin:base,permissions:['clipboardReadWrite']});
 const clipboard=await evaluate('navigator.clipboard.readText()');
 assert.ok(clipboard.endsWith('#promised-slow'),'retired payload must not replace the prior valid clipboard');
 console.log(JSON.stringify({readbackAfterTests:true,clipboardUnchangedAfterCancellation:true}));
 const errors=await evaluate('window.errors');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({scope:'native Chromium headless-platform clipboard, loopback HTTP, fresh profile; real client proof and transport; simulated server, no SQLite/Safari/LAN claim',errors}));
} finally {
 if(ws)ws.close();
 try{process.kill(-chrome.pid,'SIGTERM')}catch{}
 await Promise.race([new Promise(r=>chrome.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);
 try{process.kill(-chrome.pid,'SIGKILL')}catch{}
 await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
