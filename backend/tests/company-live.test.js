import {beforeEach,afterEach,it,expect} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/database/db.js';
import {createApp} from '../src/app.js';
import {createClaim} from '../src/services/claims.js';
import {digest,hashPassword} from '../src/utils/security.js';
import {ClaudeVisionAdapter} from '../src/ai/claude.js';
import {claimBrand} from '../src/services/companyAccess.js';
import {migrateCompanyLive} from '../src/database/companyLive.js';
let db,app,folder,users,claims;
const password='Company-Test-Password-2026';
function call(user,method,path,body){const r=request(app)[method](path).set('Cookie',`cs_session=${users[user].token}`).set('X-ClaimShield','1');return body===undefined?r:r.send(body);}
beforeEach(()=>{
 db=openDatabase(':memory:');folder=mkdtempSync(join(tmpdir(),'cs-company-live-'));users={};
 for(const [name,role,brand] of [['owner','customer'],['other','customer'],['samsung','reviewer','samsung'],['boat','reviewer','boat'],['global','reviewer'],['colleague','reviewer','samsung']]){
  const id=randomUUID(),token=randomUUID();db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id,name,`${name}@test.invalid`,hashPassword(password),role);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),id,Date.now()+600000);if(brand)db.prepare('INSERT INTO company_staff VALUES(?,?)').run(id,brand);users[name]={id,token};
 }
 claims={};for(const [name,catalog] of [['samsung','samsung-galaxy-a26-5g'],['boat','boat-rockerz-450'],['draft','samsung-galaxy-a36-5g'],['legacy','samsung-galaxy-a56-5g'],['unknown','samsung-galaxy-a26-5g']])claims[name]=createClaim(db,users.owner.id,{catalog_id:catalog,serial:'UNKNOWN',purchase_date:'UNKNOWN',incident_date:'UNKNOWN',previous_repairs:0,statement:'Isolated company and live-session authorization test.'});
 db.prepare('UPDATE claims SET is_draft=1 WHERE id=?').run(claims.draft);
 db.prepare('UPDATE claims SET catalog_id=NULL WHERE id=?').run(claims.legacy);
 db.prepare("UPDATE claims SET catalog_id=NULL,model='Unidentified phone' WHERE id=?").run(claims.unknown);
 app=createApp({db,uploads:folder,aiAdapter:new ClaudeVisionAdapter({apiKey:'',model:''})});
});
afterEach(async()=>{await app.locals.analysis.waitForIdle();db.close();rmSync(folder,{recursive:true,force:true});});
it('company login is brand-scoped and does not change customer/global auth',async()=>{
 const login=await request(app).post('/api/auth/company/samsung/login').set('X-ClaimShield','1').send({email:'samsung@test.invalid',password});expect(login.status).toBe(200);expect(login.body.user).toMatchObject({role:'company_reviewer',company_brand:'samsung'});
 expect((await request(app).post('/api/auth/company/boat/login').set('X-ClaimShield','1').send({email:'samsung@test.invalid',password})).status).toBe(401);
 expect((await call('samsung','get','/api/auth/me')).body.user.role).toBe('company_reviewer');
 expect((await call('global','get','/api/auth/me')).body.user.role).toBe('reviewer');
});
it('schedules a product-specific request, notifies the customer and requires agreement before scheduled joining',async()=>{
 const path=`/api/claims/${claims.samsung}/appointments`,start=Date.now()+7*60000;
 expect((await call('boat','post',path,{start_at:start,duration_minutes:15,message:'Show the device model label and charging problem.'})).status).toBe(404);
 const sent=await call('samsung','post',path,{start_at:start,duration_minutes:15,message:'Show the device model label and charging problem.'});expect(sent.status).toBe(201);let a=sent.body.appointment;
 expect((await call('owner','get','/api/live-invitations')).body.appointments.some(x=>x.id===a.id)).toBe(true);
 expect((await call('other','get','/api/live-invitations')).body.appointments).toEqual([]);
 expect((await call('samsung','post',`/api/claims/${claims.samsung}/live`,{appointment_id:a.id})).status).toBe(409);
 expect((await call('samsung','post',`${path}/${a.id}/respond`,{action:'ACCEPT',version:a.version})).status).toBe(409);
 let accepted=await call('owner','post',`${path}/${a.id}/respond`,{action:'ACCEPT',version:a.version});expect(accepted.status).toBe(200);a=accepted.body.appointment;expect(a.status).toBe('ACCEPTED');
 expect((await call('owner','post',`${path}/${a.id}/respond`,{action:'DECLINE',version:1,note:'No longer available'})).status).toBe(409);
 expect((await call('colleague','post',`/api/claims/${claims.samsung}/live`,{appointment_id:a.id})).status).toBe(403);
 const room=await call('samsung','post',`/api/claims/${claims.samsung}/live`,{appointment_id:a.id});expect(room.status).toBe(201);
 expect((await call('owner','post',`/api/claims/${claims.samsung}/live/${room.body.session.id}/join`,{})).status).toBe(200);
 expect((await call('owner','post',`${path}/${a.id}/respond`,{action:'CANCEL',version:a.version,note:'Cannot attend this slot now.'})).status).toBe(200);
 expect(db.prepare('SELECT status FROM live_sessions WHERE id=?').get(room.body.session.id).status).toBe('ENDED');
});
it('supports alternative times, decline, validation and future-slot enforcement',async()=>{
 const path=`/api/claims/${claims.samsung}/appointments`,body={start_at:Date.now()+3600000,duration_minutes:30,message:'Show the actual model label, invoice and reported issue.'};
 expect((await call('samsung','post',path,{...body,start_at:Date.now()-10000})).status).toBe(400);
 let a=(await call('samsung','post',path,body)).body.appointment;
 expect((await call('samsung','post',path,body)).status).toBe(409);
 const alternate=Date.now()+7200000;
 a=(await call('owner','post',`${path}/${a.id}/respond`,{action:'SUGGEST_TIME',version:a.version,alternative_at:alternate,note:'I am available later instead.'})).body.appointment;expect(a.status).toBe('ALTERNATIVE');
 a=(await call('samsung','post',`${path}/${a.id}/respond`,{action:'ACCEPT_ALTERNATIVE',version:a.version})).body.appointment;expect(a.start_at).toBe(alternate);expect(a.status).toBe('ACCEPTED');
 expect((await call('samsung','post',`/api/claims/${claims.samsung}/live`,{appointment_id:a.id})).status).toBe(409);
 await call('samsung','post',`${path}/${a.id}/respond`,{action:'CANCEL',version:a.version,note:'We will arrange another slot.'});
 a=(await call('samsung','post',path,body)).body.appointment;
 expect((await call('owner','post',`${path}/${a.id}/respond`,{action:'DECLINE',version:a.version,note:'Not feasible this week.'})).body.appointment.status).toBe('DECLINED');
 expect((await call('owner','get','/api/live-invitations')).body.appointments).toEqual([]);
});
it.each([['samsung','samsung-galaxy-a26-5g','boat'],['boat','boat-rockerz-450','samsung']])('routes a newly submitted %s complaint to its company for manual approval',async(brand,catalog,other)=>{
 const submitted=await call('owner','post','/api/claims',{catalog_id:catalog,serial:'UNKNOWN',purchase_date:'UNKNOWN',incident_date:'UNKNOWN',previous_repairs:0,statement:'New complaint submitted for the manual company workflow acceptance test.'});
 expect(submitted.status).toBe(201);const id=submitted.body.id;
 const list=await call(brand,'get',`/api/company/${brand}/claims`);expect(list.body.claims.find(c=>c.id===id)).toMatchObject({status:'SUBMITTED',customer_name:'owner'});
 expect((await call(other,'get',`/api/company/${other}/claims`)).body.claims.some(c=>c.id===id)).toBe(false);
 const detail=await call(brand,'get',`/api/claims/${id}`);expect(detail.body.customer.name).toBe('owner');expect(detail.body.claim.statement).toContain('New complaint');expect(detail.body.claim.status).toBe('SUBMITTED');
 expect((await call('owner','patch',`/api/reviewer/claims/${id}`,{status:'APPROVED',reason:'A customer cannot approve this claim.'})).status).toBe(403);
 const reason='ISOLATED TEST: company manually reviewed the submitted information.';
 expect((await call(brand,'patch',`/api/reviewer/claims/${id}`,{status:'APPROVED',reason})).status).toBe(200);
 const result=await call('owner','get',`/api/claims/${id}`);expect(result.body.claim.status).toBe('APPROVED');expect(result.body.customer_summary).toMatchObject({approved:true,final:true,reason});expect(result.body.decision_history.at(-1).reason).toBe(reason);
});
it('company queues include all submitted statuses and determinable legacy only',async()=>{
 db.prepare("UPDATE claims SET status='REJECTED',synthetic=1 WHERE id=?").run(claims.samsung);
 const r=await call('samsung','get','/api/company/samsung/claims');expect(r.status).toBe(200);expect(r.body.claims.map(c=>c.id).sort()).toEqual([claims.samsung,claims.legacy].sort());expect(r.body.claims.find(c=>c.id===claims.samsung).synthetic).toBe(1);
 expect((await call('samsung','get','/api/company/samsung/claims?status=REJECTED&search=owner')).body.claims).toHaveLength(1);
 expect((await call('global','get','/api/reviewer/claims')).body.claims.map(c=>c.id)).toContain(claims.unknown);
 expect(claimBrand({catalog_id:'unsupported',model:'Galaxy A26 5G'})).toBeNull();
});
it.each([['samsung','boat'],['boat','samsung']])('blocks %s from %s portal, detail, download, decision and live resources',async(a,b)=>{
 expect((await call(a,'get',`/api/company/${b}/claims`)).status).toBe(403);
 for(const path of [`/api/claims/${claims[b]}`,`/api/claims/${claims[b]}/evidence/${randomUUID()}`,`/api/claims/${claims[b]}/live`,`/api/claims/${claims[b]}/ledger`])expect((await call(a,'get',path)).status).toBe(404);
 expect((await call(a,'patch',`/api/reviewer/claims/${claims[b]}`,{status:'APPROVED',reason:'Cross-brand decision must be blocked.'})).status).toBe(404);
 expect((await call(a,'post',`/api/claims/${claims[b]}/live`,{})).status).toBe(404);
 expect((await call(a,'get','/api/reviewer/claims')).status).toBe(403);
});
it('private drafts are owner-only for staff, global reviewer and other customers',async()=>{
 for(const who of ['samsung','global','other'])expect((await call(who,'get',`/api/claims/${claims.draft}`)).status).toBe(404);
 expect((await call('owner','get',`/api/claims/${claims.draft}`)).status).toBe(200);
 expect((await call('owner','post',`/api/claims/${claims.draft}/live`,{})).status).toBe(403);
});
it('decision reasons are required, customer-visible, transactional and terminal',async()=>{
 const path=`/api/reviewer/claims/${claims.samsung}`;
 expect((await call('samsung','patch',path,{status:'APPROVED',reason:''})).status).toBe(400);
 const reason='Please upload a clearer photo of the model label.';
 expect((await call('samsung','patch',path,{status:'NEEDS_EVIDENCE',reason})).status).toBe(200);
 const c=await call('owner','get',`/api/claims/${claims.samsung}`);expect(c.body.decision_history[0]).toMatchObject({reason,status:'NEEDS_EVIDENCE',actor_name:'samsung'});expect(c.body.customer_summary.reason).toBeTruthy();
 expect(db.prepare('SELECT actor_id FROM claim_status_changes WHERE claim_id=?').get(claims.samsung).actor_id).toBe(users.samsung.id);
 migrateCompanyLive(db);migrateCompanyLive(db);expect(db.prepare('SELECT COUNT(*) n FROM claim_status_changes').get().n).toBe(1);
 expect((await call('samsung','patch',path,{status:'REJECTED',reason:'Reviewed supporting evidence and declined this test claim.'})).status).toBe(200);
 expect((await call('samsung','patch',path,{status:'UNDER_REVIEW',reason:'Cannot reopen a terminal claim.'})).status).toBe(409);
});
it('legacy recorded reasons backfill idempotently without inventing missing reasons',async()=>{
 db.prepare('INSERT INTO audit_events(id,claim_id,actor_id,action,detail) VALUES(?,?,?,?,?)').run(randomUUID(),claims.legacy,users.global.id,'REVIEWER_DECISION','UNDER_REVIEW: Historical reviewer reason.');migrateCompanyLive(db);migrateCompanyLive(db);
 expect((await call('samsung','get',`/api/claims/${claims.legacy}`)).body.decision_history[0].reason).toBe('Historical reviewer reason.');expect((await call('owner','get',`/api/claims/${claims.unknown}`)).body.decision_history).toEqual([]);
});
it('keeps internal notes and private cross-customer links out of company/customer views',async()=>{
 db.prepare('INSERT INTO reviewer_notes(id,claim_id,actor_id,note) VALUES(?,?,?,?)').run(randomUUID(),claims.samsung,users.global.id,'INTERNAL SECRET NOTE');
 db.prepare('INSERT INTO audit_events(id,claim_id,actor_id,action,detail) VALUES(?,?,?,?,?)').run(randomUUID(),claims.samsung,users.global.id,'REVIEWER_NOTE','INTERNAL SECRET NOTE');
 for(const who of ['samsung','owner']){
  const detail=await call(who,'get',`/api/claims/${claims.samsung}`);expect(JSON.stringify(detail.body)).not.toContain('INTERNAL SECRET NOTE');
  const ledger=await call(who,'get',`/api/claims/${claims.samsung}/ledger`);expect(ledger.body.notes).toBeUndefined();expect(ledger.body.investigation.privateLinks).toBeUndefined();
 }
});
it('live signaling permits only owner and requesting assigned-brand reviewer',async()=>{
 const base=`/api/claims/${claims.samsung}/live`;const requested=await call('samsung','post',base,{});expect(requested.status).toBe(201);const id=requested.body.session.id;
 expect((await call('owner','post',base,{})).status).toBe(403);
 for(const who of ['other','boat','global','colleague'])expect((await call(who,'post',`${base}/${id}/join`,{})).status).toBe(404);
 for(const who of ['owner','samsung'])expect((await call(who,'post',`${base}/${id}/join`,{})).status).toBe(200);
 expect((await call('samsung','post',`${base}/${id}/signals`,{type:'offer',sdp:'not allowed'})).status).toBe(403);
 expect((await call('owner','post',`${base}/${id}/signals`,{type:'offer',sdp:'test offer'})).status).toBe(200);
 expect((await call('owner','post',`${base}/${id}/signals`,{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'})).status).toBe(400);
 const signals=await call('samsung','get',`${base}/${id}/signals?after=0`);expect(signals.body.signals[0]).toMatchObject({type:'offer',sdp:'test offer'});
 expect((await call('owner','get',`${base}/${id}/signals?after=0`)).body.signals).toEqual([]);
 expect((await call('samsung','post',`${base}/${id}/end`,{})).status).toBe(200);expect((await call('owner','get',`${base}/${id}/signals`)).body.session.status).toBe('ENDED');expect(db.prepare('SELECT COUNT(*) n FROM live_signals').get().n).toBe(0);
 expect((await call('owner','post',`${base}/${id}/signals`,{type:'connected'})).status).toBe(409);
});
it('unused sessions expire and finalized claims cannot start or retain live sessions',async()=>{
 const base=`/api/claims/${claims.samsung}/live`;let r=await call('samsung','post',base,{});db.prepare('UPDATE live_sessions SET expires_at=0 WHERE id=?').run(r.body.session.id);
 expect((await call('owner','post',`${base}/${r.body.session.id}/join`,{})).status).toBe(409);
 r=await call('samsung','post',base,{});await call('samsung','patch',`/api/reviewer/claims/${claims.samsung}`,{status:'APPROVED',reason:'Reviewer confirmed this isolated test claim.'});
 expect((await call('owner','get',base)).body.session.status).toBe('ENDED');expect((await call('samsung','post',base,{})).status).toBe(409);
});
it('saving live frames adds private evidence and preserves current device photo',async()=>{
 const claim=claims.samsung,base=`/api/claims/${claim}/live`,bytes=readFileSync(new URL('../../datasets/six-product-v1/data/images/commons/mug.jpg',import.meta.url));
 const upload=(kind,id)=>{let r=call('owner','post',`/api/claims/${claim}/evidence`).field('kind',kind);if(id)r=r.field('live_session_id',id);return r.attach('file',bytes,{filename:'frame.jpg',contentType:'image/jpeg'});};
 const photo=await upload('photo');expect(photo.status).toBe(201);
 expect((await upload('live_snapshot')).status).toBe(403);
 const requested=await call('samsung','post',base,{}),id=requested.body.session.id;await call('owner','post',`${base}/${id}/join`,{});
 const frame=await upload('live_snapshot',id);expect(frame.status).toBe(201);
 expect(db.prepare('SELECT active FROM evidence WHERE id=?').get(photo.body.id).active).toBe(1);expect(db.prepare('SELECT kind,live_session_id FROM evidence WHERE id=?').get(frame.body.id)).toMatchObject({kind:'live_snapshot',live_session_id:id});
 expect((await call('boat','get',`/api/claims/${claim}/evidence/${frame.body.id}`)).status).toBe(404);
 expect((await call('samsung','get',`/api/claims/${claim}/evidence/${frame.body.id}`)).status).toBe(200);
 await call('owner','post',`${base}/${id}/end`,{});expect((await upload('live_snapshot',id)).status).toBe(403);
});
