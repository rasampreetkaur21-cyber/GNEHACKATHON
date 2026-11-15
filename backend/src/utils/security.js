import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const digest = (v) => createHash("sha256").update(v).digest("hex");
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function checkPassword(password, stored) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    Buffer.from(key, "hex"),
    scryptSync(password, salt, 64),
  );
}
export const publicUser = ({ id, name, email, role, synthetic, company_brand }) => ({
  id,
  name,
  email,
  role,
  company_brand: company_brand || null,
  synthetic: !!synthetic,
});
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
