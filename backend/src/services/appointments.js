import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {HttpError} from '../utils/security.js';
import {audit} from './investigation.js';
import {canReadClaim,claimBrand} from './companyAccess.js';
import rateLimit from 'express-rate-limit';
const terminal=['DECLINED','CANCELLED','EXPIRED','COMPLETED'];
export function mountAppointmentRoutes(app,{db,auth,owned}){
 const limit=rateLimit({windowMs:60000,limit:120,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false});
 app.use('/api/claims/:id/appointments',auth,limit);app.use('/api/live-invitations',auth,limit);
 const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
 const expire=()=>db.prepare("UPDATE live_appointments SET status=CASE WHEN claim_id IN (SELECT id FROM claims WHERE status IN ('APPROVED','REJECTED')) THEN 'CANCELLED' ELSE 'EXPIRED' END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE status IN ('PROPOSED','ACCEPTED','ALTERNATIVE') AND (COALESCE(alternative_at,start_at)+duration_minutes*60000+900000<? OR claim_id IN (SELECT id FROM claims WHERE status IN ('APPROVED','REJECTED')))").run(Date.now());
 const rows=id=>db.prepare('SELECT a.*,u.name reviewer_name FROM live_appointments a JOIN users u ON u.id=a.reviewer_id WHERE claim_id=? ORDER BY a.rowid DESC').all(id);
 const future=value=>{if(value<Date.now()+5*60000||value>Date.now()+90*86400000)throw new HttpError(400,'INVALID_TIME','Choose a time at least 5 minutes ahead and within 90 days.');return value;};
 const open=c=>{if(c.is_draft||['APPROVED','REJECTED'].includes(c.status))throw new HttpError(409,'CLAIM_CLOSED','Only open submitted claims accept appointments.');};
 app.get('/api/live-invitations',auth,wrap((req,res)=>{
  expire();const appointments=db.prepare("SELECT a.*,u.name reviewer_name,c.model,c.user_id,c.catalog_id,c.is_draft,c.status claim_status FROM live_appointments a JOIN claims c ON c.id=a.claim_id JOIN users u ON u.id=a.reviewer_id WHERE a.status IN ('PROPOSED','ACCEPTED','ALTERNATIVE') ORDER BY a.start_at").all().filter(a=>canReadClaim(req.user,{id:a.claim_id,user_id:a.user_id,catalog_id:a.catalog_id,model:a.model,is_draft:a.is_draft}) && (req.user.role==='customer'||a.reviewer_id===req.user.id));
  res.json({appointments:appointments.map(({user_id,catalog_id,is_draft,...a})=>a)});
 }));
 app.get('/api/claims/:id/appointments',auth,wrap((req,res)=>{expire();const c=owned(req);if(c.is_draft)throw new HttpError(409,'DRAFT_CLAIM','Submit the claim first.');res.json({appointments:rows(c.id)});}));
 app.post('/api/claims/:id/appointments',auth,wrap((req,res)=>{
  expire();const c=owned(req);open(c);if(req.user.role!=='company_reviewer'||claimBrand(c)!==req.user.company_brand)throw new HttpError(403,'FORBIDDEN','Assigned company reviewer required.');
  const b=z.object({start_at:z.number().int(),duration_minutes:z.union([z.literal(15),z.literal(30)]),message:z.string().trim().min(15).max(1500)}).strict().parse(req.body);future(b.start_at);
  const id=db.transaction(()=>{if(db.prepare("SELECT 1 FROM live_appointments WHERE claim_id=? AND status IN ('PROPOSED','ACCEPTED','ALTERNATIVE')").get(c.id))throw new HttpError(409,'INVITATION_EXISTS','Respond to or cancel the existing request first.');const id=randomUUID();db.prepare('INSERT INTO live_appointments(id,claim_id,reviewer_id,start_at,duration_minutes,message) VALUES(?,?,?,?,?,?)').run(id,c.id,req.user.id,b.start_at,b.duration_minutes,b.message);audit(db,c.id,req.user.id,'LIVE_INVITATION',`Company proposed a ${b.duration_minutes}-minute live device check at ${new Date(b.start_at).toISOString()}. Customer confirmation is required.`);return id;}).immediate();res.status(201).json({appointment:rows(c.id).find(a=>a.id===id)});
 }));
 app.post('/api/claims/:id/appointments/:appointmentId/respond',auth,wrap((req,res)=>{
  expire();const c=owned(req);open(c);
  const b=z.object({action:z.enum(['ACCEPT','DECLINE','SUGGEST_TIME','ACCEPT_ALTERNATIVE','CANCEL']),version:z.number().int().positive(),note:z.string().trim().max(1500).optional(),alternative_at:z.number().int().optional()}).strict().parse(req.body);
  db.transaction(()=>{
   const a=db.prepare('SELECT * FROM live_appointments WHERE id=? AND claim_id=?').get(req.params.appointmentId,c.id);if(!a)throw new HttpError(404,'NOT_FOUND','Invitation not found.');
   const owner=req.user.id===c.user_id,reviewer=req.user.role==='company_reviewer'&&req.user.id===a.reviewer_id;
   if(!owner&&!reviewer)throw new HttpError(403,'FORBIDDEN','Only the customer and requesting reviewer can respond.');
   if(a.version!==b.version)throw new HttpError(409,'INVITATION_CHANGED','This invitation changed. Refresh and respond to the latest version.');
   if(terminal.includes(a.status))throw new HttpError(409,'INVITATION_CLOSED','This invitation is no longer active.');
   let status,start=a.start_at,alternative=null;
   if(b.action==='CANCEL')status='CANCELLED';
   else if(owner&&a.status==='PROPOSED'&&b.action==='ACCEPT'){if(a.start_at<Date.now())throw new HttpError(409,'TIME_PASSED','Proposed time has passed. Suggest another time.');status='ACCEPTED';}
   else if(owner&&['PROPOSED','ACCEPTED'].includes(a.status)&&b.action==='SUGGEST_TIME'){if(!b.alternative_at)throw new HttpError(400,'TIME_REQUIRED','Choose your alternative time.');alternative=future(b.alternative_at);status='ALTERNATIVE';}
   else if(owner&&a.status==='PROPOSED'&&b.action==='DECLINE')status='DECLINED';
   else if(reviewer&&a.status==='ALTERNATIVE'&&b.action==='ACCEPT_ALTERNATIVE'){start=future(a.alternative_at);status='ACCEPTED';}
   else throw new HttpError(409,'INVALID_RESPONSE','This response is not available for the current invitation.');
   if(['DECLINE','SUGGEST_TIME','CANCEL'].includes(b.action)&&(!b.note||b.note.length<5))throw new HttpError(400,'NOTE_REQUIRED','Add a short explanation (at least 5 characters).');
   db.prepare('UPDATE live_appointments SET status=?,start_at=?,alternative_at=?,response_note=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,start,alternative,b.note || (b.action==='ACCEPT_ALTERNATIVE'?a.response_note:null),a.id);
   // Rescheduling or cancellation must also end any already-open video session.
   if(status!=='ACCEPTED'){db.prepare("UPDATE live_sessions SET status='ENDED',ended_at=CURRENT_TIMESTAMP,expires_at=? WHERE appointment_id=? AND status!='ENDED'").run(Date.now(),a.id);db.prepare('DELETE FROM live_signals WHERE session_id IN (SELECT id FROM live_sessions WHERE appointment_id=?)').run(a.id);}
   audit(db,c.id,req.user.id,'LIVE_INVITATION_RESPONSE',`${owner?'Customer':'Company'} response: ${status}. Appointment: ${new Date(start).toISOString()}${alternative?`; suggested time: ${new Date(alternative).toISOString()}`:''}${b.note?` — ${b.note}`:''}.`);
  }).immediate();res.json({appointment:rows(c.id).find(a=>a.id===req.params.appointmentId)});
 }));
}
