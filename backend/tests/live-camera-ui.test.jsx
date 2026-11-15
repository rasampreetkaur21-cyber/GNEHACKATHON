// @vitest-environment jsdom
import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import LiveDeviceCheck from '../../frontend/src/components/LiveDeviceCheck.jsx';
import {api,uploadEvidence} from '../../frontend/src/services/api';
vi.mock('../../frontend/src/services/api',()=>({api:vi.fn(),uploadEvidence:vi.fn()}));
let getMedia,stop;
beforeEach(()=>{
 const session={id:'session-test',status:'WAITING',created_at:'2026-11-15 10:00:00',expires_at:Date.now()+600000};
 api.mockImplementation(async path=>path.endsWith('/signals?after=0')?{session,signals:[]}:path.endsWith('/live')?{session,iceServers:[]}:{session,ok:true});uploadEvidence.mockResolvedValue({id:'snapshot'});
 stop=vi.fn();const track={kind:'video',stop};const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};getMedia=vi.fn().mockResolvedValue(stream);
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:getMedia,enumerateDevices:vi.fn().mockResolvedValue([{kind:'videoinput'}])}});
 vi.stubGlobal('RTCPeerConnection',class {addTrack(){}close(){}async createOffer(){return {sdp:'video-only-test'};}async setLocalDescription(){} });
 Object.defineProperty(HTMLVideoElement.prototype,'videoWidth',{configurable:true,get:()=>640});Object.defineProperty(HTMLVideoElement.prototype,'videoHeight',{configurable:true,get:()=>480});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn()});vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockReturnValue('data:image/jpeg;base64,frame-test');
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({blob:async()=>new Blob(['test'],{type:'image/jpeg'})}));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.clearAllMocks();});
it('camera needs explicit consent, uses video only, and preview requires an explicit save',async()=>{
 const onSaved=vi.fn();render(<LiveDeviceCheck claimId="claim-test" onSaved={onSaved}/>);
 const start=await screen.findByRole('button',{name:'Start camera & join'});expect(getMedia).not.toHaveBeenCalled();fireEvent.click(start);
 await screen.findByRole('button',{name:'Preview a frame'});expect(getMedia).toHaveBeenCalledWith(expect.objectContaining({audio:false,video:expect.objectContaining({facingMode:{ideal:'environment'}})}));
 fireEvent.click(screen.getByRole('button',{name:'Preview a frame'}));expect(uploadEvidence).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Save frame as evidence'}));await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
 const form=uploadEvidence.mock.calls[0][1];expect(form.get('kind')).toBe('live_snapshot');expect(form.get('live_session_id')).toBe('session-test');expect(form.has('replaces')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'End live check'}));await waitFor(()=>expect(stop).toHaveBeenCalled());expect(api).toHaveBeenCalledWith('/claims/claim-test/live/session-test/end',expect.any(Object));
});
it('camera denial leaves photo fallback and does not join or upload',async()=>{
 getMedia.mockRejectedValue(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));render(<LiveDeviceCheck claimId="claim-test"/>);fireEvent.click(await screen.findByRole('button',{name:'Start camera & join'}));
 expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('Camera permission was denied'));expect(uploadEvidence).not.toHaveBeenCalled();expect(api.mock.calls.some(([p])=>p.endsWith('/join'))).toBe(false);
});
it('leaving the claim stops camera tracks and sends an end request',async()=>{
 const {unmount}=render(<LiveDeviceCheck claimId="claim-test"/>);fireEvent.click(await screen.findByRole('button',{name:'Start camera & join'}));await screen.findByRole('button',{name:'Preview a frame'});unmount();expect(stop).toHaveBeenCalled();expect(fetch).toHaveBeenCalledWith('/api/claims/claim-test/live/session-test/end',expect.objectContaining({keepalive:true}));
});
