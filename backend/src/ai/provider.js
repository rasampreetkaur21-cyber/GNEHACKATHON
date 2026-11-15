import { ClaudeVisionAdapter } from "./claude.js";
import { LocalVisionAdapter } from "./local.js";
let local;
export function createDefaultAdapter() {
  if (process.env.AI_PROVIDER === "local")
    return (local ||= new LocalVisionAdapter());
  return new ClaudeVisionAdapter();
}
