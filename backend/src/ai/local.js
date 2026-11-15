import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { AnalysisError } from "./claude.js";
import { deviceCheckObservationSchema } from "./deviceCheckSchema.js";
import { validateObservations } from "./schemas.js";
const folder = fileURLToPath(new URL("../../local_ai/", import.meta.url));
export class LocalVisionAdapter {
  constructor() {
    this.model = "local-clip-ridge-ocr-v1";
    this.pending = new Map();
    this.child = null;
    this.buffer = "";
  }
  status() {
    return {
      status:
        [
          "dataset_classifier.npz",
          "vision_model_quantized.onnx",
          "text_model_quantized.onnx",
        ].every((f) => existsSync(folder + "models/" + f)) &&
        existsSync(folder + ".deps/onnxruntime")
          ? "READY"
          : "AI_NOT_CONFIGURED",
      provider: "LOCAL",
      model: this.model,
    };
  }
  start() {
    if (this.child) return;
    const child = spawn(
      process.env.LOCAL_AI_PYTHON || "python",
      [folder + "worker.py"],
      {
        cwd: folder,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          OMP_NUM_THREADS: "2",
        },
      },
    );
    this.child = child;
    child.unref();
    child.stdin.unref?.();
    child.stdout.unref?.();
    child.stderr.unref?.();
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 1);
        try {
          const msg = JSON.parse(line),
            task = this.pending.get(msg.id);
          if (task) {
            clearTimeout(task.timer);
            this.pending.delete(msg.id);
            msg.error
              ? task.reject(
                  new AnalysisError(
                    "LOCAL_AI_ERROR",
                    "Local image analysis failed. Retry or request manual review.",
                  ),
                )
              : task.resolve(msg.result);
          }
        } catch {}
      }
    });
    child.stderr.on("data", () => {});
    const fail = () => {
      this.child = null;
      this.buffer = "";
      for (const task of this.pending.values()) {
        clearTimeout(task.timer);
        task.reject(
          new AnalysisError(
            "LOCAL_AI_UNAVAILABLE",
            "Local model process stopped. Retry analysis.",
          ),
        );
      }
      this.pending.clear();
    };
    child.stdin.on("error", fail);
    child.on("error", fail);
    child.on("exit", fail);
  }
  async analyze({ bytes, kind }) {
    if (this.status().status !== "READY")
      throw new AnalysisError(
        "AI_NOT_CONFIGURED",
        "Local model files are not installed.",
      );
    this.start();
    const id = randomUUID();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AnalysisError(
            "CLAUDE_TIMEOUT",
            "Local image analysis timed out. Retry the saved photo.",
          ),
        );
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, kind, image: bytes.toString("base64") }) + "\n",
      );
    });
    return {
      ...result,
      observations:
        kind === "device_check"
          ? deviceCheckObservationSchema.parse(result.observations)
          : validateObservations(result.observations, kind, { current: true }),
    };
  }
  close() {
    this.child?.kill();
    this.child = null;
  }
}
