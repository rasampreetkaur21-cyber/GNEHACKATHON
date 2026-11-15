import {scanCategory,scanModel} from "../utils/scan";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../services/api";
const titles = {
  VALID_MATCH: "Model evidence match",
  DEVICE_MISMATCH: "Different supported model",
  INVALID_DEVICE: "Unsupported device",
  UNCLEAR_IMAGE: "Nayi photo chahiye",
  HUMAN_REVIEW: "Human review required",
};
export function DeviceCheckResult({ result, onRetry, busy = false, reviewer = false }) {
  if (!result) return null;
  const tone =
    result.status === "VALID_MATCH" && result.decision === "APPROVE"
      ? "green"
      : ["DEVICE_MISMATCH", "INVALID_DEVICE"].includes(result.status)
        ? "rose"
        : "amber";
  return (
    <section className={`device-check-result ${tone}`} aria-live="polite">
      <div className="section-title">
        <h2>{titles[result.status]}</h2>
        <span className={`badge ${tone}`}>{({VALID_MATCH:"Model check passed",DEVICE_MISMATCH:"Different model",INVALID_DEVICE:"Wrong photo",UNCLEAR_IMAGE:"Retake needed",HUMAN_REVIEW:"Review needed"})[result.status]}</span>
      </div>
      <p className="verification-decision">{result.claim_id ? "Photo result only — open your claim below for its final approval status." : "Photo check only. A claim needs purchase and warranty checks before approval."}</p>
      <p>{result.reason}</p>
      {result.local_assessment && (
        <div className="next-action">
          <strong>Local AI ne kya dekha?</strong>
          <p>
            Photo appears to show {scanCategory(result.local_assessment.category)}.
            {result.local_assessment.readable_model_candidate || result.local_assessment.other_model_text ? ` Readable model text: ${scanModel(result.local_assessment.readable_model_candidate) || result.local_assessment.other_model_text}.` : " The model label could not be read."}
          </p>
          <p>
            Category/visual suggestion exact device verification nahi hai.
            Device aur attached readable model label ek frame mein dikhayein.
          </p>
        </div>
      )}
      <div className="next-action">
        <strong>Ab kya karein?</strong>
        <p>{result.next_action}</p>
      </div>
      <details open={reviewer} className="scan-technical-details"><summary>How this check was assessed</summary><p><strong>{result.status}</strong> · {result.decision}</p>
      <dl>
        <div>
          <dt>Reason code</dt>
          <dd>{result.reason_code}</dd>
        </div>
        <div>
          <dt>Observed model</dt>
          <dd>{result.observed_model_id || "Not reliably established"}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>
            {result.confidence == null
              ? "Not calibrated / unavailable"
              : `${Math.round(result.confidence * 100)}%`}
          </dd>
        </div>
        <div>
          <dt>Authenticity result</dt>
          <dd>{result.authenticity}</dd>
        </div>
        <div>
          <dt>Origin</dt>
          <dd>{result.origin}</dd>
        </div>
      </dl>
      <p className="muted">
        Visible signals aur hashes se har AI-generated ya edited photo detect
        nahi hoti. REAL_UNVERIFIED ka matlab verified real nahi hai. Yeh result
        claim ka final human decision change nahi karta.
      </p>
      {result.claim_checks?.length > 0 && (
        <details>
          <summary>Server claim checks</summary>
          <ul>
            {result.claim_checks.map((c) => (
              <li key={c.id}>
                {c.id}: {c.status}
              </li>
            ))}
          </ul>
        </details>
      )}
      </details>
      <div className="verification-links">
        <a
          className="text-link"
          href={result.image_url}
          target="_blank"
          rel="noreferrer"
        >
          Saved photo dekhein ↗
        </a>
        {result.claim_id && (
          <Link className="text-link" to={`/claims/${result.claim_id}`}>
            Claim aur reviewer workflow →
          </Link>
        )}
        {result.analysis_error && onRetry && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={onRetry}
            type="button"
          >
            {busy ? "Retrying…" : "Retry saved photo"}
          </button>
        )}
      </div>
    </section>
  );
}
export default function VerifyDevice({ reviewer = false }) {
  const [params] = useSearchParams();
  const [provider, setProvider] = useState(null);
  const [catalog, setCatalog] = useState([]),
    [claims, setClaims] = useState([]),
    [checks, setChecks] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [brand, setBrand] = useState(""),
    [model, setModel] = useState(""),
    [claimId, setClaimId] = useState(params.get("claimId") || ""),
    [file, setFile] = useState(null),
    [inputKey, setInputKey] = useState(0),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null),
    [mode, setMode] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      api("/device-catalog"),
      api("/device-checks"),
      reviewer ? Promise.resolve({ claims: [] }) : api("/claims"),
    ])
      .then(([c, h, cl]) => {
        if (!active) return;
        setCatalog(c.products);
        setMode(c.analysis.status);
        setProvider(c.analysis.provider ?? null);
        setChecks(h.checks);
        setClaims(cl.claims);
        const selected = cl.claims.find((x) => x.id === params.get("claimId"));
        if (selected) {
          setModel(selected.catalog_id);
          setBrand(
            c.products.find((p) => p.model_id === selected.catalog_id)?.brand ||
              "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reviewer]);
  function resetPhoto() {
    setFile(null);
    setInputKey((k) => k + 1);
    setResult(null);
    setError("");
  }
  function selectClaim(id) {
    setClaimId(id);
    const c = claims.find((x) => x.id === id);
    if (c) {
      setModel(c.catalog_id);
      setBrand(catalog.find((p) => p.model_id === c.catalog_id)?.brand || "");
    }
    resetPhoto();
  }
  async function refresh() {
    setChecks((await api("/device-checks")).checks);
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!file) {
      setError("Exactly ek image choose karein.");
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("JPEG, PNG ya WebP image dein, maximum 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append("selected_model_id", model);
      if (claimId) data.append("claim_id", claimId);
      data.append("image", file);
      const saved = await api("/device-checks", { method: "POST", body: data });
      setResult(saved);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(check = result) {
    setBusy(true);
    setError("");
    try {
      setResult(
        await api(`/device-checks/${check.id}/retry`, {
          method: "POST",
          body: {},
        }),
      );
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            ONE PRODUCT · ONE PHOTO · CLEAR NEXT STEP
          </div>
          <h1>
            {reviewer ? "Photo review queue" : "Verify your product photo"}
          </h1>
          <p>
            Product select karein. Ek clear photo upload karein. Model aur
            authenticity signals alag check honge.
          </p>
        </div>
      </div>
      {loading ? (
        <p role="status">Verification workspace load ho raha hai…</p>
      ) : (
        <>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {!reviewer && (
            <div className="verification-layout">
              <form className="panel detail-panel" onSubmit={submit}>
                <fieldset disabled={busy}>
                  <legend>Product & image</legend>
                  <label>
                    Related claim · optional
                    <select
                      value={claimId}
                      onChange={(e) => selectClaim(e.target.value)}
                    >
                      <option value="">
                        Photo check only — no claim approval
                      </option>
                      {claims
                        .filter((c) =>
                          catalog.some((p) => p.model_id === c.catalog_id),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.model} · {c.id.slice(0, 8)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Company
                    <select
                      required
                      disabled={busy || !!claimId}
                      value={brand}
                      onChange={(e) => {
                        setBrand(e.target.value);
                        setModel("");
                        resetPhoto();
                      }}
                    >
                      <option value="">Choose a company</option>
                      {[...new Set(catalog.map((p) => p.brand))].map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Selected product
                    <select
                      required
                      disabled={busy || !!claimId || !brand}
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        resetPhoto();
                      }}
                    >
                      <option value="">Choose one model</option>
                      {catalog
                        .filter((p) => p.brand === brand)
                        .map((p) => (
                          <option key={p.model_id} value={p.model_id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="single-photo-input">
                    Upload exactly one image
                    <input
                      key={inputKey}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      required
                      onChange={(e) => {
                        setFile(e.target.files[0] || null);
                        setResult(null);
                        setError("");
                      }}
                    />
                    <small>
                      JPEG, PNG, WebP · maximum 5 MB · no PDF or multiple images
                    </small>
                  </label>
                  {file ? (
                    <p>
                      {file.name} · {Math.ceil(file.size / 1024)} KB selected
                    </p>
                  ) : (
                    <p className="muted">
                      Abhi koi photo select nahi hui. Device aur attached model
                      label/About screen ek frame mein dikhayein.
                    </p>
                  )}
                  <p className="muted">
                    {provider === "LOCAL"
                      ? "Local mode mein photo isi computer par analyse hoti hai. Paid AI API par nahi bheji jaati."
                      : "Analysis metadata-free photo ko configured Anthropic service par bhejti hai."}{" "}
                    GPS/EXIF analysis copy mein remove hote hain.
                  </p>
                  <button className="button" disabled={busy || !model || !file}>
                    {busy
                      ? "Photo check ho rahi hai…"
                      : "Check selected product"}
                  </button>
                  {busy && (
                    <p role="status">
                      Upload validate ho raha hai; identity aur authenticity
                      signals check ho rahe hain.
                    </p>
                  )}
                </fieldset>
              </form>
              <aside className="helper-card">
                <h3>Approval needs more than a match</h3>
                <p>
                  Visual resemblance se exact model verify nahi hota. Linked
                  readable identifier zaroori hai.
                </p>
                <p>
                  APPROVE tabhi milega jab attached claim ke sab configured
                  checks PASS hon aur detected authenticity concern na ho.
                </p>
                <hr />
                <p>
                  Analysis service: <strong>{mode}</strong>
                </p>
                {mode !== "READY" && (
                  <p>
                    AI unavailable hone par photo save hogi aur human-review
                    result milega. Fake match ya approval nahi diya jayega.
                  </p>
                )}
              </aside>
            </div>
          )}
          <DeviceCheckResult
            result={result}
            onRetry={() => retry(result)}
            busy={busy}
          />
          <section className="panel detail-panel verification-history">
            <h2>
              {reviewer
                ? "Saved evidence needing assessment"
                : "Recent photo checks"}
            </h2>
            {checks.length === 0 ? (
              <p>
                No checks yet. Pehli photo submit karne ke baad result yahan
                dikhega.
              </p>
            ) : (
              checks.map((c) => (
                <details key={c.id}>
                  <summary>
                    {catalog.find((p) => p.model_id === c.selected_model_id)
                      ?.name || c.selected_model_id}{" "}
                    · {c.status} · {c.decision}
                  </summary>
                  <DeviceCheckResult
                    reviewer={reviewer}
                    result={c}
                    onRetry={reviewer ? undefined : () => retry(c)}
                    busy={busy}
                  />
                </details>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}
