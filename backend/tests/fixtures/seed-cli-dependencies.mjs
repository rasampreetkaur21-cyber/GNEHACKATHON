import { registerHooks } from "node:module";

// Resolve the isolated deployment's installed packages from the test workspace.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      [
        "better-sqlite3",
        "dotenv",
        "dotenv/config",
        "zod",
        "csv-parse",
      ].includes(specifier)
    )
      return nextResolve(specifier, {
        ...context,
        parentURL: new URL("../../src/cli.js", import.meta.url).href,
      });
    return nextResolve(specifier, context);
  },
});
