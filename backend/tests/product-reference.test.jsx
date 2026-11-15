import React from "react";
import { it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { productReference } from "../src/services/productReference.js";
import { catalog } from "../src/catalog.js";
import ProductEvidenceReport from "../../frontend/src/components/ProductEvidenceReport.jsx";
const assets = JSON.parse(readFileSync(new URL("../../datasets/six-product-v1/data/assets.json", import.meta.url),"utf8"));
it.each(catalog)("uses only $id's dataset records without asserting observed identity", product => {
 const reference=productReference({catalog_id:product.id});
 const related=assets.filter(a=>a.model_id===product.id);
 expect(reference.model_id).toBe(product.id);
 expect(reference.total_assets).toBe(related.length);
 expect(Object.values(reference.asset_origins).reduce((a,b)=>a+b,0)).toBe(related.length);
 const evidence={observations:{model_text:"UNKNOWN",serial_text:"UNKNOWN",image_quality:"CLEAR"}};
 const before=JSON.stringify(evidence);
 const html=renderToStaticMarkup(<ProductEvidenceReport evidence={evidence} reference={reference}/>);
 expect(html).toContain(reference.name);
 expect(html).toContain("No readable model identifier found");
 expect(html).toContain("Selected product · dataset reference");
 expect(html).not.toContain(">UNKNOWN<");
 expect(JSON.stringify(evidence)).toBe(before);
});
it("does not substitute a selected model for an OCR mismatch",()=>{
 const html=renderToStaticMarkup(<ProductEvidenceReport evidence={{scan_report:{readable_model_candidate:"samsung-galaxy-a36-5g"}}} reference={productReference({catalog_id:"samsung-galaxy-a26-5g"})}/>);
 expect(html).toContain("Galaxy A36 5G");expect(html).toContain("Samsung Galaxy A26 5G");expect(html).toContain("device linkage still needs confirmation");
});
it("does not invent a reference for unsupported selections",()=>expect(productReference({catalog_id:"random",model:"random"})).toBeNull());
