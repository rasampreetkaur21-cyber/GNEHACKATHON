import { validateObservations } from "../ai/schemas.js";
import { findCatalogModel, getCatalogItem } from "../catalog.js";
export const ENGINE_VERSION = "3.2";
export const RULE_VERSION = "1.0";
export function readable(value) {
  if (typeof value !== "string") return false;
  return (
    !!value.trim() &&
    !/^(UNKNOWN|UNREADABLE|N\/?A|NONE|NULL)$/i.test(value.trim()) &&
    !/[?]/.test(value) &&
    !/(?:O\/0|0\/O|I\/1|1\/I|L\/1|1\/L)/i.test(value)
  );
}
export const identityKey = (v) =>
  readable(v) ? v.toUpperCase().replace(/[\s-]/g, "") : null;
export const modelIdentityKey = (v) =>
  findCatalogModel(v)?.id ?? identityKey(v);
export const category = (v) => {
  if (typeof v !== "string") return null;
  return (
    {
      "mobile phone": "Mobile phone",
      phone: "Mobile phone",
      smartphone: "Mobile phone",
      headphones: "Headphones",
      laptop: "Laptop",
      notebook: "Laptop",
      "washing machine": "Washing machine",
      washer: "Washing machine",
      "air conditioner": "Air conditioner",
      ac: "Air conditioner",
    }[v.toLowerCase().trim()] || null
  );
};
export const validDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export const trusted = (row, claim) =>
  row?.verified === 1 &&
  Number(row.synthetic || 0) === Number(claim.synthetic || 0);
export const simulatedObservation = (e, claim) =>
  claim.synthetic === 1 &&
  e.synthetic === 1 &&
  e.processing_status === "SIMULATED_FIXTURE" &&
  e.trust_tier === "SIMULATED";
export const usableObservation = (e, claim) =>
  simulatedObservation(e, claim) ||
  (e.processing_status === "ANALYSIS_COMPLETE" &&
    ["EXTRACTED", "VERIFIED"].includes(e.trust_tier));
export function collectFacts({
  claim,
  evidence = [],
  registry,
  policy,
  services = [],
  diagnostics = [],
  annotations = [],
  sellers = [],
  registryCandidates = [],
  policyCandidates = [],
}) {
  const own = evidence.filter((e) => e.claim_id === claim.id && e.active !== 0);
  const facts = [];
  const add = (id, source, trustTier, kind, value, evidenceId = null) =>
    facts.push({
      id,
      source,
      trustTier,
      kind,
      value,
      rawValue: value,
      evidenceId,
    });
  for (const [kind, value] of Object.entries({
    serial: claim.serial,
    model: claim.model,
    product: claim.product,
    purchase_date: claim.purchase_date,
    statement: claim.statement,
    previous_repairs: claim.previous_repairs,
    claim_value_minor: claim.claim_value_minor,
  }))
    add("claim:" + claim.id + ":" + kind, "CUSTOMER", "ASSERTED", kind, value);
  if (claim.questionnaire_json)
    add(
      "claim:" + claim.id + ":questionnaire",
      "CUSTOMER",
      "ASSERTED",
      "questionnaire",
      JSON.parse(claim.questionnaire_json),
    );
  const observations = [];
  for (const e of own) {
    if (!usableObservation(e, claim) || !["photo", "invoice"].includes(e.kind))
      continue;
    try {
      const value = validateObservations(
        typeof e.observations === "string"
          ? JSON.parse(e.observations)
          : e.observations,
        e.kind,
      );
      observations.push({ evidence: e, value });
      for (const [field, raw] of Object.entries(value)) {
        if (["type", "unknown_fields"].includes(field)) continue;
        const kind =
          field === "serial_number" || field === "serial_text"
            ? "serial"
            : field === "model_text" || field === "product_model"
              ? "model"
              : field === "invoice_date"
                ? "purchase_date"
                : field;
        add(
          "evidence:" + e.id + ":" + field,
          simulatedObservation(e, claim) ? "SYNTHETIC_FIXTURE" : "UPLOAD",
          e.trust_tier,
          kind,
          value.unknown_fields.includes(field) ? "UNKNOWN" : raw,
          e.id,
        );
        facts[facts.length - 1].rawValue = raw;
      }
    } catch {
      /* Invalid/legacy observations remain unknown, never promoted. */
    }
  }
  for (const a of annotations) {
    if (!own.some((e) => e.id === a.evidence_id)) continue;
    const fields =
      typeof a.fields === "string" ? JSON.parse(a.fields) : a.fields;
    for (const [kind, value] of Object.entries(fields))
      add(
        "annotation:" + a.id + ":" + kind,
        "CUSTOMER_ANNOTATION",
        "ASSERTED",
        ["serial_number", "serial_text"].includes(kind)
          ? "serial"
          : ["product_model", "model_text"].includes(kind)
            ? "model"
            : kind,
        value,
        a.evidence_id,
      );
  }
  if (trusted(registry, claim))
    add(
      "registry:" + registry.serial,
      "COMPANY_REGISTRY",
      "VERIFIED",
      "registry",
      {
        serial: registry.serial,
        product: registry.product,
        model: registry.model,
        purchase_date: registry.purchase_date,
        service_count: registry.service_count,
      },
    );
  if (trusted(policy, claim))
    add("policy:" + policy.id, "COMPANY_POLICY", "VERIFIED", "policy", {
      product: policy.product,
      months: policy.months,
      auto_approve_limit_minor: policy.auto_approve_limit_minor,
      currency: policy.currency,
    });
  for (const s of services.filter((s) => trusted(s, claim)))
    add("service:" + s.id, "COMPANY_SERVICE", "VERIFIED", "service", {
      date: s.service_date,
      authorized: s.authorized,
      summary: s.summary,
    });
  for (const d of diagnostics.filter((d) => trusted(d, claim)))
    add(
      "diagnostic:" + d.id,
      "COMPANY_DIAGNOSTIC",
      "VERIFIED",
      "diagnostic",
      typeof d.facts === "string" ? JSON.parse(d.facts) : d.facts,
    );
  for (const s of sellers.filter((s) => trusted(s, claim)))
    add("seller:" + s.id, "COMPANY_SELLER_LIST", "VERIFIED", "seller", {
      name: s.seller_name,
      authorized: s.authorized,
    });
  if (!registry)
    for (const r of registryCandidates.filter((r) => trusted(r, claim)))
      add(
        "registry:" + r.serial,
        "COMPANY_REGISTRY",
        "VERIFIED",
        "unresolved_registry",
        {
          serial: r.serial,
          product: r.product,
          model: r.model,
          purchase_date: r.purchase_date,
          service_count: r.service_count,
        },
      );
  if (!policy)
    for (const p of policyCandidates.filter((p) => trusted(p, claim)))
      add("policy:" + p.id, "COMPANY_POLICY", "VERIFIED", "unresolved_policy", {
        product: p.product,
        months: p.months,
        auto_approve_limit_minor: p.auto_approve_limit_minor,
        currency: p.currency,
      });
  return { own, facts, observations };
}
export function chooseVerdict({
  results,
  independentAnchor,
  policyValid,
  valueEligible,
  essentialEvidence,
  deviceVerificationStatus,
}) {
  if (deviceVerificationStatus === "INVALID_DEVICE")
    return {
      outcome: "ESCALATE",
      explanation:
        "The photo identifies a different device or an unrelated subject. An authorized reviewer must resolve the mismatch.",
    };
  if (deviceVerificationStatus === "UNVERIFIED")
    return {
      outcome: "NEEDS_EVIDENCE",
      explanation:
        "The photo did not verify the selected device. Follow the evidence request to provide a usable photo or resolve the discrepancy.",
    };
  const relevant = results.filter((r) => r.ruleId !== "R09");
  const warranty = relevant.find((r) => r.ruleId === "R02");
  const material =
    relevant.some(
      (r) =>
        r.status === "FAIL" &&
        r.ruleId !== "R02" &&
        (r.essential || ["MAJOR", "CRITICAL"].includes(r.severity)),
    ) || !!warranty?.materialContradiction;
  if (
    warranty?.status === "FAIL" &&
    independentAnchor &&
    warranty.failureType === "EXPIRY" &&
    !material
  )
    return {
      outcome: "REJECT_RECOMMENDED",
      explanation:
        "R02 found warranty expiry using an independently anchored purchase date, with no other material contradictions. This is advisory; an authorized reviewer must decide.",
    };
  if (
    relevant.some(
      (r) =>
        r.status === "FAIL" &&
        (r.essential || ["MAJOR", "CRITICAL"].includes(r.severity)),
    ) ||
    (warranty?.status === "FAIL" && !independentAnchor)
  )
    return {
      outcome: "ESCALATE",
      explanation:
        "A material contradiction or failed essential check needs an authorized reviewer. No customer misconduct is inferred.",
    };
  if (
    relevant.some((r) => r.essential && r.status === "UNKNOWN") ||
    !essentialEvidence ||
    deviceVerificationStatus !== "MATCH"
  )
    return {
      outcome: "NEEDS_EVIDENCE",
      explanation:
        "Essential evidence is missing, unreadable or unverified. Missing evidence is not proof of misconduct.",
    };
  if (
    relevant.filter((r) => r.essential).every((r) => r.status === "PASS") &&
    independentAnchor &&
    policyValid &&
    valueEligible
  )
    return {
      outcome: "AUTO_APPROVE",
      explanation:
        "Essential checks pass with an independent registry anchor, applicable verified policy and requested value within its configured threshold. This remains a recommendation; a reviewer records the final decision.",
    };
  return {
    outcome: "ESCALATE",
    explanation:
      "Automatic recommendation conditions are not all satisfied, including the independent anchor, applicable policy or configured value threshold. Human review is required.",
  };
}
export function evaluate(context) {
  const {
    claim,
    registry,
    policy,
    sellers = [],
    services = [],
    diagnostics = [],
    deviceVerifications = [],
    links = [],
    historyCount = 0,
    linkageChecked = false,
  } = context;
  const { own, facts, observations } = collectFacts(context);
  const selectedDevice = getCatalogItem(claim.catalog_id);
  const invoices = observations.filter((o) => o.evidence.kind === "invoice"),
    photos = observations.filter((o) => o.evidence.kind === "photo");
  const value = (o, key) =>
    o.value.unknown_fields.includes(key) ? "UNKNOWN" : o.value[key];
  const ref = (list) => [...new Set(list.map((o) => o.evidence.id))];
  const make = (
    ruleId,
    status,
    severity,
    essential,
    reason,
    evidenceIds = [],
    extra = {},
  ) => ({
    ruleId,
    ruleVersion: RULE_VERSION,
    status,
    severity,
    essential,
    evidenceIds,
    reason,
    explanation: reason,
    ...extra,
  });
  const regTrusted = trusted(registry, claim),
    anchor =
      regTrusted &&
      validDate(registry.purchase_date) &&
      category(registry.product) === category(claim.product) &&
      category(claim.product) !== null;
  const policyValid =
    trusted(policy, claim) &&
    category(policy.product) === category(claim.product) &&
    category(claim.product) !== null &&
    Number.isInteger(policy.months) &&
    policy.months > 0 &&
    policy.months <= 120;
  const serialEntries = [
    { raw: claim.serial, source: "claim" },
    ...invoices.map((o) => ({
      raw: value(o, "serial_number"),
      source: o.evidence.id,
    })),
    ...photos.map((o) => ({
      raw: value(o, "serial_text"),
      source: o.evidence.id,
    })),
  ];
  if (regTrusted)
    serialEntries.push({ raw: registry.serial, source: "registry" });
  for (const f of facts.filter(
    (f) => f.source === "CUSTOMER_ANNOTATION" && f.kind === "serial",
  ))
    serialEntries.push({ raw: f.value, source: f.id });
  const serials = serialEntries.map((v) => identityKey(v.raw)).filter(Boolean);
  const modelEntries = [
    selectedDevice?.model ?? claim.model,
    ...invoices.map((o) => value(o, "product_model")),
    ...photos.map((o) => {
      if (!Object.hasOwn(o.value, "observed_model_text"))
        return value(o, "model_text");
      if (
        value(o, "image_quality") === "CLEAR" &&
        ["LABEL", "ABOUT_SCREEN"].includes(
          value(o, "identifying_evidence_kind"),
        ) &&
        value(o, "identifier_linked_to_pictured_device") === "YES"
      )
        return value(o, "observed_model_text");
    }),
    regTrusted ? registry.model : null,
  ]
    .map(modelIdentityKey)
    .filter(Boolean);
  const serialConflict = new Set(serials).size > 1;
  const identityConflict =
    serialConflict ||
    new Set(modelEntries).size > 1 ||
    (category(claim.product) &&
      invoices.some(
        (o) =>
          category(value(o, "product_name")) &&
          category(value(o, "product_name")) !== category(claim.product),
      )) ||
    (regTrusted &&
      category(claim.product) &&
      category(registry.product) !== category(claim.product));
  const docSerial = [
    ...invoices.map((o) => value(o, "serial_number")),
    ...photos.map((o) => value(o, "serial_text")),
  ].some((v) => identityKey(v));
  const identityStatus = identityConflict
    ? "FAIL"
    : category(claim.product) && docSerial && serials.length >= 2
      ? "PASS"
      : "UNKNOWN";
  const r1 = make(
    "R01",
    identityStatus,
    identityConflict ? "MAJOR" : "INFO",
    true,
    serialConflict
      ? "Readable serial numbers disagree. Compare the claim, uploaded evidence and registry serials in the ledger."
      : identityConflict
        ? "Readable model or product values disagree. Originals are preserved in the ledger for review."
        : identityStatus === "PASS"
          ? "Readable identity values agree across customer, uploaded and available company records."
          : "Readable corroborating serial/model information or a supported product category is missing.",
    ref([...invoices, ...photos]),
  );
  const purchase = anchor ? registry.purchase_date : claim.purchase_date;
  const invoiceDates = invoices
    .map((o) => value(o, "invoice_date"))
    .filter(validDate);
  const dateConflict =
    anchor &&
    ((validDate(claim.purchase_date) &&
      claim.purchase_date !== registry.purchase_date) ||
      invoiceDates.some((d) => d !== registry.purchase_date));
  let r2 = make(
    "R02",
    "UNKNOWN",
    "INFO",
    true,
    context.policyAmbiguous
      ? "Applicable company policy records disagree; an authorized reviewer must resolve the configuration before eligibility can be established."
      : "An applicable verified company policy and a readable purchase date are needed.",
    ref(invoices),
    { independentlyAnchored: anchor },
  );
  if (policyValid && validDate(purchase) && validDate(claim.incident_date)) {
    const end = new Date(purchase + "T00:00:00Z");
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + policy.months);
    end.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
    const expiry = end.toISOString().slice(0, 10);
    const expired =
      claim.incident_date > expiry || claim.incident_date < purchase;
    r2 = make(
      "R02",
      expired || dateConflict ? "FAIL" : "PASS",
      expired || dateConflict ? "MAJOR" : "INFO",
      true,
      `Coverage calculation uses ${anchor ? "independently registry-confirmed" : "ASSERTED customer"} purchase date ${purchase}, through ${expiry}, and incident ${claim.incident_date}.${dateConflict ? " Purchase-date sources disagree and require clarification." : ""}${!anchor ? " This calculation is not independent verification." : ""}`,
      ref(invoices),
      {
        independentlyAnchored: anchor,
        failureType: expired ? "EXPIRY" : dateConflict ? "DATE_CONFLICT" : null,
        materialContradiction: !!dateConflict,
      },
    );
  }
  const sellerValues = invoices
    .map((o) => value(o, "seller_name"))
    .filter(readable);
  const configured = sellers.filter((s) => trusted(s, claim));
  const unauthorized =
    configured.length > 0 &&
    sellerValues.some((v) => {
      const found = configured.find(
        (s) => s.seller_name.trim().toLowerCase() === v.trim().toLowerCase(),
      );
      return !found || found.authorized !== 1;
    });
  const r3 = make(
    "R03",
    !configured.length || !sellerValues.length
      ? "UNKNOWN"
      : unauthorized
        ? "FAIL"
        : "PASS",
    unauthorized ? "MAJOR" : "INFO",
    false,
    !configured.length
      ? "No company seller list is configured. Seller authorization is UNKNOWN."
      : !sellerValues.length
        ? "Seller information is unreadable or missing."
        : unauthorized
          ? "The extracted seller is not authorized by the configured company list; reviewer verification is required."
          : "Extracted seller matches the configured authorized company seller list.",
    ref(invoices),
  );
  const photoEvidence = own.filter((e) => e.kind === "photo");
  const activeVerifications = selectedDevice
    ? deviceVerifications.filter(
        (v) =>
          v.active === 1 &&
          v.claim_id === claim.id &&
          v.catalog_id === selectedDevice.id &&
          photoEvidence.some(
            (e) =>
              e.id === v.evidence_id &&
              e.sha256 === v.image_sha256 &&
              (e.processing_status !== "SIMULATED_FIXTURE" ||
                simulatedObservation(e, claim)),
          ),
      )
    : [];
  const deviceVerificationStatus = [
    "INVALID_DEVICE",
    "UNVERIFIED",
    "MATCH",
  ].find((status) => activeVerifications.some((v) => v.status === status));
  const verificationEvidence = activeVerifications.filter(
    (v) => v.status === deviceVerificationStatus,
  );
  const verification = verificationEvidence[0];
  const photoMismatch = deviceVerificationStatus === "INVALID_DEVICE";
  const photoMatch = deviceVerificationStatus === "MATCH";
  const r4 = make(
    "R04",
    photoMismatch ? "FAIL" : photoMatch ? "PASS" : "UNKNOWN",
    photoMismatch ? "MAJOR" : "INFO",
    true,
    verification?.reason ??
      "A photo with a readable identifier linked to the selected device is needed to verify the exact model.",
    verification
      ? verificationEvidence.map((v) => v.evidence_id)
      : photoEvidence.map((e) => e.id),
  );
  const deniesDamage =
    claim.declared_no_visible_damage === 1 ||
    claim.declared_no_visible_damage === true ||
    (claim.declared_no_visible_damage == null &&
      /(?:^|[.!?]\s+)(?:there (?:are|is) )?no (?:visible )?(?:cracks|dents|physical damage)(?:[.!?]|$)/i.test(
        claim.statement || "",
      ));
  const visibleDamage = photos.some(
    (o) =>
      value(o, "visible_cracks") === "VISIBLE" ||
      value(o, "visible_dents") === "VISIBLE",
  );
  const contradiction = deniesDamage && visibleDamage;
  const r5 = make(
    "R05",
    contradiction
      ? "FAIL"
      : !deniesDamage
        ? "UNKNOWN"
        : photos.length &&
            photos.every(
              (o) =>
                value(o, "visible_cracks") === "NOT_VISIBLE" &&
                value(o, "visible_dents") === "NOT_VISIBLE",
            )
          ? "PASS"
          : "UNKNOWN",
    contradiction ? "MAJOR" : "INFO",
    false,
    contradiction
      ? "The explicit statement of no cracks/dents conflicts with a visible extracted crack/dent observation. This is a clarification flag, not proof of intent."
      : "No clear damage-description contradiction is established. Ambiguous or internal failures remain UNKNOWN.",
    ref(photos),
  );
  const indicators = photos.some(
    (o) =>
      value(o, "visible_liquid_contact_indicator") === "VISIBLE" ||
      value(o, "visible_tamper_signs") === "VISIBLE",
  );
  const indicatorsKnown =
    photos.length &&
    photos.every(
      (o) =>
        value(o, "visible_liquid_contact_indicator") === "NOT_VISIBLE" &&
        value(o, "visible_tamper_signs") === "NOT_VISIBLE",
    );
  const r6 = make(
    "R06",
    indicators ? "FAIL" : indicatorsKnown ? "PASS" : "UNKNOWN",
    indicators ? "MAJOR" : "INFO",
    false,
    indicators
      ? "A liquid-contact indicator or external tamper sign is reported visible. Review the image; internal damage and intentional misuse are not inferred."
      : "No visible liquid/tamper conclusion beyond the photograph is available. NOT_VISIBLE does not establish the absence of hidden damage.",
    ref(photos),
  );
  const currentLinks = links.filter(
    (l) => !l.evidenceId || own.some((e) => e.id === l.evidenceId),
  );
  const identityLinks = currentLinks.filter(
    (l) => l.type === "SERIAL" || l.type === "INVOICE",
  );
  const imageLinks = currentLinks.filter((l) => l.type === "IMAGE");
  const r7 = make(
    "R07",
    identityLinks.length ? "FAIL" : linkageChecked ? "PASS" : "UNKNOWN",
    identityLinks.length ? "MAJOR" : "INFO",
    false,
    identityLinks.length
      ? "Identity evidence requires restricted linked-case verification by an authorized reviewer. This does not establish misconduct."
      : "No cross-customer identity linkage found in the checked company dataset.",
    identityLinks.flatMap((l) => (l.evidenceId ? [l.evidenceId] : [])),
  );
  const r8 = make(
    "R08",
    imageLinks.length ? "FAIL" : linkageChecked ? "PASS" : "UNKNOWN",
    imageLinks.length ? "MAJOR" : "INFO",
    false,
    imageLinks.length
      ? "An exact image hash needs restricted linked-case review. Duplicate imagery alone is not proof of fraud."
      : "No exact cross-customer image reuse found; same-customer reuploads are ignored.",
    imageLinks.map((l) => l.evidenceId),
  );
  const r9 = make(
    "R09",
    "PASS",
    "INFO",
    false,
    `This customer has ${historyCount} previous submitted claim(s). History is informational only and never changes the verdict.`,
  );
  const verifiedServices = services.filter((s) => trusted(s, claim));
  const verifiedDiagnostics = diagnostics.filter((d) => trusted(d, claim));
  const declaredUnauthorized =
    claim.declared_unauthorized_repairs === 1 ||
    claim.declared_unauthorized_repairs === true;
  const recordedUnauthorized =
    verifiedServices.some((s) => s.authorized === 0) ||
    verifiedDiagnostics.some(
      (d) =>
        (typeof d.facts === "string" ? JSON.parse(d.facts) : d.facts)
          .unauthorized_repair === true,
    );
  const recordedCount = Math.max(
    regTrusted ? registry.service_count || 0 : 0,
    verifiedServices.length,
  );
  const serviceConflict =
    Number.isInteger(claim.previous_repairs) &&
    recordedCount > claim.previous_repairs;
  const repairFail =
    declaredUnauthorized || recordedUnauthorized || serviceConflict;
  const r10 = make(
    "R10",
    repairFail
      ? "FAIL"
      : regTrusted && recordedCount === claim.previous_repairs
        ? "PASS"
        : "UNKNOWN",
    repairFail ? "MAJOR" : "INFO",
    false,
    repairFail
      ? "A declared/verified unauthorized repair or independently recorded repair contradicts the declared repair count. Human clarification is required."
      : "No contradictory or unauthorized repair is established. Absence of a service record does not prove a repair occurred.",
  );
  r1.recordIds = regTrusted
    ? ["registry:" + registry.serial]
    : (context.registryCandidates || [])
        .filter((r) => trusted(r, claim))
        .map((r) => "registry:" + r.serial);
  r2.recordIds = [
    ...(anchor ? ["registry:" + registry.serial] : []),
    ...(policyValid
      ? ["policy:" + policy.id]
      : (context.policyCandidates || [])
          .filter((p) => trusted(p, claim))
          .map((p) => "policy:" + p.id)),
  ];
  r3.recordIds = configured
    .filter((s) =>
      sellerValues.some(
        (v) => v.trim().toLowerCase() === s.seller_name.trim().toLowerCase(),
      ),
    )
    .map((s) => "seller:" + s.id);
  r10.recordIds = [
    ...(regTrusted ? ["registry:" + registry.serial] : []),
    ...verifiedServices.map((s) => "service:" + s.id),
    ...verifiedDiagnostics.map((d) => "diagnostic:" + d.id),
  ];
  const results = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10];
  const allowed = new Set(own.map((e) => e.id));
  for (const r of results) {
    r.evidenceIds = [...new Set(r.evidenceIds)].filter((id) => allowed.has(id));
    r.recordIds ||= [];
  }

  const invoiceValidated = invoices.some((o) =>
    ["invoice_date", "invoice_number", "serial_number"].some((k) =>
      readable(value(o, k)),
    ),
  );
  const essentialEvidence = invoiceValidated && photoMatch;
  const valueEligible =
    policyValid &&
    Number.isInteger(policy.auto_approve_limit_minor) &&
    policy.auto_approve_limit_minor >= 0 &&
    Number.isInteger(claim.claim_value_minor) &&
    claim.claim_value_minor >= 0 &&
    claim.claim_value_minor <= policy.auto_approve_limit_minor &&
    claim.currency === policy.currency;
  const verdict = chooseVerdict({
    results,
    independentAnchor: anchor,
    policyValid,
    valueEligible,
    essentialEvidence,
    deviceVerificationStatus,
  });
  const requests = [];
  const request = (key, priority, text, target = "CUSTOMER") =>
    requests.push({ key, priority, text, target });
  if (identityConflict || photoMismatch)
    request(
      "identity_review",
      1,
      "Ask an authorized reviewer to resolve product/identity differences before a decision.",
      "REVIEWER",
    );
  if (!category(claim.product))
    request(
      "product_category",
      5,
      "Ask a company reviewer to identify a supported product category; an unsupported device cannot be automatically matched.",
      "REVIEWER",
    );
  if (!invoiceValidated)
    request(
      "invoice",
      10,
      "Provide a readable purchase invoice image or ask a reviewer to verify purchase proof.",
    );
  if (!docSerial)
    request(
      "device_label",
      20,
      "Provide a clear device-label photo showing the serial and model.",
    );
  if (!photoMatch && (verification || category(claim.product)))
    request(
      "product_photo",
      verification ? 2 : 30,
      verification?.next_action ??
        "Take a sharp photo showing the device and its readable model label or About screen in the same frame.",
    );
  if (!validDate(purchase))
    request(
      "purchase_date",
      35,
      "Provide dated purchase proof; an asserted date alone is not independently verified.",
    );
  if (!policyValid)
    request(
      "policy_verification",
      40,
      "Ask the company reviewer to configure or verify the applicable warranty policy.",
      "REVIEWER",
    );
  if (!anchor)
    request(
      "registry_verification",
      50,
      "Ask the company reviewer to verify the product and purchase date against company records.",
      "REVIEWER",
    );
  if (
    /(?:internal|stopped working|does not turn on|no power|not cooling)/i.test(
      claim.statement || "",
    ) &&
    !verifiedDiagnostics.some(
      (d) =>
        (typeof d.facts === "string" ? JSON.parse(d.facts) : d.facts)
          .inspection_completed === true,
    )
  )
    request(
      "technician_inspection",
      60,
      "Arrange technician diagnostics for an internal failure that cannot be established visually.",
      "REVIEWER",
    );
  const nextEvidence = requests
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);
  const reconciliation = {
    evidence: own.map((e) => ({
      id: e.id,
      kind: e.kind,
      sourceReference: e.source_reference || "upload:" + e.id,
      trustTier: e.trust_tier,
      processingStatus: e.processing_status,
    })),
    facts,
    supporting: results
      .filter((r) => r.status === "PASS")
      .map((r) => ({
        ruleId: r.ruleId,
        evidenceIds: r.evidenceIds,
        recordIds: r.recordIds,
        reason: r.reason,
      })),
    contradictions: results
      .filter((r) => r.status === "FAIL")
      .map((r) => ({
        ruleId: r.ruleId,
        evidenceIds: r.evidenceIds,
        recordIds: r.recordIds,
        reason: r.reason,
      })),
    missing: nextEvidence,
    independentAnchor: anchor,
    policyValid,
    valueEligible,
    essentialEvidence,
  };
  return {
    engineVersion: ENGINE_VERSION,
    ...verdict,
    results,
    nextEvidence,
    reconciliation,
    privateLinks: currentLinks,
  };
}
