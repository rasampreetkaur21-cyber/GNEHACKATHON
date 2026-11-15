import { readFileSync } from "node:fs";
import { getCatalogItem, findCatalogModel } from "../catalog.js";
const root = new URL("../../../datasets/six-product-v1/", import.meta.url);
const products = JSON.parse(readFileSync(new URL("catalog.json", root), "utf8"));
const assets = JSON.parse(readFileSync(new URL("data/assets.json", root), "utf8"));

// Selected-product context only. Never use asset labels to identify a submitted photo.
export function productReference(claim) {
  const selected = getCatalogItem(claim.catalog_id) || findCatalogModel(claim.model);
  const product = products.find(p => p.model_id === selected?.id);
  if (!product) return null;
  const related = assets.filter(a => a.model_id === product.model_id);
  const origins = Object.fromEntries([...new Set(related.map(a => a.origin))].map(origin => [origin, related.filter(a => a.origin === origin).length]));
  return {
    model_id: product.model_id, name: product.name, category: product.category,
    brand: selected.brand, reference_url: product.reference_url,
    source: "six-product-v1/catalog.json + data/assets.json",
    source_type: "SELECTED_PRODUCT_REFERENCE", asset_origins: origins,
    total_assets: related.length,
    label_hint: product.category === "phone"
      ? "Show the device’s Settings → About phone model number with the phone visible, or a readable attached model label."
      : "Show the headphone’s attached model label clearly, with the headphones visible in the same photo.",
    limitation: "Catalog information describes your selected product. It does not prove the uploaded photo shows that model.",
  };
}
