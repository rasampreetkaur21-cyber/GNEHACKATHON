import React from "react";

const statuses = {
  MATCH: { label: "Match", color: "green" },
  INVALID_DEVICE: { label: "Invalid device", color: "rose" },
  UNVERIFIED: { label: "Unverified", color: "amber" },
};
const sources = {
  LABEL: "Factory label or engraving",
  ABOUT_SCREEN: "Device About screen",
  BOX: "Packaging",
  NONE: "No device identifier visible",
};

export default function DeviceVerification({
  result,
  historical = false,
  evidence,
}) {
  const { label, color } = statuses[result.status];
  const source = sources[result.evidence_basis.identifying_evidence_kind];
  return (
    <section className="observations" aria-label="Device verification">
      <div className="analysis-heading">
        <h3>
          {historical
            ? "Historical device verification"
            : "Device verification"}
        </h3>
        <span className={`badge ${color}`}>{label}</span>
      </div>
      {result.prompt_version === "synthetic-rules-v2" && (
        <p>Simulated rules fixture</p>
      )}
      <dl>
        <div>
          <dt>Selected model</dt>
          <dd>{result.selected_model}</dd>
        </div>
        <div>
          <dt>Observed model</dt>
          <dd>{result.observed_model || "Unknown"}</dd>
        </div>
        {result.observed_brand && (
          <div>
            <dt>Observed brand</dt>
            <dd>{result.observed_brand}</dd>
          </div>
        )}
        <div>
          <dt>Evidence</dt>
          <dd>
            {source || "No usable identification evidence"}
            {evidence && <> · {evidence}</>}
          </dd>
        </div>
      </dl>
      <p>{result.reason}</p>
      <p>
        <strong>Next step</strong> {result.next_action}
      </p>
    </section>
  );
}
