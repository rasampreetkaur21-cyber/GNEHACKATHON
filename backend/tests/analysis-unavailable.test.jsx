// @vitest-environment jsdom
import React from "react";
import {afterEach,it,expect,vi} from "vitest";
import {render,screen,cleanup} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EvidenceAnalysis from "../../frontend/src/components/EvidenceAnalysis.jsx";
import {api} from "../../frontend/src/services/api.js";
vi.mock("../../frontend/src/services/api.js",()=>({api:vi.fn()}));
const evidence={id:"test",kind:"invoice",mime:"image/jpeg",size:100,original_name:"invoice.jpg",trust_tier:"ASSERTED",active:1,synthetic:0,processing_status:"AI_NOT_CONFIGURED",processing_message:"not configured"};
const data=(status="AI_NOT_CONFIGURED",state=evidence.processing_status)=>({evidence:{...evidence,processing_status:state},annotations:[],ai:{status}});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("hides unusable retry and opens manual entry",async()=>{
 api.mockResolvedValue(data());const user=userEvent.setup();render(<EvidenceAnalysis evidence={evidence} claimId="claim" onChanged={vi.fn()} />);
 await screen.findByText("Automatic analysis is not enabled");expect(screen.queryByRole("button",{name:/Retry evidence analysis/})).toBeNull();expect(screen.queryByText("Processing status updated.")).toBeNull();
 await user.click(screen.getByRole("button",{name:"Add information manually"}));expect(screen.getByText("Provide missing information or request a correction").closest("details").open).toBe(true);
});
it("allows retry after server configuration recovers",async()=>{
 api.mockResolvedValue(data("READY"));render(<EvidenceAnalysis evidence={evidence} claimId="claim" onChanged={vi.fn()} />);
 expect(await screen.findByRole("button",{name:"Retry evidence analysis"})).toBeTruthy();expect(screen.queryByText("Automatic analysis is not enabled")).toBeNull();
});
it("does not show false success when configuration disappears during analysis",async()=>{
 let ready=true;api.mockImplementation(async(path,options)=>{if(options?.method==="POST"){ready=false;return {status:"AI_NOT_CONFIGURED"};}return data(ready?"READY":"AI_NOT_CONFIGURED",ready?"NOT_ANALYZED":"AI_NOT_CONFIGURED");});
 const user=userEvent.setup();render(<EvidenceAnalysis evidence={{...evidence,processing_status:"NOT_ANALYZED"}} claimId="claim" onChanged={vi.fn()} />);
 await user.click(await screen.findByRole("button",{name:"Start evidence analysis"}));await screen.findByText("Automatic analysis is not enabled");expect(document.querySelector(".success")).toBeNull();
});
