import { refreshLegacyInvestigations } from "./services/investigation.js";
import { config } from "./config.js";
import { openDatabase } from "./database/db.js";
import { createApp } from "./app.js";
const db = openDatabase(config.database);
refreshLegacyInvestigations(db);
const app = createApp({ db, ...config });
const server = app.listen(config.port, "127.0.0.1", () =>
  console.log(`ClaimShield API: http://127.0.0.1:${config.port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await app.locals.analysis.waitForIdle();
      db.close();
      process.exit(0);
    }),
  );
