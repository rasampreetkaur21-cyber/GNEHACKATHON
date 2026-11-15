import React from "react";
import {scanCategory,scanModel} from "../utils/scan";
export default function CustomerPhotoScan({evidence:e,verification,selectedModel}) {
 const report=e.scan_report, photo=e.kind === "photo",pending=["ANALYSIS_PENDING","ANALYSIS_QUEUED"].includes(e.processing_status);
 const raw=report?.readable_model_candidate, model=scanModel(raw) || report?.other_model_text || (verification?.observed_model && verification.observed_model !== "UNKNOWN" ? verification.observed_model:null);
 let heading=e.kind === "live_snapshot" ? "Saved live camera frame" : photo ? "Photo saved" : "Receipt / document saved",body=e.kind === "live_snapshot" ? "Saved with your confirmation during the live check. Your original device photo is unchanged. This frame is additional evidence for review." : "Your reviewer can view this file.";
 if(pending){heading="Scanning your evidence…";body="The result will appear here automatically. No need to upload it again.";}
 else if(e.processing_status === "ANALYSIS_FAILED"){heading="Scan could not finish";body="Your upload is safe. Retry below or leave it for manual review.";}
 else if(verification?.evidence_basis?.closed_set_status === "HUMAN_REVIEW"){heading="A reviewer needs to check this photo";body="The image source or authenticity needs confirmation. A fresh original device photo can help.";}
 else if(verification?.status === "INVALID_DEVICE"){heading="Use a different product photo";body=`This image does not verify your selected ${selectedModel || "product"}. Upload the actual device and its model label together.`;}
 else if(e.processing_status === "ANALYSIS_COMPLETE"){
  if(!photo){const useful=["invoice_number","invoice_date","seller_name","product_model","serial_number"].some(k=>e.observations?.[k] && e.observations[k] !== "UNKNOWN");heading=useful ? "Receipt details scanned" : "Receipt needs a closer look";body=useful ? "Readable details were saved for review. The receipt still needs to be checked." : "Receipt details could not be read reliably. Upload a clear receipt image or leave the document for review.";}
  else if(verification?.status === "MATCH"){heading="Model evidence matches";body="Your product photo passed the model check. Warranty approval is checked separately.";}
  else if(["DARK","BLURRY","LOW_RESOLUTION"].includes(report?.quality)){heading="A clearer photo is needed";body=report.quality === "DARK" ? "Use brighter lighting so the model label can be read." : report.quality === "BLURRY" ? "Keep the camera steady and focus on the device label." : "Upload the original full-size image rather than a small preview.";}
  else if(model){heading="Model text found — confirmation needed";body=`Readable text says ${model}. A reviewer still needs to confirm that it belongs to the pictured device.`;}
  else{heading="Photo checked — model label needed";body="Show the actual device and its readable model label or About screen in the same photo.";}
 }
 return <div className="customer-scan"><div className="customer-scan-preview">{["image/jpeg","image/png","image/webp"].includes(e.mime) ? <img src={`/api/claims/${e.claim_id}/evidence/${e.id}`} alt={photo ? "Your uploaded product photo" : "Your uploaded document"} loading="lazy" /> : <span>Document</span>}</div><div><h3>{heading}</h3><p>{body}</p>{photo && report?.category && <p className="scan-observation">Scanner suggestion: {scanCategory(report.category)}.</p>}<small>{e.trust_tier === "VERIFIED" ? "Evidence reviewed" : "Saved for review"}</small></div></div>;
}
