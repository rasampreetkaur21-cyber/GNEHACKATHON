import { afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LocalVisionAdapter } from "../src/ai/local.js";
import { evaluateDeviceCheck } from "../src/services/deviceCheckPolicy.js";
const local = new LocalVisionAdapter();
afterAll(() => local.close());
it("local model is installed and ready without a cloud API key", () =>
  expect(local.status()).toMatchObject({ status: "READY", provider: "LOCAL" }));
it.each([
  ["commons/mug.jpg", "INVALID_DEVICE", "mug"],
  ["commons/a26a.jpg", "UNCLEAR_IMAGE", "phone"],
  ["attached/samsung-galaxy-a26-5g/match.jpg", "HUMAN_REVIEW", "document"],
])(
  "real local inference %s",
  async (file, status, category) => {
    const bytes = readFileSync(
      new URL(
        `../../datasets/six-product-v1/data/images/${file}`,
        import.meta.url,
      ),
    );
    const r = await local.analyze({ kind: "device_check", bytes });
    const result = evaluateDeviceCheck({
      selected_model_id: "samsung-galaxy-a26-5g",
      observations: r.observations,
    });
    expect(result.status).toBe(status);
    expect(r.local_assessment.category).toBe(category);
    expect(r.local_assessment.reference_classifier_hint).toBeNull();
  },
  60000,
);
import request from "supertest";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {openDatabase} from "../src/database/db.js";
import {createApp} from "../src/app.js";
import {createClaim} from "../src/services/claims.js";
import {digest} from "../src/utils/security.js";
it("actual local uploads start analysis automatically without recording a paid API call",async()=>{
 const folder=mkdtempSync(join(tmpdir(),"local-auto-test-")),db=openDatabase(":memory:");let app;
 try{
 const uid=randomUUID(),token=randomUUID();db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)").run(uid,"TEST ONLY","local@test.invalid","unused","customer");db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token),uid,Date.now()+120000);
 const id=createClaim(db,uid,{catalog_id:"samsung-galaxy-a26-5g",serial:"UNKNOWN",purchase_date:"UNKNOWN",incident_date:"UNKNOWN",previous_repairs:0,statement:"ISOLATED LOCAL ANALYSIS TEST ONLY"});
 app=createApp({db,uploads:folder,aiAdapter:local});
 const r=await request(app).post(`/api/claims/${id}/evidence`).set("X-ClaimShield","1").set("Cookie",`cs_session=${token}`).field("kind","photo").attach("file",readFileSync(new URL("../../datasets/six-product-v1/data/images/commons/mug.jpg",import.meta.url)),{filename:"test.jpg",contentType:"image/jpeg"});
 expect(r.status).toBe(201);await app.locals.analysis.waitForIdle();const saved=db.prepare("SELECT * FROM evidence WHERE id=?").get(r.body.id);expect(saved.processing_status).toBe("ANALYSIS_COMPLETE");expect(saved.ai_model).toBe("local-clip-ridge-ocr-v1");expect(db.prepare("SELECT count(*) n FROM ai_usage").get().n).toBe(0);
 db.prepare("UPDATE evidence SET processing_status='AI_NOT_CONFIGURED' WHERE id=?").run(r.body.id);
 const resumed=await request(app).get(`/api/claims/${id}/evidence/${r.body.id}/analysis`).set("Cookie",`cs_session=${token}`);
 expect(resumed.status).toBe(200);await app.locals.analysis.waitForIdle();expect(db.prepare("SELECT processing_status FROM evidence WHERE id=?").get(r.body.id).processing_status).toBe("ANALYSIS_COMPLETE");
 }finally{if(app)await app.locals.analysis.waitForIdle();db.close();rmSync(folder,{recursive:true,force:true});}
},60000);
