import React,{useState} from 'react';
const choices=[['APPROVED','Approve claim','Warranty claim accepted','green'],['REJECTED','Reject claim','Explain why the claim cannot be accepted','rose'],['NEEDS_EVIDENCE','Request more evidence','Ask for a specific photo or document','amber'],['UNDER_REVIEW','Under review','Keep the claim open while you investigate','blue']];
export default function ManualDecision({onSubmit,busy,closed,status}) {
 const [selected,setSelected]=useState(''),[reason,setReason]=useState('');
 if(closed)return <section className="panel manual-decision"><h2>Final human decision: {status==='APPROVED'?'Approved':'Rejected'}</h2><p>This claim is finalized. The recorded reason and history appear below.</p></section>;
 return <form id="manual-decision" className="panel manual-decision" onSubmit={onSubmit}>
  <span className="eyebrow">COMPANY / HUMAN REVIEW</span><h2>Decide this warranty claim</h2>
  <p>Inspect the customer’s complaint and evidence, then choose your decision. AI recommendations are advisory.</p>
  <a href="#claim-evidence" className="text-link">View photos & documents ↓</a>
  <fieldset disabled={busy}><legend>Choose a manual decision</legend><div className="decision-options">{choices.map(([value,label,description,tone])=><label key={value} className={`decision-option ${tone}${selected===value?' selected':''}`}><input type="radio" name="status" value={value} checked={selected===value} onChange={()=>setSelected(value)} required/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div></fieldset>
  <label>Reason shown to customer<textarea name="reason" value={reason} onChange={e=>setReason(e.target.value)} minLength={10} maxLength={1500} required rows={3} placeholder="Explain what you checked and why you chose this decision. For more evidence, say exactly what is needed." disabled={busy}/></label>
  {['APPROVED','REJECTED'].includes(selected)&&<p className="muted">Saving {selected==='APPROVED'?'approval':'rejection'} finalizes this claim. Check your decision and reason before saving.</p>}
  <button className="button" type="submit" disabled={busy||!selected||reason.trim().length<10}>{busy?'Saving…':'Save manual decision'}</button>
 </form>;
}
