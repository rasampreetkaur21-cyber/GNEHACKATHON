import { useState } from "react";
import { uploadEvidence } from "../services/api";
export default function EvidenceUpload({
  claimId,
  kind = "photo",
  currentPhoto,
  selectedModel,
  allowReplacement = true,
  includeDocuments = false,
  onUploaded,
}) {
  const [selectedKind, setSelectedKind] = useState(kind);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(null),
    [error, setError] = useState("");
  const photo = selectedKind === "photo";
  const replacing = photo && !!currentPhoto;
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const data = new FormData(form);
      if (replacing) data.set("replaces", currentPhoto.id);
      await uploadEvidence(claimId, data, setProgress);
      form.reset();
      await onUploaded();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  return (
    <form className="guided-upload" onSubmit={submit}>
      <p className="muted">
        Private uploads, up to 5 MB each and six active images per claim.
      </p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <label>
        What are you uploading?
        <select
          name="kind"
          value={selectedKind}
          onChange={(event) => setSelectedKind(event.target.value)}
          disabled={busy}
        >
          <option value="photo">Product photo / model label</option>
          <option value="invoice">Purchase invoice</option>
          {includeDocuments && (
            <>
              <option value="service_record">Service record</option>
              <option value="warranty">Warranty document</option>
            </>
          )}
        </select>
      </label>
      {photo && selectedModel && (
        <p>
          <strong>Selected model</strong> {selectedModel}
        </p>
      )}
      {replacing && (
        <p className="muted">
          {allowReplacement
            ? "Use a fresh photo. Your previous photo stays in the claim history."
            : "The claim owner can replace the current photo."}
        </p>
      )}
      <label>
        {photo ? "JPEG, PNG or WebP" : "JPEG, PNG, WebP or manual-review PDF"}
        <input
          name="file"
          type="file"
          accept={
            photo
              ? "image/jpeg,image/png,image/webp"
              : "image/jpeg,image/png,image/webp,application/pdf"
          }
          required
          disabled={busy || (replacing && !allowReplacement)}
        />
      </label>
      {progress !== null && (
        <div role="status">
          <progress value={progress} max="100" />
          {progress}% transmitted; awaiting server confirmation.
        </div>
      )}
      <button
        className="button small"
        disabled={busy || (replacing && !allowReplacement)}
      >
        {busy
          ? "Uploading…"
          : replacing
            ? "Replace & scan photo"
            : "Upload securely"}
      </button>
    </form>
  );
}
