export function toMinor(value) {
  if (value === "") return null;
  return Math.round(Number(value) * 100);
}
export function amount(value) {
  return value == null ? "UNKNOWN" : "₹" + (value / 100).toFixed(2);
}
