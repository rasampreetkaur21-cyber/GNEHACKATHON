import {it,expect} from "vitest";
import request from "supertest";
import {randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openDatabase} from "../src/database/db.js";
import {createApp} from "../src/app.js";
import {createClaim} from "../src/services/claims.js";
import {ClaudeVisionAdapter} from "../src/ai/claude.js";
import {digest} from "../src/utils/security.js";
it("customer sees the actual reviewer decision and reason, never an automatic approval",async()=>{
 const db=openDatabase(":memory:"),folder=mkdtempSync(join(tmpdir(),"customer-outcome-"));let app;
 try{
  const user=randomUUID(),reviewer=randomUUID(),token=randomUUID(),reviewToken=randomUUID();
  for(const [id,role,t] of [[user,"customer",token],[reviewer,"reviewer",reviewToken]]){db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)").run(id,"ISOLATED TEST",`${id}@test.invalid`,"unused",role);db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(t),id,Date.now()+60000);}
  const id=createClaim(db,user,{catalog_id:"samsung-galaxy-a26-5g",serial:"UNKNOWN",purchase_date:"UNKNOWN",incident_date:"UNKNOWN",previous_repairs:0,statement:"Isolated customer-view integration test."});
  app=createApp({db,uploads:folder,aiAdapter:new ClaudeVisionAdapter({apiKey:"",model:""})});
  const get=()=>request(app).get(`/api/claims/${id}`).set("Cookie",`cs_session=${token}`);
  const before=await get();expect(before.body.customer_summary).toMatchObject({code:"PHOTO_NEEDED",approved:false,final:false});
  const blocked=await request(app).patch(`/api/reviewer/claims/${id}`).set("X-ClaimShield","1").set("Cookie",`cs_session=${token}`).send({status:"APPROVED",reason:"Trying to approve my own claim."});expect(blocked.status).toBe(403);
  const reason="ISOLATED TEST: reviewer independently checked the receipt.";
  const saved=await request(app).patch(`/api/reviewer/claims/${id}`).set("X-ClaimShield","1").set("Cookie",`cs_session=${reviewToken}`).send({status:"APPROVED",reason});expect(saved.status).toBe(200);
  const after=await get();expect(after.body.customer_summary).toMatchObject({code:"APPROVED",approved:true,final:true,reason});
 }finally{if(app)await app.locals.analysis.waitForIdle();db.close();rmSync(folder,{recursive:true,force:true});}
});
