import { readFile, writeFile } from "node:fs/promises";
import { prepareImage } from "../src/services/images.js";
import { digest } from "../src/utils/security.js";
const folder = new URL("../../datasets/six-product-v1/", import.meta.url);
const assets = JSON.parse(
  await readFile(new URL("data/assets.json", folder), "utf8"),
);
const rows = [];
for (const asset of assets) {
  const bytes = await readFile(new URL(`data/${asset.image_path}`, folder));
  if (digest(bytes) !== asset.sha256)
    throw new Error(`Hash mismatch: ${asset.asset_id}`);
  const image = await prepareImage(bytes, "image/jpeg");
  rows.push({
    asset_id: asset.asset_id,
    sha256: asset.sha256,
    normalized_sha256: digest(image.normalized),
    origin: asset.origin,
  });
}
await writeFile(
  new URL("provenance_hashes.json", folder),
  JSON.stringify(rows, null, 2) + "\n",
);
console.log(
  `Indexed ${rows.length} provenance records; no expected identities or outcomes included.`,
);
