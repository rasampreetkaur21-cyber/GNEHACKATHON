import React from "react";
import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {customerOutcome} from "../src/services/customerOutcome.js";
import CustomerClaimStatus from "../../frontend/src/components/CustomerClaimStatus.jsx";
import CustomerPhotoScan from "../../frontend/src/components/CustomerPhotoScan.jsx";
const claim={status:"SUBMITTED",model:"Galaxy A26 5G",purchase_date:"2026-01-01"};
const photo={id:"photo",claim_id:"claim",kind:"photo",active:1,processing_status:"ANALYSIS_COMPLETE",mime:"image/jpeg",trust_tier:"EXTRACTED"};
const invoice={...photo,id:"invoice",kind:"invoice"};
const base={claim,evidence:[photo,invoice],verification:{status:"MATCH"},investigation:{outcome:"AUTO_APPROVE",results:[]}};
describe("plain-language customer outcomes",()=>{
 it("does not turn an automatic recommendation into a final approval",()=>{
  const s=customerOutcome(base);expect(s.code).toBe("FINAL_REVIEW");expect(s.approved).toBe(false);expect(s.final).toBe(false);expect(s.title).toContain("pending");
 });
 it.each(["APPROVED","REJECTED"])("honours actual reviewer status %s and reason",status=>{
  const s=customerOutcome({...base,claim:{...claim,status},reviewNote:"Reviewer checked the original receipt."});expect(s.final).toBe(true);expect(s.approved).toBe(status==="APPROVED");expect(s.reason).toBe("Reviewer checked the original receipt.");
 });
 it("clearly requests the wrong photo without falsely rejecting the claim",()=>{
  const s=customerOutcome({...base,verification:{status:"INVALID_DEVICE"}});expect(s.code).toBe("WRONG_PHOTO");expect(s.title).toContain("Not approved yet");expect(s.final).toBe(false);expect(s.next_action).toContain("Galaxy A26 5G");
 });
 it("tells the customer when a scan is actually running",()=>expect(customerOutcome({...base,evidence:[{...photo,processing_status:"ANALYSIS_PENDING"}]}).code).toBe("SCANNING"));
 it("requests missing photos and invoices only when relevant",()=>{
  expect(customerOutcome({...base,evidence:[]}).code).toBe("PHOTO_NEEDED");expect(customerOutcome({...base,evidence:[photo]}).code).toBe("INVOICE_NEEDED");
 });
 it("asks for a brighter or sharper retake without technical rule codes",()=>{
  const s=customerOutcome({...base,evidence:[{...photo,scan_report:{quality:"DARK"}}]});expect(s.code).toBe("RETAKE_NEEDED");expect(s.reason).toContain("dark");expect(JSON.stringify(s)).not.toMatch(/R0[1-9]|UNKNOWN/);
 });
 it("keeps readable-but-unlinked model evidence for review instead of endlessly requesting labels",()=>{
  const s=customerOutcome({...base,verification:{status:"UNVERIFIED"},evidence:[{...photo,scan_report:{readable_model_candidate:"samsung-galaxy-a26-5g"}}]});expect(s.code).toBe("MODEL_REVIEW");expect(s.reason).toContain("Readable model text");
 });
 it("explains authenticity review as uncertainty, not an accusation",()=>{
  const s=customerOutcome({...base,verification:{status:"UNVERIFIED",evidence_basis:{closed_set_status:"HUMAN_REVIEW"}}});expect(s.code).toBe("REVIEW_NEEDED");expect(s.reason).not.toMatch(/fraud|lying/i);
 });
 it("does not blame a customer for missing company policy configuration",()=>{
  const s=customerOutcome({...base,investigation:{outcome:"NEEDS_EVIDENCE",results:[{ruleId:"R02",status:"UNKNOWN"}]}});expect(s.code).toBe("UNDER_REVIEW");expect(s.next_action).toContain("No extra action");expect(s.action).toBeNull();
 });
 it("renders a simple decision, reason and next step",()=>{
  const html=renderToStaticMarkup(<CustomerClaimStatus summary={customerOutcome(base)}/>);expect(html).toContain("What happens next");expect(html).not.toContain("R01");expect(html).not.toContain("UNKNOWN");
 });
 it("shows a real uploaded-photo preview and actionable result instead of empty unknown tables",()=>{
  const html=renderToStaticMarkup(<CustomerPhotoScan evidence={photo} verification={{status:"UNVERIFIED"}} selectedModel="Galaxy A26 5G"/>);expect(html).toContain("Your uploaded product photo");expect(html).toContain("model label needed");expect(html).not.toContain("Unknown");
 });
 it("does not present OCR text as verified model identity",()=>{
  const html=renderToStaticMarkup(<CustomerPhotoScan evidence={{...photo,scan_report:{readable_model_candidate:"samsung-galaxy-a26-5g",category:"phone"}}} verification={{status:"UNVERIFIED"}}/>);expect(html).toContain("confirmation needed");expect(html).not.toContain("Model evidence matches");
 });
});
