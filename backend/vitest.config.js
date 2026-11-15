import {defineConfig} from 'vitest/config';
// ONNX/OCR, SQLite and browser-component suites share a modest development machine.
export default defineConfig({test:{pool:'threads',maxWorkers:1,testTimeout:20000,hookTimeout:30000}});
