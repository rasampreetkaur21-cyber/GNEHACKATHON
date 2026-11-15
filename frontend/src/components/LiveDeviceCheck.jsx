import React,{useEffect,useRef,useState} from 'react';
import {api,uploadEvidence} from '../services/api';
export default function LiveDeviceCheck({claimId,company=false,closed=false,onSaved,appointment=null,schedulingRequired=false}) {
 const [session,setSession]=useState(null),[ice,setIce]=useState([]),[state,setState]=useState('WAITING'),[joined,setJoined]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[frame,setFrame]=useState(null),[facing,setFacing]=useState('environment'),[canSwitch,setCanSwitch]=useState(false),[remoteVideo,setRemoteVideo]=useState(false);
 const video=useRef(),stream=useRef(),pc=useRef(),cursor=useRef(0),pendingIce=useRef([]),active=useRef(null),mounted=useRef(true),pollBusy=useRef(false),cameraAttempt=useRef(0),connectingSince=useRef(null);
 const base=`/claims/${claimId}/live`;
 function release(){connectingSince.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;pc.current?.close();pc.current=null;if(video.current)video.current.srcObject=null;}
 async function end(){cameraAttempt.current++;const id=active.current;active.current=null;release();setBusy(false);setJoined(false);setRemoteVideo(false);setFrame(null);setState('ENDED');if(id)try{await api(`${base}/${id}/end`,{method:'POST',body:{}});}catch(e){setError(e.message);}}
 async function camera(constraints){
  const attempt=++cameraAttempt.current;let abandoned=false,timer;
  const media=navigator.mediaDevices.getUserMedia(constraints).then(s=>{if(abandoned||!mounted.current||attempt!==cameraAttempt.current){s.getTracks().forEach(t=>t.stop());throw new Error('Camera request cancelled. Continue with photos.');}return s;});
  try{return await Promise.race([media,new Promise((_,reject)=>{timer=setTimeout(()=>{abandoned=true;reject(new Error('Camera did not start. Check browser permission or continue with photo uploads.'));},20000);})]);}finally{clearTimeout(timer);}
 }
 useEffect(()=>{
  mounted.current=true;
  const leave=()=>{cameraAttempt.current++;const id=active.current;active.current=null;release();if(id)fetch(`/api${base}/${id}/end`,{method:'POST',credentials:'include',keepalive:true,headers:{'Content-Type':'application/json','X-ClaimShield':'1'},body:'{}'}).catch(()=>{});};
  const refresh=async()=>{try{const d=await api(base);if(!mounted.current)return;setSession(d.session);setIce(d.iceServers || []);if(d.session?.status==='ENDED' && active.current){active.current=null;release();setJoined(false);setState('ENDED');}else if(!active.current)setState(d.session?.status || 'WAITING');}catch(e){if(mounted.current)setError(e.message);}};
  refresh();const timer=setInterval(refresh,2500);window.addEventListener('pagehide',leave);
  return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('pagehide',leave);leave();};
 },[claimId]);
 useEffect(()=>{
  if(closed && active.current)end();
 },[closed]);
 async function send(body){const id=active.current;if(id)await api(`${base}/${id}/signals`,{method:'POST',body});}
 function connection(){
  const peer=new RTCPeerConnection({iceServers:ice});pc.current=peer;
  peer.onicecandidate=e=>{if(e.candidate)send({type:'ice',candidate:e.candidate.toJSON()}).catch(e=>mounted.current&&setError(e.message));};
  peer.ontrack=e=>{setRemoteVideo(true);if(video.current)video.current.srcObject=e.streams[0] || new MediaStream([e.track]);};
  peer.onconnectionstatechange=()=>{
   if(!mounted.current || pc.current!==peer)return;
   if(peer.connectionState==='connected'){connectingSince.current=null;setState('CONNECTED');send({type:'connected'}).catch(()=>{});}
   if(['disconnected','failed'].includes(peer.connectionState)){setState('DISCONNECTED');send({type:'disconnected'}).catch(()=>{});setError('Live video disconnected. End this session and request another check, or continue with photos.');}
  };return peer;
 }
 useEffect(()=>{
  if(!joined)return;
  const poll=async()=>{
   if(pollBusy.current || !active.current)return;pollBusy.current=true;
   try{
    const d=await api(`${base}/${active.current}/signals?after=${cursor.current}`);
    if(!mounted.current || !active.current)return;
    if(d.session.status==='ENDED'){active.current=null;release();setJoined(false);setState('ENDED');setFrame(null);return;}
    const both=d.session.owner_joined && d.session.reviewer_joined;
    if(pc.current?.connectionState!=='connected'){
      if(!both){connectingSince.current=null;setState(company?'WAITING_FOR_CUSTOMER':'WAITING_FOR_REVIEWER');}
      else {setState('CONNECTING');connectingSince.current ||= Date.now();if(Date.now()-connectingSince.current>45000){setError('Both participants joined, but video could not connect within 45 seconds. End and retry; on different networks a configured TURN relay may be needed. Photo uploads remain available.');await end();return;}}
    }
    for(const signal of d.signals){
     const peer=pc.current;if(!peer)break;
     if(signal.type==='offer' && company){await peer.setRemoteDescription({type:'offer',sdp:signal.sdp});for(const c of pendingIce.current)await peer.addIceCandidate(c);pendingIce.current=[];const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await send({type:'answer',sdp:answer.sdp});}
     if(signal.type==='answer' && !company){await peer.setRemoteDescription({type:'answer',sdp:signal.sdp});for(const c of pendingIce.current)await peer.addIceCandidate(c);pendingIce.current=[];}
     if(signal.type==='ice'){if(peer.remoteDescription)await peer.addIceCandidate(signal.candidate);else pendingIce.current.push(signal.candidate);}
     cursor.current=signal.id;
    }
   }catch(e){if(mounted.current)setError(`${e.message} You can end the live check and continue with photos.`);}
   finally{pollBusy.current=false;}
  };poll();const timer=setInterval(poll,1000);return()=>clearInterval(timer);
 },[joined,claimId,company]);
 async function request(){setBusy(true);setError('');try{const d=await api(base,{method:'POST',body:appointment?{appointment_id:appointment.id}:{}});setSession(d.session);setState(d.session.status);}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function join(){
  setBusy(true);setError('');setFrame(null);
  try{
   if(!window.RTCPeerConnection)throw new Error('Live video is unavailable in this browser. Continue with photo uploads.');
   if(!company){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera requires HTTPS or localhost and a supported browser. Continue with photos.');
    stream.current=await camera({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}});
    if(!mounted.current){release();return;}
    const devices=await navigator.mediaDevices.enumerateDevices();setCanSwitch(devices.filter(d=>d.kind==='videoinput').length>1);
   }
   const version=cameraAttempt.current;
   await api(`${base}/${session.id}/join`,{method:'POST',body:{}});
   if(!mounted.current || version!==cameraAttempt.current){release();await api(`${base}/${session.id}/end`,{method:'POST',body:{}});return;}
   active.current=session.id;cursor.current=0;pendingIce.current=[];
   const peer=connection();
   if(!company){for(const track of stream.current.getVideoTracks()){peer.addTrack(track,stream.current);track.onended=()=>{if(mounted.current){setError('Camera stopped. Continue with photos or request a new live check.');end();}};}if(video.current)video.current.srcObject=stream.current;const offer=await peer.createOffer();await peer.setLocalDescription(offer);await send({type:'offer',sdp:offer.sdp});}
   setJoined(true);setState('CONNECTING');
  }catch(e){release();if(active.current)await end();setError(e.name==='NotAllowedError'?'Camera permission was denied. Your claim and photo upload option are still available.':e.message);}
  finally{setBusy(false);}
 }
 async function switchCamera(){
  setBusy(true);setError('');const next=facing==='environment'?'user':'environment';
  try{
   // Mobile devices may require releasing one camera before opening the other.
   stream.current?.getTracks().forEach(t=>t.stop());
   const nextStream=await camera({audio:false,video:{facingMode:{ideal:next}}});
   const sender=pc.current?.getSenders().find(s=>s.track?.kind==='video');if(!sender){nextStream.getTracks().forEach(t=>t.stop());throw new Error('Live session ended.');}
   await sender.replaceTrack(nextStream.getVideoTracks()[0]);stream.current=nextStream;video.current.srcObject=nextStream;setFacing(next);setFrame(null);
   nextStream.getVideoTracks()[0].onended=()=>end();
  }catch(e){setError(`Camera switch failed: ${e.message}. Continue with photos.`);await end();}finally{setBusy(false);}
 }
 function capture(){if(!video.current?.videoWidth)return;const canvas=document.createElement('canvas');canvas.width=video.current.videoWidth;canvas.height=video.current.videoHeight;canvas.getContext('2d').drawImage(video.current,0,0);setFrame(canvas.toDataURL('image/jpeg',.9));}
 async function save(){setBusy(true);setError('');try{const blob=await(await fetch(frame)).blob();const form=new FormData();form.append('kind','live_snapshot');form.append('live_session_id',active.current);form.append('file',blob,'live-device-frame.jpg');await uploadEvidence(claimId,form);setFrame(null);await onSaved?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const ended=session?.status==='ENDED' || state==='ENDED';
 return <section className="panel live-panel" aria-label="Live device verification">
  <div className="section-title"><h2>Live device check</h2><span className="badge">{closed?'Closed':state.toLowerCase().replaceAll('_',' ')}</span></div>
  <p>Optional one-way video. The reviewer sees your device; no microphone or automatic recording. Live observations support the reviewer’s decision.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {!session&&!closed&&<p>{company?'Send an appointment invitation above. Once accepted, start the room during the joining window.':'Waiting for the company to open the agreed room. You can continue with photo uploads.'}</p>}
  {session&&<p>Requested {new Date(session.created_at+'Z').toLocaleString()} · {ended?'Session ended. Saved frames remain with claim evidence.':`Expires ${new Date(session.expires_at).toLocaleTimeString()}`}</p>}
  {joined&&company&&!remoteVideo&&<div className="notice"><strong>Waiting for customer video</strong><p>The customer must open this claim, choose Start camera & join and allow camera access. Joining as a reviewer does not turn on the customer’s camera.</p></div>}
  <video ref={video} autoPlay playsInline muted controls={false} className={joined&&(!company||remoteVideo)?'live-video':'live-video idle'} aria-label={company?'Customer live device video':'Your live camera preview'} />
  {!closed&&!joined&&session&&!ended&&<button className="button" disabled={busy} onClick={join}>{busy?'Connecting…':company?'Join live check':'Start camera & join'}</button>}
  {!closed&&company&&(!session||ended)&&(!schedulingRequired||(appointment&&Date.now()>=appointment.start_at-600000&&Date.now()<=appointment.start_at+appointment.duration_minutes*60000+900000))&&<button className="button" onClick={request} disabled={busy}>{schedulingRequired?'Start agreed live check':'Request live device check'}</button>}
  {!closed&&joined&&!company&&<><button className="button secondary" disabled={busy} onClick={capture}>Preview a frame</button>{canSwitch&&<button className="button secondary" disabled={busy} onClick={switchCamera}>Switch camera</button>}</>}
  {session&&!ended&&!closed&&<button className="button secondary" onClick={()=>{if(!active.current)active.current=session.id;end();}}>End live check</button>}
  {frame&&<div className="frame-preview"><h3>Frame preview — not saved yet</h3><img src={frame} alt="Camera frame preview, not yet uploaded"/><p>Save this frame as additional private evidence. Your current device photo stays unchanged.</p><button className="button" disabled={busy||!joined} onClick={save}>Save frame as evidence</button><button className="button secondary" disabled={busy} onClick={()=>setFrame(null)}>Discard preview</button></div>}
  <p className="muted">Camera denied, unavailable or disconnected? Continue using the photo upload section below.</p>
 </section>;
}
