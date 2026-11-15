import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../utils/security.js';
import { audit } from './investigation.js';
import { claimBrand } from './companyAccess.js';
import rateLimit from 'express-rate-limit';
export function mountLiveRoutes(app,{db,auth,owned}) {
 app.use('/api/claims/:id/live',auth,rateLimit({windowMs:60000,limit:300,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false}));
 const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
 const closed=c=>c.is_draft || ['APPROVED','REJECTED'].includes(c.status);
 const expire=()=>db.transaction(()=>{
   db.prepare("UPDATE live_sessions SET status='ENDED',ended_at=CURRENT_TIMESTAMP WHERE status!='ENDED' AND (expires_at<=? OR claim_id IN (SELECT id FROM claims WHERE is_draft=1 OR status IN ('APPROVED','REJECTED')))").run(Date.now());
   db.prepare("DELETE FROM live_signals WHERE session_id IN (SELECT id FROM live_sessions WHERE status='ENDED')").run();
 })();
 const read=(req)=>{
  expire();const claim=owned(req);
  if(claim.is_draft)throw new HttpError(409,'DRAFT_CLAIM','Submit the claim first.');
  const session=db.prepare('SELECT * FROM live_sessions WHERE id=? AND claim_id=?').get(req.params.sessionId,claim.id);
  if(!session || ![claim.user_id,session.requested_by].includes(req.user.id) || (req.user.id!==claim.user_id && req.user.role!=='company_reviewer'))throw new HttpError(404,'NOT_FOUND','Live session not found.');
  return {claim,session};
 };
 const active=s=>{if(s.status==='ENDED')throw new HttpError(409,'LIVE_ENDED','This live session ended or expired.');};
 const safe=s=>s ? {...s,advisory:true}:null;
 const agreed=(id,claimId)=>{
  if(!id)return;
  const a=db.prepare("SELECT * FROM live_appointments WHERE id=? AND claim_id=? AND status='ACCEPTED'").get(id,claimId);
  if(!a)throw new HttpError(409,'AGREEMENT_REQUIRED','The customer must accept the appointment first.');
  const now=Date.now();if(now<a.start_at-10*60000 || now>a.start_at+a.duration_minutes*60000+15*60000)throw new HttpError(409,'OUTSIDE_SLOT','Join from 10 minutes before the agreed time until 15 minutes after the appointment ends.');
 };
 app.get('/api/claims/:id/live',auth,wrap((req,res)=>{
  expire();const c=owned(req);
  if(c.is_draft)throw new HttpError(409,'DRAFT_CLAIM','Submit the claim first.');
  const session=db.prepare('SELECT * FROM live_sessions WHERE claim_id=? ORDER BY rowid DESC LIMIT 1').get(c.id);
  const allowed=session && [c.user_id,session.requested_by].includes(req.user.id);
  res.json({session:allowed?safe(session):null,can_request:!closed(c) && req.user.role==='company_reviewer',iceServers:JSON.parse(process.env.WEBRTC_ICE_SERVERS || '[]')});
 }));
 app.post('/api/claims/:id/live',auth,wrap((req,res)=>{
  expire();const c=owned(req);const body=z.object({appointment_id:z.string().uuid().optional()}).strict().parse(req.body || {});
  if(req.user.role!=='company_reviewer' || claimBrand(c)!==req.user.company_brand)throw new HttpError(403,'FORBIDDEN','Assigned-brand company reviewer required.');
  if(closed(c))throw new HttpError(409,'CLAIM_CLOSED','Only open submitted claims accept live requests.');
  agreed(body.appointment_id,c.id);
  if(body.appointment_id && db.prepare('SELECT reviewer_id FROM live_appointments WHERE id=?').get(body.appointment_id)?.reviewer_id!==req.user.id)throw new HttpError(403,'FORBIDDEN','Only the requesting reviewer can start this appointment.');
  const session=db.transaction(()=>{
   const old=db.prepare("SELECT * FROM live_sessions WHERE claim_id=? AND status!='ENDED'").get(c.id);
   if(old){if(old.requested_by!==req.user.id)throw new HttpError(409,'LIVE_BUSY','Another company reviewer has an active request.');return old;}
   const id=randomUUID();db.prepare('INSERT INTO live_sessions(id,claim_id,requested_by,expires_at,appointment_id) VALUES(?,?,?,?,?)').run(id,c.id,req.user.id,Date.now()+10*60000,body.appointment_id || null);
   audit(db,c.id,req.user.id,'LIVE_REQUESTED','Company reviewer requested an optional live device check. No recording.');
   return db.prepare('SELECT * FROM live_sessions WHERE id=?').get(id);
  }).immediate();res.status(201).json({session:safe(session)});
 }));
 app.post('/api/claims/:id/live/:sessionId/join',auth,wrap((req,res)=>{
  const {claim,session}=read(req);active(session);z.object({}).strict().parse(req.body || {});
  agreed(session.appointment_id,claim.id);
  const owner=req.user.id===claim.user_id;
  if(!owner && req.user.role!=='company_reviewer')throw new HttpError(403,'FORBIDDEN','Company reviewer required.');
  const both=owner ? session.reviewer_joined : session.owner_joined;
  db.prepare(`UPDATE live_sessions SET ${owner?'owner_joined':'reviewer_joined'}=1,status='CONNECTING',expires_at=? WHERE id=?`).run(both ? Date.now()+30*60000 : session.expires_at,session.id);
  res.json({session:safe(db.prepare('SELECT * FROM live_sessions WHERE id=?').get(session.id))});
 }));
 const signal=z.discriminatedUnion('type',[
  z.object({type:z.literal('offer'),sdp:z.string().min(1).max(100000)}).strict(),
  z.object({type:z.literal('answer'),sdp:z.string().min(1).max(100000)}).strict(),
  z.object({type:z.literal('ice'),candidate:z.object({candidate:z.string().max(5000),sdpMid:z.string().nullable().optional(),sdpMLineIndex:z.number().int().nullable().optional(),usernameFragment:z.string().optional().nullable()}).strict()}).strict(),
  z.object({type:z.enum(['connected','disconnected'])}).strict(),
 ]);
 app.post('/api/claims/:id/live/:sessionId/signals',auth,wrap((req,res)=>{
  const {claim,session}=read(req);active(session);const body=signal.parse(req.body);
  if(['offer','answer'].includes(body.type) && /^m=audio\s/im.test(body.sdp))throw new HttpError(400,'VIDEO_ONLY','Microphone/audio signaling is not supported.');
  const owner=req.user.id===claim.user_id;
  if(!(owner?session.owner_joined:session.reviewer_joined))throw new HttpError(409,'NOT_JOINED','Join the session first.');
  if((body.type==='offer' && !owner)||(body.type==='answer' && owner))throw new HttpError(403,'SIGNAL_DIRECTION','Only customer video is supported.');
  if(db.prepare('SELECT COUNT(*) n FROM live_signals WHERE session_id=?').get(session.id).n>=1000)throw new HttpError(429,'SIGNAL_LIMIT','End this session and start a new request.');
  db.prepare('INSERT INTO live_signals(session_id,actor_id,payload,created_at) VALUES(?,?,?,?)').run(session.id,req.user.id,JSON.stringify(body),Date.now());
  if(['connected','disconnected'].includes(body.type))db.prepare('UPDATE live_sessions SET status=? WHERE id=?').run(body.type.toUpperCase(),session.id);
  res.json({ok:true});
 }));
 app.get('/api/claims/:id/live/:sessionId/signals',auth,wrap((req,res)=>{
  const {session}=read(req);const after=z.coerce.number().int().nonnegative().parse(req.query.after || 0);
  const rows=session.status==='ENDED'?[]:db.prepare('SELECT id,payload FROM live_signals WHERE session_id=? AND actor_id!=? AND id>? ORDER BY id LIMIT 100').all(session.id,req.user.id,after);
  res.set('Cache-Control','no-store').json({session:safe(session),signals:rows.map(r=>({id:r.id,...JSON.parse(r.payload)}))});
 }));
 app.post('/api/claims/:id/live/:sessionId/end',auth,wrap((req,res)=>{
  const {claim,session}=read(req);z.object({}).strict().parse(req.body || {});
  db.transaction(()=>{
   if(session.status!=='ENDED')audit(db,claim.id,req.user.id,'LIVE_ENDED','Live check ended. Video was not recorded; any explicitly saved frames remain as evidence.');
   db.prepare("UPDATE live_sessions SET status='ENDED',ended_at=COALESCE(ended_at,CURRENT_TIMESTAMP),expires_at=? WHERE id=?").run(Date.now(),session.id);
   db.prepare('DELETE FROM live_signals WHERE session_id=?').run(session.id);
  })();res.json({ok:true});
 }));
}
