// Isolated local acceptance environment. Never opens the production database.
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import express from 'express';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database/db.js';
import {createApp} from '../src/app.js';
import {createClaim} from '../src/services/claims.js';
import {hashPassword} from '../src/utils/security.js';
import {ClaudeVisionAdapter} from '../src/ai/claude.js';
const folder=mkdtempSync(join(tmpdir(),'claimshield-live-qa-')),path=join(folder,'qa.sqlite');
const db=openDatabase(path),password=process.env.LIVE_QA_PASSWORD;
if(!password || password.length<12)throw new Error('Set LIVE_QA_PASSWORD (12+ chars) for disposable test accounts.');
const accounts={};
for(const [name,role,brand] of [['customer','customer'],['samsung','reviewer','samsung'],['boat','reviewer','boat']]) {
 const id=randomUUID();accounts[name]=id;db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id,`TEST ONLY ${name}`,`${name}@live-qa.invalid`,hashPassword(password),role);if(brand)db.prepare('INSERT INTO company_staff VALUES(?,?)').run(id,brand);
}
const claim=createClaim(db,accounts.customer,{catalog_id:'samsung-galaxy-a26-5g',serial:'UNKNOWN',purchase_date:'UNKNOWN',incident_date:'UNKNOWN',previous_repairs:0,statement:'ISOLATED LIVE QA CLAIM. Not a real warranty request.'});
writeFileSync(join(folder,'run.json'),JSON.stringify({claim,folder},null,2));
const servers=[];
for(const [port,host] of [[Number(process.env.LIVE_QA_CUSTOMER_PORT || 3101),process.env.LIVE_QA_CUSTOMER_HOST || '127.0.0.1'],[Number(process.env.LIVE_QA_COMPANY_PORT || 3102),process.env.LIVE_QA_COMPANY_HOST || 'localhost']]) {
 const connection=openDatabase(path);
 const app=createApp({db:connection,uploads:folder,origin:`http://${host}:${port}`,aiAdapter:new ClaudeVisionAdapter({apiKey:'',model:''})});
 const outer=express();
 if(process.env.LIVE_QA_SYNTHETIC_CAMERA==='1')outer.get(/^(?!\/api\/|\/assets\/).*/, (req,res)=>{
   const injection=`<script>
   // TEST SERVER ONLY: explicit Start camera uses a labeled synthetic canvas video.
   const fixture=document.createElement('canvas');fixture.width=640;fixture.height=480;
   const context=fixture.getContext('2d');let counter=0;
   setInterval(()=>{context.fillStyle='#132541';context.fillRect(0,0,640,480);context.fillStyle='#fff';context.font='28px sans-serif';context.fillText('SYNTHETIC QA VIDEO',50,100);context.font='20px sans-serif';context.fillText('Not a real device or warranty claim',50,150);context.fillText('Frame '+counter++,50,210);context.fillStyle='#3479ff';context.fillRect(50+(counter%300),280,80,80);},200);
   const devices={getUserMedia:async()=>{if(location.search.includes('cameraDenied=1'))throw new DOMException('Synthetic permission denial','NotAllowedError');return fixture.captureStream(5);},enumerateDevices:async()=>[{kind:'videoinput',deviceId:'synthetic-test-only'}]};
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:devices});
   </script>`;
   const html=readFileSync(new URL('../../frontend/dist/index.html',import.meta.url),'utf8');res.type('html').send(html.replace('<head>','<head>'+injection));
 });
 outer.use(app);
 servers.push(outer.listen(port,'127.0.0.1',()=>console.log(`QA ready http://${host}:${port} · claim ${claim}${process.env.LIVE_QA_SYNTHETIC_CAMERA==='1'?' · SYNTHETIC VIDEO FIXTURE':''}`)));
}
process.on('SIGINT',()=>{servers.forEach(s=>s.close());db.close();process.exit(0);});
