import { readFileSync } from "node:fs";
const root = new URL("../../../datasets/six-product-v1/", import.meta.url);
// Only provenance hashes/origins are loaded, never case labels or expected identities.
const raw = new Map(
  JSON.parse(readFileSync(new URL("data/assets.json", root), "utf8")).map(
    (a) => [a.sha256, a.origin],
  ),
);
const normalized = new Map(
  JSON.parse(readFileSync(new URL("provenance_hashes.json", root), "utf8")).map(
    (a) => [a.normalized_sha256, a.origin],
  ),
);
export function imageOrigin(sha256, normalizedSha256) {
  return (
    raw.get(sha256) ||
    normalized.get(normalizedSha256) ||
    "user_upload_unverified"
  );
}
export function reviewOrigin(origin) {
  return (
    [
      "generated_synthetic",
      "ai_generated",
      "real_open_license",
      "digital_edit",
      "simulated_screenshot",
    ].includes(origin) || origin?.startsWith("augmented")
  );
}
