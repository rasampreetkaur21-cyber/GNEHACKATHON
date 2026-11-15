import { refreshLegacyInvestigations } from "./services/investigation.js";
import { readFileSync } from "node:fs";
import { configureRecord } from "./services/company.js";
import { config, root } from "./config.js";
import { openDatabase } from "./database/db.js";
import { seedSynthetic } from "./services/synthetic.js";
import { importOra } from "./services/ora.js";
import { hashPassword } from "./utils/security.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
const db = openDatabase(config.database);
try {
  switch (process.argv[2]) {
    case "company-staff": {
      const brand=z.enum(['samsung','boat']).parse(process.env.COMPANY_BRAND);
      const email=z.string().email().parse(process.env.COMPANY_EMAIL).toLowerCase();
      const password=z.string().min(12).max(128).parse(process.env.COMPANY_PASSWORD);
      const name=z.string().trim().min(2).max(100).parse(process.env.COMPANY_NAME || `${brand==='samsung'?'Samsung':'boAt'} Reviewer`);
      if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new Error('Email already exists. Existing accounts are never reassigned or overwritten.');
      db.transaction(()=>{
        const id=randomUUID();db.prepare('INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)').run(id,name,email,hashPassword(password),'reviewer');
        db.prepare('INSERT INTO company_staff(user_id,brand) VALUES(?,?)').run(id,brand);
      })();console.log('Brand-scoped company reviewer created.');break;
    }
    case "init":
      console.log(
        "SQLite initialized; existing data retained. New versioned investigations:",
        refreshLegacyInvestigations(db),
      );
      break;
    case "seed":
      console.log(
        seedSynthetic(
          db,
          JSON.parse(
            readFileSync(
              resolve(root, "data/synthetic/claims-v2.json"),
              "utf8",
            ),
          ),
        ),
      );
      break;
    case "reviewer": {
      const email = z
        .string()
        .email()
        .parse(process.env.REVIEWER_EMAIL)
        .toLowerCase();
      const password = z
        .string()
        .min(12)
        .max(128)
        .parse(process.env.REVIEWER_PASSWORD);
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
      ).run(
        randomUUID(),
        "Warranty Reviewer",
        email,
        hashPassword(password),
        "reviewer",
      );
      console.log("Reviewer created.");
      break;
    }
    case "company": {
      if (!process.argv[3])
        throw new Error("Pass a company configuration JSON file path.");
      const bundle = z
        .object({
          reason: z.string().min(10).max(1500),
          records: z.array(z.unknown()).min(1).max(1000),
        })
        .strict()
        .parse(JSON.parse(readFileSync(resolve(process.argv[3]), "utf-8")));
      db.transaction(() => {
        for (const record of bundle.records)
          configureRecord(db, record, null, bundle.reason);
      })();
      console.log(
        "Authorized company configuration imported:",
        bundle.records.length,
        "records. Existing investigation snapshots retained.",
      );
      break;
    }
    case "import":
      if (!process.argv[3])
        throw new Error(
          "Pass a local ORDS CSV path: npm run import:ora -- C:/path/data.csv",
        );
      console.log(await importOra(db, resolve(process.argv[3])));
      break;
    default:
      throw new Error("Unknown command.");
  }
} catch (err) {
  console.error(
    err instanceof z.ZodError
      ? "Input validation failed. Check the documented command schema and required environment variables."
      : err.message,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
