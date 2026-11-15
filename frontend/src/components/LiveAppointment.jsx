import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../services/api';
import LiveDeviceCheck from './LiveDeviceCheck';
const activeStatuses=['PROPOSED','ACCEPTED','ALTERNATIVE'];
export const slotTime=t=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(t))+' IST';
export default function LiveAppointment({claimId,company,closed,onSaved}){
 const [items,setItems]=useState([]),[time,setTime]=useState(''),[message,setMessage]=useState('Please show the actual device, its readable model label or About screen, and the reported issue.'),[duration,setDuration]=useState('15'),[note,setNote]=useState(''),[alternative,setAlternative]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const path=`/claims/${claimId}/appointments`;
 const load=()=>api(path).then(d=>setItems(d.appointments));
 useEffect(()=>{let live=true;const refresh=()=>api(path).then(d=>live&&setItems(d.appointments)).catch(e=>live&&setError(e.message));refresh();const timer=setInterval(refresh,5000);return()=>{live=false;clearInterval(timer);};},[path]);
 const current=items.find(a=>activeStatuses.includes(a.status));
 const toTime=v=>Date.parse(v+'+05:30');
 async function propose(e){e.preventDefault();setBusy(true);setError('');try{await api(path,{method:'POST',body:{start_at:toTime(time),duration_minutes:Number(duration),message}});await load();setTime('');}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function respond(action){setBusy(true);setError('');try{await api(`${path}/${current.id}/respond`,{method:'POST',body:{action,version:current.version,...(note?{note}:{}),...(action==='SUGGEST_TIME'?{alternative_at:toTime(alternative)}:{})}});setNote('');setAlternative('');await load();}catch(e){setError(e.message);await load().catch(()=>{});}finally{setBusy(false);}}
 const inWindow=current?.status==='ACCEPTED'&&Date.now()>=current.start_at-600000&&Date.now()<=current.start_at+current.duration_minutes*60000+900000;
 return <><section className="panel appointment-panel"><h2>Arrange a live device demonstration</h2><p>The company proposes what to show and when. The customer chooses whether the time works. Camera sharing starts only after an explicit join.</p>{error&&<p className="error" role="alert">{error}</p>}
 {current&&<div className="appointment-invitation"><span className="badge">{current.status==='PROPOSED'?'Awaiting customer confirmation':current.status==='ALTERNATIVE'?'Alternative time suggested':'Confirmed appointment'}</span><h3>{company?'Live check invitation':'Your company reviewer has requested a live demonstration'}</h3><p><strong>Proposed time:</strong> {slotTime(current.start_at)} · {current.duration_minutes} minutes</p><p><strong>What to show:</strong> {current.message}</p><p><strong>Requested by:</strong> {current.reviewer_name}</p>{current.response_note&&<p><strong>Latest response:</strong> {current.response_note}</p>}{current.alternative_at&&<p><strong>Customer’s suggested time:</strong> {slotTime(current.alternative_at)}</p>}
 {!company&&current.status==='PROPOSED'&&<button className="button" disabled={busy} onClick={()=>respond('ACCEPT')}>Yes, this time works</button>}
 {!company&&['PROPOSED','ACCEPTED'].includes(current.status)&&<div><label>Suggest another date & time (IST)<input type="datetime-local" value={alternative} onChange={e=>setAlternative(e.target.value)}/></label><label>Reply / reason<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1500} placeholder="Tell the company when you are available or why you cannot attend."/></label><button className="button secondary" disabled={busy||!alternative||note.trim().length<5} onClick={()=>respond('SUGGEST_TIME')}>Suggest this time</button>{current.status==='PROPOSED'&&<button className="button secondary" disabled={busy||note.trim().length<5} onClick={()=>respond('DECLINE')}>Decline request</button>}</div>}
 {company&&current.status==='ALTERNATIVE'&&<button className="button" disabled={busy} onClick={()=>respond('ACCEPT_ALTERNATIVE')}>Confirm customer’s suggested time</button>}
 {company&&<label>Message for cancellation<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1500} placeholder="If cancelling, explain why."/></label>}
 {current.status==='ALTERNATIVE'&&!company&&<p>Your suggested time has been sent. The company must confirm it before the appointment is agreed.</p>}
 {!company&&current.status==='ALTERNATIVE'&&<label>Reason if cancelling<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1500}/></label>}
 <button className="button secondary" disabled={busy||note.trim().length<5} onClick={()=>respond('CANCEL')}>Cancel invitation</button>
 {current.status==='ACCEPTED'&&<p className="notice">{inWindow?'Your agreed joining window is open. The reviewer can start the room below, then both participants join.':`Confirmed for ${slotTime(current.start_at)}. Joining opens 10 minutes before this time.`}</p>}
 </div>}
 {!closed&&company&&!current&&<form onSubmit={propose}><h3>Send a proposed appointment</h3><label>Date & time (IST)<input type="datetime-local" required value={time} onChange={e=>setTime(e.target.value)}/></label><label>Duration<select value={duration} onChange={e=>setDuration(e.target.value)}><option value="15">15 minutes</option><option value="30">30 minutes</option></select></label><label>Tell the customer what to show<textarea required minLength={15} maxLength={1500} value={message} onChange={e=>setMessage(e.target.value)}/></label><button className="button" disabled={busy}>{busy?'Sending…':'Send invitation to customer'}</button></form>}
 {!current&&!company&&<p>No pending appointment. Any new company invitation will appear here and on your dashboard.</p>}
 {items.length>0&&<details><summary>Appointment history</summary>{items.map(a=><p key={a.id}>{slotTime(a.start_at)} · {a.status.toLowerCase()} · {a.response_note || a.message}</p>)}</details>}
 </section><LiveDeviceCheck claimId={claimId} company={company} closed={closed} onSaved={onSaved} appointment={current?.status==='ACCEPTED'?current:null} schedulingRequired/></>;
}
export function LiveInvitations(){
 const [items,setItems]=useState([]);
 useEffect(()=>{let active=true;const load=()=>api('/live-invitations').then(d=>active&&setItems(d.appointments)).catch(()=>{});load();const timer=setInterval(load,15000);return()=>{active=false;clearInterval(timer);};},[]);
 if(!items.length)return null;
 return <section className="panel appointment-panel"><h2>Live demonstration requests</h2>{items.map(a=><div className="appointment-invitation" key={a.id}><strong>{a.model} · {slotTime(a.start_at)}</strong><p>{a.message}</p><p>{a.status==='PROPOSED'?'Please confirm if this time works, decline, or suggest another time.':a.status==='ALTERNATIVE'?'Alternative time is awaiting company confirmation.':'Appointment confirmed.'}</p><Link className="button small" to={`/claims/${a.claim_id}`}>View request & respond →</Link></div>)}</section>;
}
