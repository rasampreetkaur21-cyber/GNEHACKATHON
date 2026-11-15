import ProductEvidenceReport from "./ProductEvidenceReport";
import CustomerPhotoScan from "./CustomerPhotoScan";
import React, { useEffect, useState, useRef } from "react";
import { api } from "../services/api";
import DeviceVerification from "./DeviceVerification";
const title = (s) => s.replaceAll("_", " ").toLowerCase();
const invoiceFields = [
  "seller_name",
  "invoice_number",
  "invoice_date",
  "product_name",
  "product_model",
  "serial_number",
  "customer_name",
  "gstin",
];
const photoFields = [
  "device_category",
  "visible_damage_types",
  "damage_location",
  "visible_cracks",
  "visible_dents",
  "visible_liquid_contact_indicator",
  "visible_tamper_signs",
  "serial_text",
  "model_text",
  "image_relevance",
  "observable_facts",
];
export default function EvidenceAnalysis({
  claimId,
  evidence,
  closed,
  reviewer,
  selectedModel,
  onChanged,
}) {
  const [data, setData] = useState({ evidence, annotations: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const manualRef = useRef(null);
  const lastSeenStatus = useRef(evidence.processing_status);
  const path = `/claims/${claimId}/evidence/${evidence.id}`;
  const refresh = () => api(path + "/analysis").then(setData);
  useEffect(() => {
    let active = true;
    api(path + "/analysis")
      .then((d) => {
        if (active) {
          setData(d);
          if (lastSeenStatus.current !== d.evidence.processing_status) {
            lastSeenStatus.current = d.evidence.processing_status;
            onChanged?.();
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path, evidence.active, evidence.processing_status, selectedModel]);
  const pending =
    evidence.active !== 0 &&
    ["ANALYSIS_QUEUED", "ANALYSIS_PENDING"].includes(
      data.evidence.processing_status,
    );
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = setInterval(() => {
      api(path + "/analysis")
        .then((d) => {
          if (active) {
            setData(d);
            if (
              !["ANALYSIS_QUEUED", "ANALYSIS_PENDING"].includes(
                d.evidence.processing_status,
              )
            )
              onChanged();
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pending, path]);
  async function action(suffix, body) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await api(path + suffix, { method: "POST", body });
      await refresh();
      await onChanged();
      if (
        suffix === "/analyze" &&
        !["ANALYSIS_PENDING", "ANALYSIS_QUEUED", "ANALYSIS_COMPLETE"].includes(
          response.status,
        )
      ) {
        return false;
      }
      setMessage(
        suffix === "/annotations"
          ? "Information saved as ASSERTED. Original extracted observations remain unchanged."
          : suffix === "/verify"
            ? "Reviewer confirmation recorded. Claim decision unchanged."
            : response.status === "ANALYSIS_PENDING"
              ? "Analysis started. You can leave this page and return for results."
              : response.status === "ANALYSIS_QUEUED"
                ? "Analysis queued. Results will appear when processing finishes."
                : "Analysis completed. Review the extracted information below.",
      );
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const e = data.evidence,
    observations = e.observations;
  const inactive = evidence.active === 0 || e.active === 0;
  const verification = inactive
    ? data.verification_history?.[0]
    : data.device_verification;
  const eligible =
    !e.synthetic &&
    ["image/jpeg", "image/png", "image/webp"].includes(e.mime) &&
    ["invoice", "photo"].includes(e.kind);
  const unavailable =
    eligible &&
    !inactive &&
    !closed &&
    e.processing_status !== "ANALYSIS_COMPLETE" &&
    (data.ai?.status === "AI_NOT_CONFIGURED" ||
      (e.processing_status === "AI_NOT_CONFIGURED" &&
        data.ai?.status !== "READY"));
  async function annotate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (
      await action("/annotations", {
        kind: values.kind,
        fields: { [values.field]: values.value },
        note: values.note,
      })
    )
      form.reset();
  }
  async function verify(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    await action("/verify", { reason: values.reason });
  }
  return (
    <article className="analysis-card">
      <div className="analysis-heading">
        <a href={`/api${path}`} target="_blank" rel="noreferrer">
          <strong>{reviewer ? e.original_name : e.kind === "photo" ? "Product photo" : e.kind === "invoice" ? "Purchase receipt" : title(e.kind)}</strong>
        </a>
        <span
          className={
            "badge " + (e.trust_tier === "VERIFIED" ? "green" : "amber")
          }
        >
          {reviewer ? e.trust_tier : e.trust_tier === "VERIFIED" ? "Reviewed" : "Uploaded"}
        </span>
      </div>
      <CustomerPhotoScan evidence={{...e,claim_id:e.claim_id || claimId}} verification={verification} selectedModel={selectedModel} />
      <details open={reviewer} className="scan-technical-details"><summary>File and identification details</summary>
      <small>
        {title(e.kind)} · {Math.ceil(e.size / 1024)} KB{" "}
        {e.width ? `· ${e.width} × ${e.height}` : ""}{" "}
        {e.synthetic ? "· SYNTHETIC" : ""}
        {e.kind === "photo" &&
          (inactive ? " · Superseded photo" : " · Current photo")}
      </small>
      <p className="processing-state" role="status">
        {e.processing_status === "AI_NOT_CONFIGURED"
          ? "Automatic analysis unavailable"
          : e.processing_status}
      </p>
      {e.processing_message && !unavailable && <p>{e.processing_message}</p>}
      {verification && (
        <DeviceVerification
          result={verification}
          historical={inactive}
          evidence={e.original_name}
        />
      )}
      {!verification && !inactive && e.kind === "photo" && selectedModel && (
        <p>
          <strong>Selected model</strong> {selectedModel}
        </p>
      )}
      </details>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="success" role="status">
          {message}
        </div>
      )}
      {unavailable && (
        <section className="analysis-unavailable" role="status">
          <strong>Automatic analysis is not enabled</strong>
          <p>
            Your upload is saved. Add the missing details below, or continue
            with human review. A reviewer can inspect the original file.
          </p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              if (manualRef.current) {
                manualRef.current.open = true;
                manualRef.current.scrollIntoView?.({ block: "nearest" });
              }
            }}
          >
            Add information manually
          </button>
        </section>
      )}
      {eligible &&
        data.ai?.status === "READY" &&
        !closed &&
        !inactive &&
        e.processing_status !== "ANALYSIS_COMPLETE" && (
          <>
            <p className="muted">
              {data.ai?.provider === "LOCAL"
                ? "Local analysis runs on this computer. No image is sent to a paid AI service."
                : "Starting analysis sends a metadata-free image copy to Anthropic for extraction. The private original stays on this server."}
            </p>
            <button
              className="button small"
              disabled={busy || pending}
              onClick={() => action("/analyze", {})}
            >
              {pending
                ? e.processing_status === "ANALYSIS_QUEUED"
                  ? "Analysis queued…"
                  : "Analyzing…"
                : e.processing_status === "NOT_ANALYZED"
                  ? "Start evidence analysis"
                  : "Retry evidence analysis"}
            </button>
          </>
        )}
      {observations && (
        <div className="observations">
        {e.kind === "photo" && <ProductEvidenceReport evidence={e} reference={data.product_reference} />}
        <details className="scan-technical-details"><summary>{e.kind === "photo" ? "Readable extraction & audit details" : "Receipt scan report"}</summary>
          <h3>
            {e.trust_tier === "SIMULATED"
              ? "Simulated observations"
              : "Extracted observations"}
          </h3>
          {e.trust_tier !== "SIMULATED" && (
            <p className="muted">
              AI extraction can be wrong. An invoice is not independently
              verified by OCR. NOT VISIBLE does not establish the absence of
              hidden damage.
            </p>
          )}
          <dl>
            {Object.entries(observations)
              .filter(
                ([key,value]) =>
                  !["type", "original_text", "unknown_fields"].includes(key) && value != null && value !== "UNKNOWN" && value !== "NONE" && value !== "" && (!Array.isArray(value) || value.some(v => v !== "UNKNOWN" && v !== "NONE")),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{title(key)}</dt>
                  <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
                </div>
              ))}
          </dl>
          <p className="muted">Only readable observations are listed. Fields the scanner could not establish are left unset; catalog details never replace photo evidence.</p>
          {reviewer && <details><summary>Raw extraction record · reviewer audit</summary><pre>{JSON.stringify(observations,null,2)}</pre></details>}
          {observations.original_text && (
            <details>
              <summary>
                Original extracted invoice text · untrusted content
              </summary>
              <pre>{observations.original_text}</pre>
            </details>
          )}
          <small>
            Source: {e.source_reference} · prompt {e.prompt_version} ·{" "}
            {e.analyzed_at}
          </small>
        </details>
        </div>
      )}
      {data.annotations.length > 0 && (
        <div className="annotations">
          <h3>Provided information & correction requests</h3>
          {data.annotations.map((a) => (
            <div key={a.id}>
              <strong>{title(a.kind)} · ASSERTED</strong>
              {Object.entries(a.fields).map(([k, v]) => (
                <p key={k}>
                  {title(k)}: {v}
                </p>
              ))}
              <p>{a.note}</p>
            </div>
          ))}
        </div>
      )}
      {!closed && !inactive && !e.synthetic && (
        <details ref={manualRef} className="manual-details">
          <summary>Provide missing information or request a correction</summary>
          <p className="muted">Your details help the reviewer check the claim. They do not replace the original photo scan.</p>
          <form onSubmit={annotate}>
            <label>
              Request type
              <select name="kind">
                <option value="ASSERTION">Provide information</option>
                <option value="CORRECTION_REQUEST">Request correction</option>
              </select>
            </label>
            <label>
              Field
              <select name="field">
                {(e.kind === "invoice" ? invoiceFields : photoFields).map(
                  (f) => (
                    <option key={f} value={f}>
                      {title(f)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Your information
              <input name="value" required maxLength={1500} />
            </label>
            <label>
              Context / reason
              <textarea
                name="note"
                required
                minLength={5}
                maxLength={1500}
                rows={2}
              />
            </label>
            <button className="button small" disabled={busy || pending}>
              Save information
            </button>
          </form>
        </details>
      )}
      {reviewer &&
        !closed &&
        !inactive &&
        e.processing_status === "ANALYSIS_COMPLETE" &&
        e.trust_tier !== "VERIFIED" && (
          <details className="manual-details">
            <summary>Confirm observations as an authorized reviewer</summary>
            <p className="muted">
              Confirm only after checking the image or an authorized company
              record. This does not approve the warranty claim.
            </p>
            <form onSubmit={verify}>
              <label>
                Verification basis
                <textarea
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1500}
                />
              </label>
              <button className="button small" disabled={busy}>
                Confirm evidence as VERIFIED
              </button>
            </form>
          </details>
        )}
    </article>
  );
}
