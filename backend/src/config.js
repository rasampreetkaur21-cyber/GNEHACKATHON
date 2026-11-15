import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173",
  database: resolve(
    root,
    process.env.DATABASE_PATH || "data/claimshield.sqlite",
  ),
  uploads: resolve(root, process.env.UPLOAD_DIR || "data/private"),
  production: process.env.NODE_ENV === "production",
};
