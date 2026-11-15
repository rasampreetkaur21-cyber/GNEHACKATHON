import {LiveInvitations} from "../components/LiveAppointment";
import React,{useEffect,useState} from 'react';
import {Link,Navigate,useParams} from 'react-router-dom';
import {useAuth} from '../context/Auth';
import {api} from '../services/api';
export const homeFor=user=>user?.role==='company_reviewer'?`/company/${user.company_brand}`:user?.role==='reviewer'?'/reviewer':'/dashboard';
export function CompanyGate({children}) {
 const {brand}=useParams(),{user,loading}=useAuth();
 if(loading)return <p>Loading company workspace…</p>;
 if(!['samsung','boat'].includes(brand))return <p role="alert">Company portal not found.</p>;
 if(!user)return <Navigate to={`/company/${brand}/login`}/>;
 if(user.role!=='company_reviewer'||user.company_brand!==brand)return <section className="panel"><h1>Company access denied</h1><p>This portal is not assigned to your account.</p><Link to={homeFor(user)}>Return to your workspace</Link></section>;
 return children;
}
export function CompanyLogin(){
 const {brand}=useParams(),{user,setUser}=useAuth();const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(!['samsung','boat'].includes(brand))return <p>Company portal not found.</p>;
 if(user?.role==='company_reviewer'&&user.company_brand===brand)return <Navigate to={`/company/${brand}`}/>;
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{const d=await api(`/auth/company/${brand}/login`,{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget))});setUser(d.user);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <main className="company-login"><Link to="/">← ClaimShield AI</Link><section className="panel"><span className="eyebrow">COMPANY STAFF ACCESS</span><h1>{brand==='samsung'?'Samsung':'boAt'} Company Login</h1><p>Sign in with your provisioned company reviewer account.</p>{error&&<p className="error" role="alert">{error}</p>}{user&&<div className="notice"><p>Currently signed in as <strong>{user.name}</strong>. Enter your company credentials below to switch to this company workspace.</p><Link to={homeFor(user)}>Return to current workspace</Link></div>}<form onSubmit={submit}><label>Email<input name="email" type="email" required autoComplete="username" disabled={busy}/></label><label>Password<input name="password" type="password" required autoComplete="current-password" disabled={busy}/></label><button className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p><Link to={`/company/${brand==='samsung'?'boat':'samsung'}/login`}>Other company portal</Link></p></section></main>;
}
export function CompanyDashboard(){
 const {brand}=useParams();const [claims,setClaims]=useState([]),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true,inFlight=false;setLoading(true);const query=new URLSearchParams();if(search)query.set('search',search);if(status)query.set('status',status);const refresh=async()=>{if(inFlight)return;inFlight=true;try{const d=await api(`/company/${brand}/claims?${query}`);if(active){setClaims(d.claims);setError('');}}catch(e){if(active)setError(e.message);}finally{inFlight=false;if(active)setLoading(false);}};const timer=setTimeout(refresh,200),poll=setInterval(refresh,10000);return()=>{active=false;clearTimeout(timer);clearInterval(poll);};},[brand,search,status]);
 return <><LiveInvitations/><span className="eyebrow">COMPANY CLAIMS</span><h1>{brand==='samsung'?'Samsung':'boAt'} dashboard</h1><p>Open Review claim to inspect the complaint, photos and documents, then manually approve, reject or request more evidence.</p><div className="panel"><div className="company-filters"><label>Search claims<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Claim ID, customer or model" maxLength={150}/></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{['SUBMITTED','UNDER_REVIEW','NEEDS_EVIDENCE','APPROVED','REJECTED'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label></div>{error&&<p className="error" role="alert">{error}</p>}{loading?<p>Loading claims…</p>:claims.length?<div className="table-wrap"><table><thead><tr><th>Claim ID</th><th>Customer</th><th>Model</th><th>Submitted</th><th>Status</th><th>Review</th></tr></thead><tbody>{claims.map(c=><tr key={c.id}><td><Link to={`/company/${brand}/claims/${c.id}`}>{c.id}</Link>{!!c.synthetic&&<span className="badge amber">Synthetic demo</span>}</td><td>{c.customer_name}</td><td>{c.model || c.product}</td><td>{new Date(c.created_at+'Z').toLocaleDateString()}</td><td>{c.status.replaceAll('_',' ')}</td><td><Link className="button small" to={`/company/${brand}/claims/${c.id}`}>{['APPROVED','REJECTED'].includes(c.status)?'View decision':'Review claim →'}</Link></td></tr>)}</tbody></table></div>:<p>No matching submitted claims.</p>}</div></>;
}
