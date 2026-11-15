import ProblemQuestions, { emptyAnswers } from "../components/ProblemQuestions";
import {
  changeAnswer,
  summarize,
  questionnaireErrors,
} from "../../../shared/questionnaire.js";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/Auth";
import { api } from "../services/api";
import { amount } from "../utils/money";
import EvidenceUpload from "../components/EvidenceUpload";
import EvidenceAnalysis from "../components/EvidenceAnalysis";
import EvidenceLedger from "../components/EvidenceLedger";
import {
  BrandSelect,
  ModelFields,
  selectedDevice,
} from "../components/DeviceFields";
import { getCatalogItem } from "../../../backend/src/catalog.js";
const states = [
  "GREETING",
  "PRODUCT_SELECTION",
  "PRODUCT_DETAILS",
  "PURCHASE_DETAILS",
  "ISSUE_DESCRIPTION",
  "INVOICE_UPLOAD",
  "PHOTO_UPLOAD",
  "EVIDENCE_CHECK",
  "CLAIM_CONFIRMATION",
  "CLAIM_SUBMISSION",
  "STATUS_DISPLAY",
];
function message(text) {
  try {
    const value = JSON.parse(text);
    if (value.action)
      return (
        {
          BEGIN: "Let’s get started.",
          CONTINUE: "Continue with the supplied evidence.",
          SKIP: "Skip this document for now.",
          RECHECK: "Recheck my saved evidence.",
          SUBMIT: "Submit my confirmed claim.",
          CHECK_STATUS: "Check my current claim status.",
        }[value.action] + (value.claim_id ? " " + value.claim_id : "")
      );
    if (value.confirmed === true) return "I confirm these claim details.";
    return Object.entries(value)
      .map(([k, v]) =>
        k === "claim_value_minor"
          ? `Requested amount: ${amount(v)}`
          : k === "catalog_id"
            ? `Model: ${getCatalogItem(v)?.model || v}`
            : `${k.replaceAll("_", " ")}: ${v === null ? "UNKNOWN" : typeof v === "boolean" ? (v ? "Yes" : "No") : v}`,
      )
      .join("\n");
  } catch {
    return text;
  }
}
export default function InvestigatorChat() {
  const { user } = useAuth();
  const key = "claimshield-chat-" + user.id;
  const [sessions, setSessions] = useState([]),
    [session, setSession] = useState(null),
    [files, setFiles] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState("");
  const [answers, setAnswers] = useState(emptyAnswers);
  const [summaryEdit, setSummaryEdit] = useState(null);
  useEffect(() => {
    setAnswers(emptyAnswers());
    setSummaryEdit(null);
  }, [session?.id, session?.data.catalog_id]);
  async function refresh(id = session?.id) {
    if (!id) return;
    const next = await api("/chat/sessions/" + id);
    setBrand(next.data.brand || "");
    setSession(next);
    localStorage.setItem(key, id);
    if (next.claim) setFiles((await api("/claims/" + next.claim.id)).evidence);
  }
  useEffect(() => {
    let active = true;
    api("/chat/sessions")
      .then(async (d) => {
        if (!active) return;
        setSessions(d.sessions);
        const saved = localStorage.getItem(key);
        const id = d.sessions.some((s) => s.id === saved)
          ? saved
          : d.sessions[0]?.id;
        if (id) await refresh(id);
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
  }, [key]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const next = await api("/chat/sessions", { method: "POST", body: {} });
      setBrand("");
      setSession(next);
      setFiles([]);
      localStorage.setItem(key, next.id);
      setSessions((await api("/chat/sessions")).sessions);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function send(input) {
    setBusy(true);
    setError("");
    try {
      await api(`/chat/sessions/${session.id}/messages`, {
        method: "POST",
        body: {
          requestId: crypto.randomUUID(),
          revision: session.revision,
          input,
        },
      });
      await refresh();
      setSessions((await api("/chat/sessions")).sessions);
    } catch (e) {
      setError(e.message);
      if (e.message.includes("Reload")) await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    if (
      session.state === "PRODUCT_DETAILS" &&
      !selectedDevice(session.data.brand, raw.catalog_id)
    ) {
      setError("Choose a supported model from the selected brand.");
      return;
    }
    if (session.state === "PURCHASE_DETAILS") {
      raw.claim_value_minor = null;
      delete raw.claim_value_rupees;
      raw.currency = "INR";
    }
    if (session.state === "ISSUE_DESCRIPTION") {
      const errors = questionnaireErrors(
        getCatalogItem(session.data.catalog_id)?.category,
        answers,
      );
      if (errors.length) {
        setError(errors.join(" "));
        return;
      }
      raw.questionnaire = answers;
      raw.statement =
        summaryEdit ??
        summarize(getCatalogItem(session.data.catalog_id).category, answers);
      raw.previous_repairs = 0;
      for (const k of [
        "declared_no_visible_damage",
        "declared_unauthorized_repairs",
      ])
        raw[k] = raw[k] === "" ? null : raw[k] === "true";
    }
    if (session.state === "CLAIM_CONFIRMATION")
      return send({ confirmed: true });
    if (session.state === "STATUS_DISPLAY")
      return send({
        action: "CHECK_STATUS",
        ...(raw.claim_id ? { claim_id: raw.claim_id } : {}),
      });
    return send(raw);
  }
  if (loading) return <p>Loading your saved conversations…</p>;
  const state = session?.state;
  const { catalog_id, ...summary } = session?.data || {};
  if (catalog_id && session.claim) {
    summary.product = session.claim.product;
    summary.model = session.claim.model;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVIDENCE-LED WARRANTY ASSISTANT</div>
          <h1>Let’s build a clear claim.</h1>
          <p>
            Guided questions, secure evidence, and the same investigation
            engine.
          </p>
        </div>
        <button className="button small" onClick={create} disabled={busy}>
          New conversation
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {sessions.length > 0 && (
        <label className="chat-selector">
          Your saved conversations
          <select
            value={session?.id || ""}
            onChange={(e) =>
              refresh(e.target.value).catch((e) => setError(e.message))
            }
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.updated_at} · {s.state.replaceAll("_", " ").toLowerCase()} ·{" "}
                {s.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!session ? (
        <div className="panel empty">
          <h2>Your details stay in your workspace.</h2>
          <p>
            Start a guided conversation to collect details and prepare a claim
            for your confirmation.
          </p>
          <button className="button" onClick={create} disabled={busy}>
            Begin a conversation
          </button>
        </div>
      ) : (
        <>
          <div className="info-banner">
            <div>
              <strong>
                {session.mode === "LIMITED_MODE"
                  ? "LIMITED MODE · structured assistant"
                  : "Structured assistant · Vision available on request"}
              </strong>
              <p>
                Essential actions use validated backend transitions.{" "}
                {session.mode === "LIMITED_MODE"
                  ? "Claude is unavailable; uploads, manual information, rules and submission still work."
                  : "Image analysis uses your configured provider and existing usage limits."}{" "}
                No conversational model can approve a claim or change policies.
              </p>
            </div>
          </div>
          <div className="chat-layout">
            <section className="panel detail-panel">
              <div className="section-title">
                <h2>Conversation</h2>
                <span className="count">
                  {states.indexOf(state) + 1} / {states.length}
                </span>
              </div>
              <div className="chat-messages" aria-label="Saved conversation">
                {session.messages.map((m) => (
                  <div key={m.id} className={"chat-message " + m.role}>
                    <small>
                      {m.role === "assistant" ? "ClaimShield assistant" : "You"}
                    </small>
                    <p>{message(m.content)}</p>
                  </div>
                ))}
              </div>
              <div className="current-question">
                <span className="eyebrow">{state.replaceAll("_", " ")}</span>
                <p>{session.prompt}</p>
              </div>
              <form key={session.id + state} onSubmit={submit}>
                <fieldset disabled={busy}>
                  {state === "PRODUCT_SELECTION" && (
                    <BrandSelect
                      value={brand}
                      onChange={(event) => setBrand(event.target.value)}
                    />
                  )}
                  {state === "PRODUCT_DETAILS" && (
                    <>
                      <ModelFields brand={session.data.brand} />
                      <label>
                        Serial number
                        <input
                          name="serial"
                          required
                          minLength={3}
                          maxLength={100}
                          placeholder="Printed serial or UNKNOWN"
                        />
                      </label>
                    </>
                  )}
                  {state === "PURCHASE_DETAILS" && (
                    <>
                      <label>
                        Purchase date · YYYY-MM-DD or UNKNOWN
                        <input
                          name="purchase_date"
                          required
                          defaultValue="UNKNOWN"
                          maxLength={10}
                        />
                      </label>
                      <input
                        type="hidden"
                        name="incident_date"
                        value="UNKNOWN"
                      />
                    </>
                  )}
                  {state === "ISSUE_DESCRIPTION" && (
                    <>
                      <ProblemQuestions
                        category={
                          getCatalogItem(session.data.catalog_id)?.category
                        }
                        answers={answers}
                        onChange={(k, v) =>
                          setAnswers((old) => changeAnswer(old, k, v))
                        }
                      />
                      <label>
                        Review and edit your incident summary
                        <textarea
                          required
                          minLength={20}
                          maxLength={5000}
                          rows={7}
                          value={
                            summaryEdit ??
                            summarize(
                              getCatalogItem(session.data.catalog_id).category,
                              answers,
                            )
                          }
                          onChange={(e) => setSummaryEdit(e.target.value)}
                        />
                      </label>
                      {summaryEdit !== null && (
                        <p>
                          Your edits are preserved. Check the summary after
                          changing answers.
                        </p>
                      )}
                    </>
                  )}
                  {state === "CLAIM_CONFIRMATION" && (
                    <label className="confirm-checkbox">
                      <input type="checkbox" required />I confirm the displayed
                      claim details and want to continue to submission.
                    </label>
                  )}
                  {state === "STATUS_DISPLAY" && (
                    <label>
                      Check one of your submitted claim IDs · optional
                      <input name="claim_id" placeholder={session.claim?.id} />
                    </label>
                  )}
                  {[
                    "PRODUCT_SELECTION",
                    "PRODUCT_DETAILS",
                    "PURCHASE_DETAILS",
                    "ISSUE_DESCRIPTION",
                    "CLAIM_CONFIRMATION",
                    "STATUS_DISPLAY",
                  ].includes(state) && (
                    <button className="button" disabled={busy}>
                      {busy
                        ? "Saving…"
                        : state === "STATUS_DISPLAY"
                          ? "Check real claim status"
                          : state === "CLAIM_CONFIRMATION"
                            ? "Confirm details"
                            : "Continue"}
                    </button>
                  )}
                </fieldset>
              </form>
              <div className="chat-actions">
                {state === "GREETING" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => send({ action: "BEGIN" })}
                  >
                    Begin
                  </button>
                )}
                {["INVOICE_UPLOAD", "PHOTO_UPLOAD"].includes(state) && (
                  <>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => send({ action: "CONTINUE" })}
                    >
                      Continue with uploaded evidence
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => send({ action: "SKIP" })}
                    >
                      Skip for now
                    </button>
                  </>
                )}
                {state === "EVIDENCE_CHECK" && (
                  <>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => send({ action: "RECHECK" })}
                    >
                      Recheck evidence
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => send({ action: "CONTINUE" })}
                    >
                      Review claim details
                    </button>
                  </>
                )}
                {state === "CLAIM_SUBMISSION" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => send({ action: "SUBMIT" })}
                  >
                    {busy ? "Submitting…" : "Submit claim to reviewers"}
                  </button>
                )}
              </div>
            </section>
            <div>
              {session.claim && (
                <section className="panel detail-panel">
                  <h2>
                    {session.claim.is_draft
                      ? "Private draft · not submitted"
                      : "Submitted claim"}
                  </h2>
                  <p className="ledger-id">{session.claim.id}</p>
                  {state === "STATUS_DISPLAY" && (
                    <>
                      <strong>
                        Current human-review status: {session.claim.status}
                      </strong>
                      <p>
                        <Link
                          className="text-link"
                          to={"/claims/" + session.claim.id}
                        >
                          Open claim and evidence ledger →
                        </Link>
                      </p>
                    </>
                  )}
                  <dl className="chat-summary">
                    {Object.entries(summary).map(([k, v]) => (
                      <div key={k}>
                        <dt>
                          {k === "claim_value_minor"
                            ? "Requested amount"
                            : k.replaceAll("_", " ")}
                        </dt>
                        <dd>
                          {k === "claim_value_minor"
                            ? amount(v)
                            : v === null
                              ? "UNKNOWN"
                              : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {session.claim &&
                [
                  "INVOICE_UPLOAD",
                  "PHOTO_UPLOAD",
                  "EVIDENCE_CHECK",
                  "CLAIM_CONFIRMATION",
                ].includes(state) && (
                  <section className="panel detail-panel">
                    <h2>Secure evidence</h2>
                    <EvidenceUpload
                      key={state}
                      claimId={session.claim.id}
                      kind={state === "INVOICE_UPLOAD" ? "invoice" : "photo"}
                      currentPhoto={files.find(
                        (e) =>
                          e.claim_id === session.claim.id &&
                          e.kind === "photo" &&
                          e.active !== 0,
                      )}
                      selectedModel={session.claim.model}
                      onUploaded={() => refresh()}
                    />
                    {files
                      .filter((e) => e.claim_id === session.claim.id)
                      .map((e) => (
                        <EvidenceAnalysis
                          key={e.id}
                          claimId={session.claim.id}
                          evidence={e}
                          closed={false}
                          reviewer={false}
                          selectedModel={session.claim.model}
                          onChanged={() => refresh()}
                        />
                      ))}
                  </section>
                )}
            </div>
          </div>
          {session.claim &&
            [
              "EVIDENCE_CHECK",
              "CLAIM_CONFIRMATION",
              "CLAIM_SUBMISSION",
              "STATUS_DISPLAY",
            ].includes(state) && (
              <EvidenceLedger
                claimId={session.claim.id}
                refreshKey={session.investigation?.id}
                closed={["APPROVED", "REJECTED"].includes(session.claim.status)}
                onChanged={() => refresh()}
              />
            )}
        </>
      )}
    </>
  );
}
