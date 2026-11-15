import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import DeviceVerification from "./DeviceVerification";
const show = (v) =>
  v === null || v === undefined
    ? "UNKNOWN"
    : typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : String(v);
export default function EvidenceLedger({
  claimId,
  refreshKey,
  closed = false,
  reviewer = false,
  onChanged = async () => {},
}) {
  const [data, setData] = useState(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api(
      `/claims/${claimId}/ledger${selected ? "?investigation_id=" + selected : ""}`,
    ).then(setData);
  useEffect(() => {
    let active = true;
    api(
      `/claims/${claimId}/ledger${selected ? "?investigation_id=" + selected : ""}`,
    )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [claimId, selected, refreshKey]);
  async function rerun() {
    setBusy(true);
    setError("");
    try {
      await api(`/claims/${claimId}/investigate`, { method: "POST", body: {} });
      setSelected("");
      const latest = await api(`/claims/${claimId}/ledger`);
      setData(latest);
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function note(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await api(`/reviewer/claims/${claimId}/notes`, {
        method: "POST",
        body: { note: new FormData(form).get("note") },
      });
      form.reset();
      await load();
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="panel detail-panel">
        <h2>Evidence ledger</h2>
        {error ? (
          <div className="error" role="alert">
            {error}
          </div>
        ) : (
          <p>Loading recorded investigation…</p>
        )}
      </section>
    );
  const i = data.investigation,
    r = i.reconciliation;
  return (
    <section className="panel detail-panel ledger">
      <div className="section-title">
        <h2>Evidence ledger</h2>
        <span className="count">Engine {i.engineVersion}</span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <label>
        Recorded investigation
        <select
          value={selected || i.id}
          onChange={(e) => setSelected(e.target.value)}
        >
          {data.history.map((h) => (
            <option key={h.id} value={h.id}>
              {h.created_at} · v{h.engine_version} · {h.outcome} ·{" "}
              {h.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <p className="ledger-id">
        Investigation {i.id}
        <br />
        {i.created_at} UTC
      </p>
      <strong>{i.outcome}</strong>
      <p>{i.explanation}</p>
      <p className="muted">
        Automated recommendation is separate from the human claim decision.
        Historical snapshots are retained.
      </p>
      {!closed && (
        <button className="button small" onClick={rerun} disabled={busy}>
          {busy ? "Saving investigation…" : "Run new investigation"}
        </button>
      )}
      <h3>Next best evidence · highest priority first</h3>
      {i.nextEvidence.length ? (
        <ol>
          {i.nextEvidence.map((e) => (
            <li key={e.key}>
              <span className="count">{e.target}</span> {e.text}
            </li>
          ))}
        </ol>
      ) : (
        <p>No additional evidence requests were recorded in this snapshot.</p>
      )}
      <h3>Rule registry</h3>
      <div className="ledger-rules">
        {i.results.map((rule) => (
          <article key={rule.ruleId}>
            <div className="analysis-heading">
              <strong>
                {rule.ruleId} · {rule.status}
              </strong>
              <small>
                v{rule.ruleVersion} · {rule.severity} ·{" "}
                {rule.essential ? "essential" : "informational / conditional"}
              </small>
            </div>
            <p>{rule.reason}</p>
            <small>
              Evidence: {rule.evidenceIds.join(", ") || "No upload reference"}
              <br />
              Company records: {rule.recordIds.join(", ") || "None"}
            </small>
          </article>
        ))}
      </div>
      {reviewer && data.device_verification_history?.length > 0 && (
        <section>
          <h3>Device photo verification history</h3>
          {data.device_verification_history.map((result) => (
            <DeviceVerification
              key={result.id}
              result={result}
              historical={!result.active}
              evidence={
                <a
                  href={`/api/claims/${claimId}/evidence/${result.evidence_id}`}
                >
                  {result.evidence_name}
                </a>
              }
            />
          ))}
        </section>
      )}
      <h3>Supporting checks</h3>
      {(r.supporting || []).length ? (
        <ul>
          {r.supporting.map((x) => (
            <li key={x.ruleId}>
              {x.ruleId}: {x.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p>No supporting checks are recorded.</p>
      )}
      <h3>Contradictions requiring clarification</h3>
      {(r.contradictions || []).length ? (
        <ul>
          {r.contradictions.map((x) => (
            <li key={x.ruleId}>
              {x.ruleId}: {x.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No rule failure is recorded. This does not verify missing evidence.
        </p>
      )}
      <h3>Sources, original values & trust</h3>
      {r.facts?.length ? (
        <div className="ledger-facts">
          {r.facts.map((f) => (
            <details key={f.id}>
              <summary>
                {f.kind} · {f.source} · {f.trustTier}
              </summary>
              <small>
                Reference: {f.id}
                {f.evidenceId ? " · evidence " + f.evidenceId : ""}
              </small>
              <pre>{show(f.value)}</pre>
              {show(f.rawValue) !== show(f.value) && (
                <p>Original uncertain value: {show(f.rawValue)}</p>
              )}
            </details>
          ))}
        </div>
      ) : (
        <p>
          This legacy investigation has no reconciled value snapshot. Run the
          current engine to create one.
        </p>
      )}
      {reviewer && i.privateLinks?.length > 0 && (
        <div className="restricted-links">
          <h3>Restricted company linkage</h3>
          <p>Reviewer only. A match is a review signal, not an accusation.</p>
          {i.privateLinks.map((link, n) => (
            <p key={n}>
              {link.type} ·{" "}
              <Link className="text-link" to={"/claims/" + link.otherClaimId}>
                Linked claim {link.otherClaimId}
              </Link>{" "}
              · own evidence {link.evidenceId || "claim assertion"}
            </p>
          ))}
        </div>
      )}
      {reviewer && (
        <div>
          <h3>Internal investigation notes</h3>
          {data.notes?.map((n) => (
            <div className="internal-note" key={n.id}>
              <p>{n.note}</p>
              <small>{n.created_at} UTC</small>
            </div>
          ))}
          <form onSubmit={note}>
            <label>
              Written investigation note
              <textarea
                name="note"
                required
                minLength={10}
                maxLength={3000}
                rows={3}
              />
            </label>
            <button className="button small" disabled={busy}>
              Save internal note
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
