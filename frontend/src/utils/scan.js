import {getCatalogItem} from "../../../backend/src/catalog.js";
const categories={phone:"a phone",headphones:"headphones",laptop:"a different device",tablet:"a different device",mug:"a non-product object",scenery:"a scene rather than a product",indoor_scene:"a scene rather than a product",people:"a scene rather than a product",furniture:"a non-product subject",vehicle:"a non-product subject",animal:"a non-product subject",document:"a document or label",packaging:"packaging",screenshot:"a screenshot"};
export const scanCategory = value => categories[value] || "a subject that needs confirmation";
export const scanModel = id => getCatalogItem(id)?.model || null;
