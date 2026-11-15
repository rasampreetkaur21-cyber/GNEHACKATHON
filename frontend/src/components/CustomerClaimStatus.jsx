import React from "react";
export default function CustomerClaimStatus({summary}) {
 if(!summary)return null;
 const tone=summary.code === "APPROVED" ? "approved" : summary.code === "REJECTED" ? "declined" : summary.code === "SCANNING" ? "scanning" : "pending";
 const target=summary.action === "UPLOAD" ? "#evidence-upload" : summary.action === "EVIDENCE" ? "#claim-evidence" : "#claim-history";
 return <section className={`customer-status ${tone}`} aria-live="polite"><div className="customer-status-icon" aria-hidden="true">{summary.approved ? "✓" : summary.final ? "×" : summary.code === "SCANNING" ? "◌" : "i"}</div><div><span className="eyebrow">YOUR CLAIM STATUS</span><h2>{summary.title}</h2><p>{summary.reason}</p><div className="customer-next"><strong>What happens next</strong><p>{summary.next_action}</p></div>{summary.action && <a className="button small" href={target} onClick={()=>{if(summary.action === "DETAILS"){const details=document.getElementById("claim-history");if(details)details.open=true;}}}>{summary.action === "UPLOAD" ? "Add / replace evidence" : summary.action === "EVIDENCE" ? "View photo check" : "View review details"} →</a>}</div></section>;
}
