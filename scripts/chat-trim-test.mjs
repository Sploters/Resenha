// Corte do chat em canal movimentado (app.js trimChat): com a pessoa no fim, passando de 250 mensagens ficam as 150 mais
// novas; rolar até o topo traz as antigas de novo, em ordem e sem duplicar. Banco do scripts/load/seed.mjs.
// Uso: DATA_DIR=./.testdata-churn node scripts/load/seed.mjs 300 && node scripts/chat-trim-test.mjs
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT=3297,BASE=`http://localhost:${PORT}`,D='./.testdata-churn',sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); let fails=0; const ok=(c,m,x)=>{console.log((c?'  ok   ':'  FAIL ')+m+(x!==undefined?'  '+JSON.stringify(x):''));if(!c)fails++;};
const srv=spawn('node',['server/index.js'],{env:{...process.env,PORT,HTTPS:'0',DATA_DIR:D,RTC:'0'},stdio:'ignore'}); for(let i=0;i<150;i++){try{await fetch(BASE+'/api/server-info');break}catch{await sleep(200)}}
const call=(tok,m,p,b)=>fetch(BASE+'/api'+p,{method:m,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:b?JSON.stringify(b):undefined}).then(r=>r.json());
const reg=async(n)=>{const r=await call('','POST','/register',{username:n,password:'senha123'});await call(r.token,'PATCH','/me',{});return r.token};
const meta=JSON.parse(fs.readFileSync(D+'/load.json','utf8')); const a='load-0', g={id:meta.guild}; const bs=Array.from({length:30},(_,i)=>'load-'+(i+1));
const br=await puppeteer.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',headless:'new',args:['--no-sandbox']}); const p=await br.newPage(); await p.setViewport({width:1440,height:900});
await p.evaluateOnNewDocument(t=>{localStorage.lc_token=t},a); await p.goto(BASE); await p.waitForSelector('#rail .rail-wrap');
const ch=meta.channels[7]; await p.evaluate((g,c)=>window.__lc.go(g,c),g.id,ch); await sleep(1500);
let rej=0; for(let i=0;i<300;i++){ const r=await call(bs[i%30],'POST',`/channels/${ch}/messages`,{content:'msg '+i}); if(!r.id){rej++; if(rej<3) console.log('rejeitada',i,JSON.stringify(r));} await sleep(25); } console.log('rejeitadas',rej, 'S.messages', await p.evaluate(c=>window.__lc.S.messages.get(c)?.length,ch));
await sleep(2500);
const st=()=>p.evaluate(()=>{const els=[...document.querySelectorAll('#msgs > .msg')];return {n:els.length, first:els[0]?.textContent.match(/msg \d+/)?.[0], last:els.at(-1)?.textContent.match(/msg \d+/)?.[0], ids:els.map(e=>e.dataset.mid)}});
let s=await st(); ok(s.n<=250 && s.last==='msg 299','chat limitado com a pessoa no fim', {n:s.n,first:s.first,last:s.last});
// rolar até o topo várias vezes: as antigas voltam, na ordem, sem duplicar
for(let k=0;k<30;k++){ await p.evaluate(()=>{const m=document.querySelector('#msgs'); m.scrollTop=0; m.dispatchEvent(new Event('scroll'));}); await sleep(700); }
s=await st(); const nums=(await p.evaluate(()=>[...document.querySelectorAll('#msgs > .msg')].map(e=>+(e.textContent.match(/msg (\d+)/)||[])[1]).filter(x=>!isNaN(x))));
ok(s.n>400 && s.last==='msg 299' && (await p.evaluate(()=>document.body.innerText.includes('msg 0'))),'rolando para cima as antigas voltam (até a msg 0 e além)',{n:s.n,first:s.first,last:s.last});
const mine=nums.filter((x,i)=>true); ok(new Set(s.ids).size===s.ids.length && s.ids.every((x,i)=>!i||BigInt(x)>BigInt(s.ids[i-1])),'sem duplicadas e na ordem',{n:s.ids.length});
await br.close(); srv.kill(); console.log(fails?fails+' falha(s)':'tudo certo'); process.exit(fails?1:0);
