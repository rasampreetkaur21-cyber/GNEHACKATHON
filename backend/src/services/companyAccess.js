import { getCatalogItem, findCatalogModel } from "../catalog.js";
export function claimBrand(claim) {
  // An explicit canonical ID is authoritative; never fall back from an invalid ID.
  const product = claim.catalog_id ? getCatalogItem(claim.catalog_id) : findCatalogModel(claim.model);
  return product?.brand === "Samsung" ? "samsung" : product?.brand === "boAt" ? "boat" : null;
}
export const isStaff = user => ["reviewer", "company_reviewer"].includes(user.role);
export function canReadClaim(user, claim) {
  if (!claim || (claim.is_draft && claim.user_id !== user.id)) return false;
  if (user.role === "company_reviewer") return !claim.is_draft && claimBrand(claim) === user.company_brand;
  return user.role === "reviewer" || claim.user_id === user.id;
}
export function sessionUser(row) {
  return row?.company_brand ? { ...row, role: "company_reviewer" } : row;
}
