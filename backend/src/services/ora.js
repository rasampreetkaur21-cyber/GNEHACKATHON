import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "csv-parse";
export const source = {
  id: "ora",
  url: "https://github.com/openrepair/data",
  attribution: "Open Repair Alliance and contributing repair organizations",
  license: "CC-BY-SA-4.0",
  scope: "Aggregate repair context only; never individual warranty history",
};
export const expectedHeaders = [
  "id",
  "data_provider",
  "country",
  "partner_product_category",
  "product_category",
  "product_category_id",
  "brand",
  "year_of_manufacture",
  "product_age",
  "repair_status",
  "repair_barrier_if_end_of_life",
  "group_identifier",
  "event_date",
  "problem",
];
export async function importOra(db, path) {
  db.prepare(
    "UPDATE datasets_provenance SET status=?,error=NULL WHERE id=?",
  ).run("IMPORTING", "ora");
  // Stage in a temporary table, then replace atomically. A failed import preserves previous context.
  db.exec(
    "CREATE TEMP TABLE IF NOT EXISTS ora_staging(id TEXT PRIMARY KEY,payload TEXT NOT NULL); DELETE FROM ora_staging;",
  );
  const hash = createHash("sha256");
  let count = 0;
  try {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    const parser = stream.pipe(
      parse({
        bom: true,
        columns: (headers) => {
          if (!expectedHeaders.every((h) => headers.includes(h)))
            throw new Error("CSV header does not match ORDS v0.3.");
          return headers;
        },
        skip_empty_lines: true,
        max_record_size: 100000,
      }),
    );
    stream.on("error", (err) => parser.destroy(err));
    for await (const row of parser) {
      if (!row.id || !row.data_provider)
        throw new Error("Required ORDS ID/provider missing.");
      db.prepare("INSERT INTO ora_staging VALUES(?,?)").run(
        row.id,
        JSON.stringify(row),
      );
      count++;
    }
    if (!count) throw new Error("CSV contains no repair records.");
    db.transaction(() => {
      db.prepare("DELETE FROM repair_context WHERE dataset_id=?").run("ora");
      db.prepare(
        "INSERT INTO repair_context SELECT id,?,payload FROM ora_staging",
      ).run("ora");
      db.prepare(
        "UPDATE datasets_provenance SET status=?,record_count=?,sha256=?,imported_at=?,error=NULL WHERE id=?",
      ).run(
        "LOADED",
        count,
        hash.digest("hex"),
        new Date().toISOString(),
        "ora",
      );
    })();
    return { status: "LOADED", count };
  } catch (err) {
    db.prepare(
      "UPDATE datasets_provenance SET status=?,error=? WHERE id=?",
    ).run("FAILED", String(err.message).slice(0, 200), "ora");
    throw err;
  } finally {
    db.exec("DROP TABLE IF EXISTS ora_staging");
  }
}
