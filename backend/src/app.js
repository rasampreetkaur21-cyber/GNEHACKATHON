import { mountLiveRoutes } from "./services/liveRoutes.js";
import { mountAppointmentRoutes } from "./services/appointments.js";
import { canReadClaim, claimBrand, isStaff, sessionUser } from "./services/companyAccess.js";
import { productReference } from "./services/productReference.js";
import { customerOutcome } from "./services/customerOutcome.js";
import { imageOrigin } from "./services/provenance.js";
import { createDeviceCheckService } from "./services/deviceChecks.js";
import { catalog, catalogIds } from "./catalog.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { prepareImage } from "./services/images.js";
import {
  createAnalysisService,
  evidenceColumns,
  publicEvidence,
} from "./services/analysis.js";
import { manualFields } from "./ai/schemas.js";
import {
  readDeviceVerification,
  readVerificationHistory,
} from "./services/deviceVerification.js";
import { saveEvidence } from "./services/evidence.js";
import { resolve } from "node:path";
import {
  hashPassword,
  checkPassword,
  digest,
  publicUser,
  HttpError,
} from "./utils/security.js";
import {
  investigate,
  audit,
  readInvestigation,
  refreshLegacyInvestigations,
} from "./services/investigation.js";
import { createClaim } from "./services/claims.js";
import { createChatService } from "./services/chat.js";
import { configureRecord } from "./services/company.js";

const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();
export function createApp({
  db,
  uploads,
  origin = "http://127.0.0.1:5173",
  production = false,
  aiAdapter,
  aiDailyBudget,
  deviceCheckAdapter,
}) {
  mkdirSync(uploads, { recursive: true });
  const app = express();
  const analysis = createAnalysisService({
    db,
    uploads,
    adapter: aiAdapter,
    dailyBudget: aiDailyBudget,
  });
  app.locals.analysis = analysis;
  const chat = createChatService({ db, aiStatus: () => analysis.status() });
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin, credentials: true }));
  app.use((req,res,next)=>(/\/live\//.test(req.path) ? express.json({limit:'128kb'}) : express.json({limit:'32kb'}))(req,res,next));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 400,
      skip: req => req.path==='/live-invitations' || /^\/claims\/[^/]+\/(?:live|appointments)(?:\/|$)/.test(req.path),
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.get("X-ClaimShield") !== "1" ||
        (req.get("Origin") && req.get("Origin") !== origin))
    )
      return next(
        new HttpError(
          403,
          "CSRF_REJECTED",
          "Request origin or security header is invalid.",
        ),
      );
    next();
  });
  const wrap = (fn) => (req, res, next) =>
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  const auth = (req, res, next) => {
    const token = req.cookies.cs_session;
    const row =
      token &&
      db
        .prepare(
          "SELECT u.*,cs.brand company_brand FROM sessions s JOIN users u ON s.user_id=u.id LEFT JOIN company_staff cs ON cs.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .get(digest(token), Date.now());
    if (!row)
      return next(new HttpError(401, "UNAUTHENTICATED", "Please sign in."));
    req.user = sessionUser(row);
    next();
  };
  const reviewer = (req, res, next) =>
    isStaff(req.user)
      ? next()
      : next(new HttpError(403, "FORBIDDEN", "Reviewer access required."));
  const customer = (req, res, next) =>
    req.user.role === "customer"
      ? next()
      : next(new HttpError(403, "FORBIDDEN", "Customer account required."));
  const owned = (req) => {
    const claim = db
      .prepare("SELECT * FROM claims WHERE id=?")
      .get(req.params.id);
    if (
      !canReadClaim(req.user, claim)
    )
      throw new HttpError(404, "NOT_FOUND", "Claim not found.");
    return claim;
  };
  const login = (res, user) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      digest(token),
      user.id,
      Date.now() + 8 * 3600000,
    );
    res.cookie("cs_session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: 8 * 3600000,
      path: "/",
    });
    res.json({ user: publicUser(user) });
  };
  app.get("/api/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", database: "connected", ai: analysis.status() });
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.use("/api/auth", authLimit);
  app.post(
    "/api/auth/register",
    wrap((req, res) => {
      const body = credentials
        .extend({ name: z.string().trim().min(2).max(100) })
        .parse(req.body);
      if (db.prepare("SELECT id FROM users WHERE email=?").get(body.email))
        throw new HttpError(
          409,
          "EMAIL_EXISTS",
          "Unable to register this email.",
        );
      const id = randomUUID();
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
      ).run(id, body.name, body.email, hashPassword(body.password), "customer");
      res.status(201);
      login(res, db.prepare("SELECT * FROM users WHERE id=?").get(id));
    }),
  );
  app.post(
    "/api/auth/login",
    wrap((req, res) => {
      const b = credentials.parse(req.body);
      const user = sessionUser(db.prepare("SELECT u.*,cs.brand company_brand FROM users u LEFT JOIN company_staff cs ON cs.user_id=u.id WHERE email=?").get(b.email));
      const fallback = hashPassword("constant-time-dummy-password");
      if (!checkPassword(b.password, user?.password_hash || fallback) || !user)
        throw new HttpError(
          401,
          "LOGIN_FAILED",
          "Email or password is incorrect.",
        );
      login(res, user);
    }),
  );
  app.get("/api/auth/me", auth, (req, res) =>
    res.json({ user: publicUser(req.user) }),
  );
  app.post('/api/auth/company/:brand/login',wrap((req,res)=>{
    const brand=z.enum(['samsung','boat']).parse(req.params.brand), b=credentials.parse(req.body);
    const user=sessionUser(db.prepare('SELECT u.*,cs.brand company_brand FROM users u JOIN company_staff cs ON cs.user_id=u.id WHERE u.email=?').get(b.email));
    if(!user || user.company_brand!==brand || !checkPassword(b.password,user.password_hash))throw new HttpError(401,'LOGIN_FAILED','Company credentials do not match this portal.');
    login(res,user);
  }));
  app.get('/api/company/:brand/claims',auth,wrap((req,res)=>{
    const brand=z.enum(['samsung','boat']).parse(req.params.brand);
    if(req.user.role!=='company_reviewer' || req.user.company_brand!==brand)throw new HttpError(403,'FORBIDDEN','This company portal is not assigned to your account.');
    const query=z.object({search:z.string().max(150).optional(),status:z.enum(['SUBMITTED','UNDER_REVIEW','NEEDS_EVIDENCE','APPROVED','REJECTED']).optional()}).strict().parse(req.query);
    const search=(query.search || '').toLowerCase();
    const claims=db.prepare('SELECT c.*,u.name customer_name FROM claims c JOIN users u ON u.id=c.user_id WHERE c.is_draft=0 ORDER BY c.created_at DESC,c.rowid DESC').all().filter(c=>claimBrand(c)===brand && (!query.status || c.status===query.status) && (!search || [c.id,c.customer_name,c.model].some(v=>v?.toLowerCase().includes(search))));
    res.json({claims});
  }));
  mountLiveRoutes(app,{db,auth,owned});
  mountAppointmentRoutes(app,{db,auth,owned});
  app.post("/api/auth/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      digest(req.cookies.cs_session),
    );
    res.clearCookie("cs_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post(
    "/api/claims",
    auth,
    customer,
    wrap((req, res) => {
      const id = createClaim(db, req.user.id, req.body, {
        idempotencyKey: req.get("Idempotency-Key") || null,
      });
      res.status(201).json({ id });
    }),
  );
  app.get("/api/claims", auth, (req, res) =>
    res.json({
      claims: db
        .prepare(
          "SELECT * FROM claims WHERE user_id=? AND is_draft=0 ORDER BY created_at DESC,rowid DESC",
        )
        .all(req.user.id),
    }),
  );
  app.get(
    "/api/reviewer/claims",
    auth,
    reviewer,
    wrap((req, res) => {
      refreshLegacyInvestigations(db);
      if(req.user.role!=='reviewer')throw new HttpError(403,'FORBIDDEN','Use your assigned company dashboard.');
      res.json({
        claims: db
          .prepare(
            `SELECT c.*,u.name customer_name,(SELECT outcome FROM investigations WHERE claim_id=c.id ORDER BY rowid DESC LIMIT 1) recommendation,(SELECT engine_version FROM investigations WHERE claim_id=c.id ORDER BY rowid DESC LIMIT 1) recommendation_engine FROM claims c JOIN users u ON c.user_id=u.id WHERE c.is_draft=0 ORDER BY c.created_at DESC,c.rowid DESC`,
          )
          .all(),
        datasets: db.prepare("SELECT * FROM datasets_provenance").all(),
      });
    }),
  );
  app.get(
    "/api/claims/:id",
    auth,
    wrap((req, res) => {
      const claim = owned(req);
      const investigation = readInvestigation(db, claim.id, req.user.role);
      const customerEvidence=db.prepare(`SELECT ${evidenceColumns} FROM evidence WHERE claim_id=? AND active=1 ORDER BY rowid DESC`).all(claim.id).map(publicEvidence);
      const customerPhoto=customerEvidence.find(e=>e.kind === "photo");
      const latestReview=db.prepare("SELECT detail FROM audit_events WHERE claim_id=? AND action='REVIEWER_DECISION' ORDER BY rowid DESC LIMIT 1").get(claim.id);
      const customer_summary=customerOutcome({claim,investigation,evidence:customerEvidence,verification:customerPhoto ? readDeviceVerification(db,customerPhoto.id):null,reviewNote:latestReview?.detail.replace(/^[A-Z_]+:\s*/,"")});
      res.json({
        customer_summary,
        ...(isStaff(req.user) ? {customer:{name:db.prepare('SELECT name FROM users WHERE id=?').get(claim.user_id)?.name || 'Customer'}} : {}),
        decision_history: db.prepare('SELECT s.id,s.status,s.reason,s.created_at,u.name actor_name FROM claim_status_changes s LEFT JOIN users u ON u.id=s.actor_id WHERE s.claim_id=? ORDER BY s.rowid').all(claim.id),
        claim,
        investigation,
        evidence: db
          .prepare(
            `SELECT ${evidenceColumns} FROM evidence WHERE claim_id=? AND (active=1 OR ?) ORDER BY active DESC,rowid DESC`,
          )
          .all(claim.id, Number(isStaff(req.user)))
          .map(publicEvidence),
        timeline: db
          .prepare(
            "SELECT action,detail,created_at FROM audit_events WHERE claim_id=? ORDER BY rowid",
          )
          .all(claim.id).filter(e=>req.user.role==='reviewer' || e.action!=='REVIEWER_NOTE'),
        ai: analysis.status(),
      });
    }),
  );
  const openClaim = (req, res, next) => {
    const c = owned(req);
    if (["APPROVED", "REJECTED"].includes(c.status))
      return next(
        new HttpError(
          409,
          "CLAIM_CLOSED",
          "A finalized claim cannot accept evidence changes.",
        ),
      );
    next();
  };
  const ownedEvidence = (req) => {
    const claim = owned(req);
    const e = db
      .prepare("SELECT * FROM evidence WHERE id=? AND claim_id=?")
      .get(req.params.evidenceId, claim.id);
    if (!e) throw new HttpError(404, "NOT_FOUND", "Evidence not found.");
    return e;
  };
  const activeEvidence = (req) => {
    const e = ownedEvidence(req);
    if (!e.active)
      throw new HttpError(
        409,
        "EVIDENCE_SUPERSEDED",
        "This photo is in evidence history.",
      );
    return e;
  };
  const uploadLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    keyGenerator: (req) => req.user.id,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many evidence requests. Please try again later.",
        },
      }),
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const analysisLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: (req) => req.user.id,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many evidence requests. Please try again later.",
        },
      }),
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploads,
      filename: (req, file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, parts: 4 },
    fileFilter: (req, file, cb) =>
      cb(
        null,
        ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
          file.mimetype,
        ),
      ),
  });
  app.post(
    "/api/claims/:id/evidence",
    auth,
    wrap(openClaim),
    uploadLimit,
    upload.single("file"),
    wrap(async (req, res) => {
      let normalizedKey;
      let saved;
      try {
        const { kind, replaces, live_session_id } = z
          .object({
            kind: z.enum(["invoice", "photo", "service_record", "warranty", "live_snapshot"]),
            live_session_id: z.string().uuid().optional(),
            replaces: z.string().uuid().optional(),
          })
          .strict()
          .parse(req.body);
        if(kind==='live_snapshot') {
          const c=owned(req), s=live_session_id && db.prepare("SELECT * FROM live_sessions WHERE id=? AND claim_id=? AND status!='ENDED' AND owner_joined=1 AND expires_at>?").get(live_session_id,c.id,Date.now());
          if(req.user.role!=='customer' || req.user.id!==c.user_id || !s || c.is_draft)throw new HttpError(403,'LIVE_REQUIRED','An active live session owned by you is required to save a frame.');
          if(req.file?.mimetype==='application/pdf')throw new HttpError(400,'INVALID_FILE','A snapshot must be an image.');
        } else if(live_session_id)throw new HttpError(400,'INVALID_SESSION','Only live snapshots accept a live session ID.');
        if (replaces && (kind !== "photo" || req.user.role !== "customer"))
          throw new HttpError(
            400,
            "INVALID_REPLACEMENT",
            "Only the claim owner can replace a device photo.",
          );
        if (!req.file)
          throw new HttpError(
            400,
            "FILE_REQUIRED",
            "Upload a JPEG, PNG or WebP image (up to 5 MB). Legacy PDF documents can be stored for manual review.",
          );
        const bytes = await readFile(req.file.path);
        let image = null;
        if (req.file.mimetype === "application/pdf") {
          const type = await fileTypeFromBuffer(bytes).catch(() => null);
          if (type?.mime !== "application/pdf" || kind === "photo")
            throw new HttpError(
              400,
              "INVALID_FILE",
              "A photo must be an image; document signatures must match.",
            );
        } else {
          image = await prepareImage(bytes, req.file.mimetype);
          normalizedKey = randomUUID();
          await writeFile(resolve(uploads, normalizedKey), image.normalized, {
            flag: "wx",
            mode: 0o600,
          });
        }
        const claim = owned(req);
        saved = saveEvidence(db, claim.id, req.user.id, {
          id: randomUUID(),
          kind,
          replaces,
          original_name: req.file.originalname
            .replace(/[^a-zA-Z0-9._ -]/g, "_")
            .slice(0, 150),
          storage_key: req.file.filename,
          mime: req.file.mimetype,
          live_session_id: live_session_id || null,
          size: req.file.size,
          sha256: digest(bytes),
          origin: imageOrigin(
            digest(bytes),
            image ? digest(image.normalized) : null,
          ),
          normalized_sha256: image ? digest(image.normalized) : null,
          normalized_key: normalizedKey || null,
          width: image?.width ?? null,
          height: image?.height ?? null,
        });
        if (saved.duplicate) {
          await unlink(req.file.path).catch(() => {});
          if (normalizedKey)
            await unlink(resolve(uploads, normalizedKey)).catch(() => {});
        }
        if (
          !saved.duplicate &&
          analysis.status().provider === "LOCAL" &&
          analysis.status().status === "READY" &&
          ["photo", "invoice"].includes(kind) &&
          image
        ) {
          db.prepare(
            "UPDATE evidence SET processing_status='ANALYSIS_QUEUED',processing_message='Local image analysis queued automatically.' WHERE id=?",
          ).run(saved.id);
          analysis.resumeQueued();
        } else if (saved.replacement) analysis.resumeQueued();
        res.status(saved.duplicate ? 200 : 201).json(saved);
      } catch (error) {
        if (!saved || saved.duplicate) {
          if (req.file) await unlink(req.file.path).catch(() => {});
          if (normalizedKey)
            await unlink(resolve(uploads, normalizedKey)).catch(() => {});
        }
        throw error;
      }
    }),
  );
  app.get(
    "/api/claims/:id/evidence/:evidenceId/analysis",
    auth,
    wrap((req, res) => {
      const e = ownedEvidence(req);
      if (analysis.status().provider === "LOCAL" && analysis.status().status === "READY" && e.active !== 0 && !e.synthetic && ["photo","invoice"].includes(e.kind) && ["image/jpeg","image/png","image/webp"].includes(e.mime) && ["NOT_ANALYZED","AI_NOT_CONFIGURED"].includes(e.processing_status) && !["APPROVED","REJECTED"].includes(db.prepare("SELECT status FROM claims WHERE id=?").get(e.claim_id).status)) {
        db.prepare("UPDATE evidence SET processing_status='ANALYSIS_QUEUED',processing_message='Local image analysis queued automatically.' WHERE id=?").run(e.id);
      }
      analysis.resumeQueued();
      const evidence = publicEvidence(
        db
          .prepare(`SELECT ${evidenceColumns} FROM evidence WHERE id=?`)
          .get(e.id),
      );
      const annotations = db
        .prepare(
          "SELECT id,kind,fields,note,trust_tier,created_at FROM evidence_annotations WHERE evidence_id=? ORDER BY rowid",
        )
        .all(e.id)
        .map((a) => ({ ...a, fields: JSON.parse(a.fields) }));
      res.json({
        evidence,
        annotations,
        ai: analysis.status(),
        device_verification: readDeviceVerification(db, evidence.id),
        product_reference: productReference(db.prepare("SELECT catalog_id,model FROM claims WHERE id=?").get(e.claim_id)),
        ...(req.user.role === "reviewer" && {
          verification_history: readVerificationHistory(db, e.claim_id, e.id),
        }),
      });
    }),
  );
  app.post(
    "/api/claims/:id/evidence/:evidenceId/analyze",
    auth,
    wrap(openClaim),
    analysisLimit,
    wrap((req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      const e = activeEvidence(req);
      const result = analysis.start(e, req.user.id);
      res.status(result.status === "ANALYSIS_PENDING" ? 202 : 200).json(result);
    }),
  );
  app.post(
    "/api/claims/:id/evidence/:evidenceId/annotations",
    auth,
    wrap(openClaim),
    uploadLimit,
    wrap((req, res) => {
      const e = activeEvidence(req);
      const b = z
        .object({
          kind: z.enum(["ASSERTION", "CORRECTION_REQUEST"]),
          fields: manualFields,
          note: z.string().trim().min(5).max(1500),
        })
        .strict()
        .parse(req.body);
      const id = randomUUID();
      db.transaction(() => {
        db.prepare(
          "INSERT INTO evidence_annotations(id,evidence_id,actor_id,kind,fields,note) VALUES(?,?,?,?,?,?)",
        ).run(id, e.id, req.user.id, b.kind, JSON.stringify(b.fields), b.note);
        audit(
          db,
          e.claim_id,
          req.user.id,
          "EVIDENCE_CLARIFICATION",
          `${b.kind}: customer-provided information recorded as ASSERTED; original observations unchanged.`,
        );
      })();
      investigate(db, owned(req));
      res.status(201).json({ id, trust_tier: "ASSERTED" });
    }),
  );
  app.post(
    "/api/claims/:id/evidence/:evidenceId/verify",
    auth,
    reviewer,
    wrap(openClaim),
    wrap((req, res) => {
      const e = activeEvidence(req);
      const b = z
        .object({ reason: z.string().trim().min(10).max(1500) })
        .strict()
        .parse(req.body);
      if (e.processing_status !== "ANALYSIS_COMPLETE" || !e.observations)
        throw new HttpError(
          409,
          "NOT_EXTRACTED",
          "Only complete extracted observations can be confirmed.",
        );
      db.transaction(() => {
        db.prepare(
          "UPDATE evidence SET trust_tier='VERIFIED',verified_by=?,verified_at=? WHERE id=?",
        ).run(req.user.id, new Date().toISOString(), e.id);
        audit(
          db,
          e.claim_id,
          req.user.id,
          "EVIDENCE_VERIFIED",
          `Reviewer confirmed evidence ${e.id}: ${b.reason}`,
        );
      })();
      investigate(db, owned(req));
      res.json({ id: e.id, trust_tier: "VERIFIED" });
    }),
  );
  app.get(
    "/api/claims/:id/evidence/:evidenceId",
    auth,
    wrap((req, res) => {
      const claim = owned(req);
      const e = db
        .prepare("SELECT * FROM evidence WHERE id=? AND claim_id=?")
        .get(req.params.evidenceId, claim.id);
      if (!e) throw new HttpError(404, "NOT_FOUND", "Evidence not found.");
      if (e.synthetic)
        return res
          .type("text/plain")
          .send("SYNTHETIC evidence fixture. Not an actual customer document.");
      res.set("Content-Security-Policy", "default-src 'none'; sandbox");
      res
        .type(e.mime)
        .download(resolve(uploads, e.storage_key), e.original_name);
    }),
  );
  app.patch(
    "/api/reviewer/claims/:id",
    auth,
    reviewer,
    wrap((req, res) => {
      const claim = owned(req);
      if (claim.is_draft)
        throw new HttpError(
          409,
          "DRAFT_CLAIM",
          "The customer has not submitted this claim.",
        );
      const b = z
        .object({
          status: z.enum([
            "UNDER_REVIEW",
            "NEEDS_EVIDENCE",
            "APPROVED",
            "REJECTED",
          ]),
          reason: z.string().trim().min(10).max(1500),
        })
        .strict()
        .parse(req.body);
      if (["APPROVED", "REJECTED"].includes(claim.status))
        throw new HttpError(409, "CLAIM_CLOSED", "Claim is already finalized.");
      db.transaction(() => {
        db.prepare("UPDATE claims SET status=? WHERE id=?").run(
          b.status,
          claim.id,
        );
        const eventId=audit(db,claim.id,req.user.id,'REVIEWER_DECISION',`${b.status}: ${b.reason}`);
        db.prepare('INSERT INTO claim_status_changes(id,claim_id,status,reason,actor_id) VALUES(?,?,?,?,?)').run(eventId,claim.id,b.status,b.reason,req.user.id);
        if(['APPROVED','REJECTED'].includes(b.status)) {
          db.prepare("UPDATE live_sessions SET status='ENDED',ended_at=CURRENT_TIMESTAMP,expires_at=? WHERE claim_id=? AND status!='ENDED'").run(Date.now(),claim.id);
          db.prepare('DELETE FROM live_signals WHERE session_id IN (SELECT id FROM live_sessions WHERE claim_id=?)').run(claim.id);
        }
      })();
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/claims/:id/investigations",
    auth,
    wrap((req, res) => {
      const c = owned(req);
      res.json({
        investigations: db
          .prepare(
            "SELECT id,outcome,engine_version,explanation,created_at FROM investigations WHERE claim_id=? ORDER BY rowid DESC",
          )
          .all(c.id),
      });
    }),
  );
  app.get(
    "/api/claims/:id/ledger",
    auth,
    wrap((req, res) => {
      const c = owned(req);
      const requested = req.query.investigation_id;
      if (requested) z.string().uuid().parse(requested);
      const investigation = readInvestigation(
        db,
        c.id,
        req.user.role,
        requested,
      );
      if (!investigation)
        throw new HttpError(404, "NOT_FOUND", "Investigation not found.");
      res.json({
        claimId: c.id,
        investigation,
        history: db
          .prepare(
            "SELECT id,outcome,engine_version,created_at FROM investigations WHERE claim_id=? ORDER BY rowid DESC",
          )
          .all(c.id),
        ...(req.user.role === "reviewer"
          ? {
              notes: db
                .prepare(
                  "SELECT id,note,created_at FROM reviewer_notes WHERE claim_id=? ORDER BY rowid",
                )
                .all(c.id),
              device_verification_history: readVerificationHistory(db, c.id),
            }
          : {}),
      });
    }),
  );
  app.post(
    "/api/claims/:id/investigate",
    auth,
    wrap(openClaim),
    wrap((req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      const c = owned(req);
      const result = investigate(db, c);
      audit(
        db,
        c.id,
        req.user.id,
        "INVESTIGATION_REQUESTED",
        "A new versioned investigation was saved; previous results retained.",
      );
      res
        .status(201)
        .json(readInvestigation(db, c.id, req.user.role, result.id));
    }),
  );
  app.post(
    "/api/reviewer/claims/:id/notes",
    auth,
    reviewer,
    wrap((req, res) => {
      const c = owned(req);
      const b = z
        .object({ note: z.string().trim().min(10).max(3000) })
        .strict()
        .parse(req.body);
      const id = randomUUID();
      db.transaction(() => {
        db.prepare(
          "INSERT INTO reviewer_notes(id,claim_id,actor_id,note) VALUES(?,?,?,?)",
        ).run(id, c.id, req.user.id, b.note);
        audit(
          db,
          c.id,
          req.user.id,
          "REVIEWER_NOTE",
          "Reviewer added an internal investigation note.",
        );
      })();
      res.status(201).json({ id });
    }),
  );
  app.post(
    "/api/reviewer/company-records",
    auth,
    reviewer,
    wrap((req, res) => {
      if(req.user.role!=='reviewer')throw new HttpError(403,'FORBIDDEN','Global reviewer required to configure company records.');
      const b = z
        .object({
          record: z.unknown(),
          reason: z.string().trim().min(10).max(1500),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(configureRecord(db, b.record, req.user.id, b.reason));
    }),
  );
  const chatLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: "CHAT_RATE_LIMIT",
          message: "Too many assistant requests. Please try again later.",
        },
      }),
  });
  app.get(
    "/api/chat/sessions",
    auth,
    customer,
    wrap((req, res) => res.json({ sessions: chat.list(req.user.id) })),
  );
  app.post(
    "/api/chat/sessions",
    auth,
    customer,
    chatLimit,
    wrap((req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      res.status(201).json(chat.create(req.user.id));
    }),
  );
  app.get(
    "/api/chat/sessions/:sessionId",
    auth,
    customer,
    wrap((req, res) => res.json(chat.view(req.params.sessionId, req.user.id))),
  );
  app.post(
    "/api/chat/sessions/:sessionId/messages",
    auth,
    customer,
    chatLimit,
    wrap((req, res) =>
      res.json(chat.respond(req.params.sessionId, req.user.id, req.body)),
    ),
  );

  const deviceChecks = createDeviceCheckService({
    db,
    uploads,
    adapter: deviceCheckAdapter || aiAdapter,
    dailyBudget: Number(
      aiDailyBudget ?? process.env.AI_DAILY_BUDGET_CALLS ?? 20,
    ),
  });
  const deviceCheckUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 2,
      fieldSize: 200,
      parts: 3,
    },
  }).single("image");
  const deviceCheckLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  app.get("/api/device-catalog", auth, (req, res) =>
    res.json({
      products: catalog.map((d) => ({
        model_id: d.id,
        name: `${d.brand} ${d.model}`,
        brand: d.brand,
        category: d.category,
      })),
      analysis: deviceChecks.status(),
      max_file_bytes: 5 * 1024 * 1024,
    }),
  );
  app.post(
    "/api/device-checks",
    auth,
    customer,
    deviceCheckLimit,
    deviceCheckUpload,
    wrap(async (req, res) => {
      const body = z
        .object({
          selected_model_id: z.enum(catalogIds),
          claim_id: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      if (!req.file)
        throw new HttpError(
          400,
          "FILE_REQUIRED",
          "Exactly ek JPEG, PNG ya WebP image upload karein (max 5 MB).",
        );
      res.status(201).json(
        await deviceChecks.run({
          ...body,
          userId: req.user.id,
          file: req.file,
        }),
      );
    }),
  );
  app.post(
    "/api/device-checks/:checkId/retry",
    auth,
    customer,
    deviceCheckLimit,
    wrap(async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body || {});
      res.json(
        await deviceChecks.retry(
          z.string().uuid().parse(req.params.checkId),
          req.user.id,
        ),
      );
    }),
  );
  app.get(
    "/api/device-checks",
    auth,
    wrap((req, res) => {
      const { claim_id } = z
        .object({ claim_id: z.string().uuid().optional() })
        .strict()
        .parse(req.query);
      if(req.user.role==='company_reviewer') {
        const claim=claim_id && db.prepare('SELECT * FROM claims WHERE id=?').get(claim_id);
        if(!canReadClaim(req.user,claim))throw new HttpError(404,'NOT_FOUND','Claim not found.');
        return res.json({checks:deviceChecks.list({...req.user,role:'reviewer'},claim_id)});
      }
      res.json({ checks: deviceChecks.list(req.user, claim_id) });
    }),
  );
  app.get(
    "/api/device-checks/:checkId/image",
    auth,
    wrap((req, res) => {
      let row = db
        .prepare(
          "SELECT * FROM device_checks WHERE id=? AND (user_id=? OR ?='reviewer')",
        )
        .get(req.params.checkId, req.user.id, req.user.role);
      if(req.user.role==='company_reviewer') {
        const check=db.prepare('SELECT * FROM device_checks WHERE id=?').get(req.params.checkId);
        const claim=check?.claim_id && db.prepare('SELECT * FROM claims WHERE id=?').get(check.claim_id);
        row=canReadClaim(req.user,claim)?check:null;
      }
      if (!row) throw new HttpError(404, "NOT_FOUND", "Photo nahi mila.");
      res
        .type("image/jpeg")
        .set("Content-Disposition", "inline; filename=device-evidence.jpg")
        .sendFile(resolve(uploads, row.storage_key));
    }),
  );
  app.use("/api", (req, res, next) =>
    next(new HttpError(404, "NOT_FOUND", "API route not found.")),
  );
  const dist = resolve(import.meta.dirname, "../../frontend/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (req, res) => res.sendFile(resolve(dist, "index.html")));
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the submitted fields.",
          details: err.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
      });
    const status = err instanceof multer.MulterError ? 400 : err.status || 500;
    res.status(status).json({
      error: {
        code: err.code || "INTERNAL_ERROR",
        message:
          status === 500 ? "An unexpected server error occurred." : err.message,
      },
    });
  });
  return app;
}
