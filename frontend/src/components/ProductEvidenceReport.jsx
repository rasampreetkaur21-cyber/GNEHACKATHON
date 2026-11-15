import React from "react";
import { scanCategory, scanModel } from "../utils/scan";
const readable = v => typeof v === "string" && v.trim() && !["UNKNOWN", "NONE", "NOT_VISIBLE", "UNREADABLE"].includes(v.toUpperCase());
export default function ProductEvidenceReport({ evidence, reference }) {
  const o = evidence.observations || {}, r = evidence.scan_report || {};
  const model = scanModel(r.readable_model_candidate) || r.other_model_text || (readable(o.observed_model_text) ? o.observed_model_text : readable(o.model_text) ? o.model_text : null);
  const serial = readable(o.serial_text) ? o.serial_text : null;
  const legacyCategory = typeof o.device_category === "string" ? o.device_category.toLowerCase() : "";
  const knownCategories = ["phone","headphones","laptop","tablet","mug","scenery","document","packaging","screenshot","indoor_scene","people","furniture","vehicle","animal"];
  const category = r.category || (legacyCategory === "mobile phone" ? "phone" : knownCategories.includes(legacyCategory) ? legacyCategory : null);
  const quality = r.quality || o.image_quality;
  const compatible = category && reference && category === reference.category;
  return <section className="product-evidence-report">
    {reference && <div className="product-reference-card">
      <span className="eyebrow">Selected product · dataset reference</span>
      <h3>{reference.name}</h3>
      <p>{reference.brand} · {reference.category === "phone" ? "Mobile phone" : "Headphones"}</p>
      <p className="muted">{reference.limitation}</p>
      <details><summary>View dataset source & coverage</summary>
        <p>Source: {reference.source}</p>
        <p>{reference.total_assets} related dataset assets:</p>
        <ul>{Object.entries(reference.asset_origins).map(([origin, count]) => <li key={origin}>{origin.replaceAll("_", " ")}: {count}</li>)}</ul>
        <p>Dataset coverage is not a recognition accuracy score. Synthetic assets are test examples.</p>
        <a href={reference.reference_url} target="_blank" rel="noreferrer">Product source listed in dataset ↗</a>
      </details>
    </div>}
    <h3>What your photo tells us</h3>
    <dl>
      <div><dt>Product category</dt><dd>{category ? `${scanCategory(category)}${compatible ? " — consistent with the selected product category" : ""}` : "Not established from this photo"}</dd></div>
      <div><dt>Model text in photo</dt><dd>{model || "No readable model identifier found"}{model && " · text reading only; device linkage still needs confirmation"}</dd></div>
      <div><dt>Serial in photo</dt><dd>{serial || "No readable serial number found"}</dd></div>
      <div><dt>Photo quality</dt><dd>{quality === "CLEAR" ? "Clear enough for the initial scan; model-label readability is checked separately" : readable(quality) ? quality.replaceAll("_", " ").toLowerCase() : "Not assessed"}</dd></div>
      <div><dt>Damage & authenticity</dt><dd>Requires reviewer inspection. Category recognition and OCR do not verify cracks, liquid damage, tampering or whether an image is genuine.</dd></div>
    </dl>
    <div className="notice"><strong>{model ? "Next check: confirm model linkage" : "Next step: show the model identifier"}</strong><p>{reference?.label_hint || "Upload the actual device with its readable model label in the same photo."}</p><p className="muted">A clear product photo alone cannot establish warranty eligibility. Receipt and claim checks are reviewed separately.</p></div>
  </section>;
}
