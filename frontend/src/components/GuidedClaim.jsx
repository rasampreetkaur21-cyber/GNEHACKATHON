import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { catalog, getCatalogItem } from "../../../backend/src/catalog.js";
import {
  changeAnswer,
  summarize,
  questionnaireErrors,
  evidenceRequests,
} from "../../../shared/questionnaire.js";
import ProblemQuestions, { emptyAnswers } from "./ProblemQuestions";
import { api, uploadEvidence } from "../services/api";
const steps = [
  "Product Details",
  "Describe the Problem",
  "Evidence",
  "Review & Submit",
];
export default function GuidedClaim() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0),
    [product, setProduct] = useState({
      catalog_id: "",
      serial: "",
      purchase_date: "",
      unknownPurchase: false,
      unknownSerial: false,
    });
  const [a, setA] = useState(emptyAnswers),
    [edited, setEdited] = useState(null),
    [files, setFiles] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [brand, setBrand] = useState("");
  const [requestKey] = useState(() => crypto.randomUUID());
  const titleRef = useRef(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    document.scrollingElement?.scrollTo?.({ top: 0, behavior: "instant" });
  }, [step]);
  const device = getCatalogItem(product.catalog_id),
    category = device?.category || "";
  const generated = summarize(category, a),
    statement = edited ?? generated;
  function answer(k, v) {
    setA((old) => changeAnswer(old, k, v));
    if (["issue", "repairs", "damage", "serviceRecord"].includes(k))
      setFiles({});
  }
  function detail(k, v) {
    setProduct((old) => ({ ...old, [k]: v }));
  }
  function next(e) {
    e.preventDefault();
    setError("");
    if (step === 1) {
      const errors = questionnaireErrors(category, a);
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
    }
    setStep((s) => s + 1);
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const selected = Object.entries(files).filter(([, file]) => file);
      if (selected.some(([, f]) => f.size > 5 * 1024 * 1024))
        throw new Error("Each file must be 5 MB or smaller.");
      const body = {
        catalog_id: product.catalog_id,
        serial: product.unknownSerial ? "UNKNOWN" : product.serial,
        purchase_date: product.unknownPurchase
          ? "UNKNOWN"
          : product.purchase_date,
        incident_date:
          a.exactDate ||
          (a.noticed === "Today"
            ? new Date().toISOString().slice(0, 10)
            : "UNKNOWN"),
        previous_repairs: 0,
        statement,
        questionnaire: a,
        claim_value_minor: null,
        currency: "INR",
        declared_no_visible_damage: null,
        declared_unauthorized_repairs: null,
      };
      const saved = await api("/claims", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": requestKey },
      });
      let uploadError = "";
      for (const [key, file] of selected) {
        const data = new FormData();
        data.append("kind", key.split(":")[0]);
        data.append("file", file);
        try {
          await uploadEvidence(saved.id, data, (p) =>
            setProgress(
              `${file.name}: ${p}% transmitted; awaiting confirmation`,
            ),
          );
        } catch (err) {
          uploadError += `${file.name}: ${err.message} `;
        }
      }
      navigate("/claims/" + saved.id, {
        state: {
          uploadError: uploadError
            ? "Claim saved. Retry missing uploads below. " + uploadError
            : "",
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/dashboard" className="quiet">
        ← Back to overview
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WARRANTY, CLEARLY DOCUMENTED</div>
          <h1>Let’s prepare your claim</h1>
          <p>
            Tell us what you know. Missing details can be reviewed by a person.
          </p>
        </div>
      </div>
      <ol className="claim-progress" aria-label="Claim progress">
        {steps.map((title, i) => (
          <li
            key={title}
            aria-current={step === i ? "step" : undefined}
            className={i <= step ? "active" : ""}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {title}
          </li>
        ))}
      </ol>
      <div className="form-layout">
        <form
          className="panel form-panel"
          onSubmit={step === 3 ? submit : next}
        >
          <fieldset disabled={busy} className="wizard-body">
            <legend ref={titleRef} tabIndex={-1} className="wizard-title">
              {steps[step]}
            </legend>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {step === 0 && (
              <>
                <label>
                  Company
                  <select required value={brand} onChange={(e) => {
                    setBrand(e.target.value);
                    detail("catalog_id", "");
                    setA(emptyAnswers());
                    setFiles({});
                  }}>
                    <option value="">Choose a company</option>
                    {[...new Set(catalog.map(d => d.brand))].map(name => <option key={name}>{name}</option>)}
                  </select>
                </label>
                <label>
                  Product model
                  <select
                    required
                    disabled={!brand}
                    value={product.catalog_id}
                    onChange={(e) => {
                      detail("catalog_id", e.target.value);
                      setA(emptyAnswers());
                      setFiles({});
                    }}
                  >
                    <option value="">{brand ? "Choose a model" : "Choose a company first"}</option>
                    {catalog.filter(d => d.brand === brand).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.model} · {d.category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Serial number
                  <input
                    required={!product.unknownSerial}
                    disabled={product.unknownSerial}
                    minLength={3}
                    maxLength={100}
                    value={product.serial}
                    onChange={(e) => detail("serial", e.target.value)}
                  />
                </label>
                <label className="answer">
                  <input
                    type="checkbox"
                    checked={product.unknownSerial}
                    onChange={(e) => detail("unknownSerial", e.target.checked)}
                  />
                  Serial is unreadable or unknown
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    required={!product.unknownPurchase}
                    disabled={product.unknownPurchase}
                    max={new Date().toISOString().slice(0, 10)}
                    value={product.purchase_date}
                    onChange={(e) => detail("purchase_date", e.target.value)}
                  />
                </label>
                <label className="answer">
                  <input
                    type="checkbox"
                    checked={product.unknownPurchase}
                    onChange={(e) =>
                      detail("unknownPurchase", e.target.checked)
                    }
                  />
                  I don’t know the purchase date
                </label>
              </>
            )}
            {step === 1 && (
              <ProblemQuestions
                category={category}
                answers={a}
                onChange={answer}
              />
            )}
            {step === 2 && (
              <>
                <p>
                  These items can help a reviewer. You may continue without
                  them. JPEG, PNG or WebP; documents may also be PDF. Maximum 5
                  MB each.
                </p>
                {evidenceRequests(a).map(([kind, title, why], i) => {
                  const key = kind + ":" + title;
                  return (
                    <label key={key}>
                      {title}
                      <small>{why}</small>
                      <input
                        key={key}
                        type="file"
                        accept={
                          kind === "photo"
                            ? "image/jpeg,image/png,image/webp"
                            : "image/jpeg,image/png,image/webp,application/pdf"
                        }
                        onChange={(e) =>
                          setFiles((old) => ({
                            ...old,
                            [key]: e.target.files[0],
                          }))
                        }
                      />
                      {files[key] && <small>Selected: {files[key].name}</small>}
                    </label>
                  );
                })}
                <p className="muted">
                  No invoice? Leave it empty. Evidence and AI analysis can be
                  added after submission; neither is required to send your claim
                  for review.
                </p>
              </>
            )}
            {step === 3 && (
              <>
                <p>
                  <strong>
                    {device?.brand} {device?.model}
                  </strong>{" "}
                  · {product.unknownSerial ? "Serial unknown" : product.serial}
                </p>
                <p>
                  Purchase:{" "}
                  {product.unknownPurchase ? "Unknown" : product.purchase_date}
                </p>
                <label>
                  Incident summary · edit before submitting
                  <textarea
                    rows={9}
                    minLength={20}
                    maxLength={5000}
                    required
                    value={statement}
                    onChange={(e) => setEdited(e.target.value)}
                  />
                </label>
                {edited !== null && (
                  <p role="status">
                    Your edited summary is preserved when answers change. Check
                    that it still matches your answers.
                  </p>
                )}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    if (
                      edited === null ||
                      window.confirm(
                        "Replace your edited summary with the current answers?",
                      )
                    )
                      setEdited(null);
                  }}
                >
                  Regenerate summary from answers
                </button>
                <p>
                  {Object.values(files).filter(Boolean).length} optional files
                  selected. All answers are customer-reported and have not been
                  independently verified.
                </p>
                <label className="answer">
                  <input type="checkbox" required />I have reviewed the details
                  and want to submit this claim.
                </label>
              </>
            )}
            <div className="form-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setStep((s) => s - 1);
                    setError("");
                  }}
                >
                  ← Back
                </button>
              )}
              <button className="button" disabled={busy}>
                {busy
                  ? "Saving your claim…"
                  : step === 3
                    ? "Submit claim"
                    : "Continue →"}
              </button>
            </div>
            {progress && <p role="status">{progress}</p>}
          </fieldset>
        </form>
        <aside className="helper-card">
          <div className="eyebrow">A FAIR REVIEW STARTS HERE</div>
          <h3>Only what you know</h3>
          <p>
            “Not sure” is a valid answer. Your account helps guide the
            investigation; a reviewer checks it against the available evidence.
          </p>
          <hr />
          <h3>Safety comes first</h3>
          <p>
            If the product is overheating, damaged or appears unsafe, stop using
            it and contact qualified support. Do not open it.
          </p>
          <hr />
          <p>Your uploads stay private to you and authorized reviewers.</p>
        </aside>
      </div>
    </>
  );
}

