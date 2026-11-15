import { findCatalogModel, getCatalogItem } from "../catalog.js";
import { deviceCheckObservationSchema } from "../ai/deviceCheckSchema.js";
export const statuses = [
  "VALID_MATCH",
  "DEVICE_MISMATCH",
  "INVALID_DEVICE",
  "UNCLEAR_IMAGE",
  "HUMAN_REVIEW",
];
const messages = {
  MATCH_LINKED_MODEL: [
    "Selected product aur photo ka linked model evidence match karta hai.",
    "Claim ke sab configured checks pass hone par hi approval milega.",
  ],
  DIFFERENT_SUPPORTED_MODEL: [
    "Photo mein doosra supported model mila; selected product se match nahi hai.",
    "Sahi product select karein aur uski fresh photo upload karein.",
  ],
  OUTSIDE_CATALOG: [
    "Photo ka clear subject supported six products mein nahi hai.",
    "Supported device ki photo upload karein.",
  ],
  NEED_LINKED_MODEL: [
    "Device ka readable model evidence isi photo mein linked nahi mila.",
    "Device aur attached model label/About screen ek clear frame mein dikhayein.",
  ],
  PACKAGING_ONLY: [
    "Sirf packaging se device identity verify nahi hoti.",
    "Actual device aur attached model label ek frame mein dikhayein.",
  ],
  RETAKE_BLUR: [
    "Photo blurry hai; model detail readable nahi hai.",
    "Focus karke sharp, bright photo dobara lein.",
  ],
  RETAKE_DARK: [
    "Photo dark hai; device details clear nahi hain.",
    "Achhi roshni mein bina glare ke photo lein.",
  ],
  RETAKE_CROP: [
    "Photo cropped hai; device ya model evidence missing hai.",
    "Poora device aur attached identifier dikhayein.",
  ],
  RETAKE_OCCLUSION: [
    "Device ya model label blocked hai.",
    "Obstruction hata kar clear photo lein.",
  ],
  RETAKE_GLARE: [
    "Glare se model details readable nahi hain.",
    "Reflection avoid karke nayi photo lein.",
  ],
  RETAKE_RESOLUTION: [
    "Photo ki resolution model detail ke liye kam hai.",
    "Original high-resolution photo upload karein.",
  ],
  SYNTHETIC_SIGNAL: [
    "Generated ya synthetic evidence ka signal mila; human review chahiye.",
    "Actual device ki fresh camera photo dein aur reviewer se check karayein.",
  ],
  EDIT_SIGNAL: [
    "Edited ya augmented evidence ka signal mila; authenticity verify nahi hui.",
    "Unedited original camera photo dein; reviewer check required hai.",
  ],
  REPLAY_SIGNAL: [
    "Screenshot, reference-photo reuse ya replay ka signal mila.",
    "Actual device ki fresh camera photo upload karein.",
  ],
  DUPLICATE_SIGNAL: [
    "Is photo ka exact ya normalized hash pehle ke evidence se match hua.",
    "Fresh photo dein; duplicate ka context reviewer check karega.",
  ],
  REGISTRY_CONFLICT: [
    "Photo ke identifier aur claim/verified registry record mein conflict hai.",
    "Model aur serial details reviewer se clarify karein.",
  ],
  SUSPICIOUS_SIGNAL: [
    "Evidence mein uncertainty ya suspicious signal hai; conclusion confirm nahi hai.",
    "Fresh original photo dein aur human review karayein.",
  ],
  AUTHENTICITY_UNKNOWN: [
    "Model evidence mila, lekin authenticity checks incomplete hain.",
    "Human reviewer se evidence check karayein.",
  ],
  ANALYSIS_UNAVAILABLE: [
    "Image analysis abhi available nahi hai; koi automatic approval nahi diya gaya.",
    "Retry karein ya saved photo ke liye human review lein.",
  ],
  CLAIM_CHECKS_REQUIRED: [
    "Model evidence match hai, lekin claim checks sab pass nahi hue hain.",
    "Claim attach karein aur pending warranty/evidence checks reviewer se complete karayein.",
  ],
  ALL_CHECKS_PASSED: [
    "Linked model evidence aur configured claim checks pass hain; koi detected authenticity signal nahi mila.",
    "Approval recommendation reviewer ko dikhayein. Yeh product authenticity ki guarantee nahi hai.",
  ],
};
const qualityCodes = {
  BLURRY: "RETAKE_BLUR",
  DARK: "RETAKE_DARK",
  CROPPED: "RETAKE_CROP",
  OCCLUDED: "RETAKE_OCCLUSION",
  GLARE: "RETAKE_GLARE",
  LOW_RESOLUTION: "RETAKE_RESOLUTION",
  UNKNOWN: "NEED_LINKED_MODEL",
};
export function evaluateDeviceCheck({
  selected_model_id,
  observations = null,
  origin = "user_upload_unverified",
  duplicate = false,
  registryConflict = false,
  claimChecks = [],
  analysisError = null,
}) {
  if (!getCatalogItem(selected_model_id))
    throw new Error("Unsupported selected product");
  const parsed = observations
    ? deviceCheckObservationSchema.parse(observations)
    : null;
  const observed = parsed?.observed_model_text
    ? findCatalogModel(parsed.observed_model_text)
    : null;
  const linked =
    parsed?.identifier_linked_to_pictured_device === true &&
    ["LABEL", "ABOUT_SCREEN"].includes(parsed?.identifying_evidence_kind);
  const result = (
    status,
    code,
    authenticity = "REAL_UNVERIFIED",
    decision = null,
  ) => ({
    status,
    decision:
      decision ||
      {
        VALID_MATCH: "ESCALATE",
        DEVICE_MISMATCH: "REJECT",
        INVALID_DEVICE: "REJECT",
        UNCLEAR_IMAGE: "NEEDS_RETAKE",
        HUMAN_REVIEW: "ESCALATE",
      }[status],
    selected_model_id,
    observed_model_id: linked ? (observed?.id ?? null) : null,
    reason_code: code,
    reason: messages[code][0],
    next_action: messages[code][1],
    confidence: null,
    authenticity,
    origin,
    claim_checks: claimChecks,
    analysis_error: analysisError,
  });
  // Provenance and integrity concerns outrank quality and visual identity.
  if (duplicate)
    return result("HUMAN_REVIEW", "DUPLICATE_SIGNAL", "DUPLICATE_SIGNAL");
  if (["generated_synthetic", "ai_generated"].includes(origin))
    return result("HUMAN_REVIEW", "SYNTHETIC_SIGNAL", "SYNTHETIC_SIGNAL");
  if (
    [
      "digital_edit",
      "augmented",
      "augmented_real",
      "augmented_synthetic",
    ].includes(origin) ||
    origin.startsWith("augmented")
  )
    return result("HUMAN_REVIEW", "EDIT_SIGNAL", "EDIT_SIGNAL");
  if (["real_open_license", "simulated_screenshot"].includes(origin))
    return result("HUMAN_REVIEW", "REPLAY_SIGNAL", "REPLAY_SIGNAL");
  if (registryConflict)
    return result("HUMAN_REVIEW", "REGISTRY_CONFLICT", "UNKNOWN");
  if (!parsed) return result("HUMAN_REVIEW", "ANALYSIS_UNAVAILABLE", "UNKNOWN");
  for (const code of [
    "SYNTHETIC_SIGNAL",
    "EDIT_SIGNAL",
    "REPLAY_SIGNAL",
    "SUSPICIOUS_SIGNAL",
  ])
    if (parsed.authenticity_signals.includes(code))
      return result(
        "HUMAN_REVIEW",
        code,
        code === "SUSPICIOUS_SIGNAL" ? "UNKNOWN" : code,
      );
  if (parsed.quality !== "CLEAR")
    return result("UNCLEAR_IMAGE", qualityCodes[parsed.quality]);
  if (parsed.identifying_evidence_kind === "BOX")
    return result("UNCLEAR_IMAGE", "PACKAGING_ONLY");
  if (linked && observed && parsed.outside_catalog === true)
    return result("HUMAN_REVIEW", "SUSPICIOUS_SIGNAL", "UNKNOWN");
  if (linked && observed) {
    const kind = parsed.device_category.toLowerCase().trim();
    const observedCategory = ["phone", "mobile phone", "smartphone"].includes(
      kind,
    )
      ? "Mobile phone"
      : ["headphone", "headphones", "headset"].includes(kind)
        ? "Headphones"
        : null;
    if (observedCategory && observedCategory !== observed.category)
      return result("HUMAN_REVIEW", "SUSPICIOUS_SIGNAL", "UNKNOWN");
    if (!observedCategory) return result("UNCLEAR_IMAGE", "NEED_LINKED_MODEL");
    if (
      parsed.observed_brand &&
      parsed.observed_brand.toLowerCase().trim() !==
        observed.brand.toLowerCase()
    )
      return result("HUMAN_REVIEW", "SUSPICIOUS_SIGNAL", "UNKNOWN");
  }
  if (linked && observed && observed.id !== selected_model_id)
    return result("DEVICE_MISMATCH", "DIFFERENT_SUPPORTED_MODEL");
  if (parsed.outside_catalog === true && !(linked && observed))
    return result("INVALID_DEVICE", "OUTSIDE_CATALOG");
  if (
    linked &&
    !observed &&
    parsed.observed_model_text &&
    /\d/.test(parsed.observed_model_text) &&
    !/unknown|unreadable|maybe|uncertain|\bor\b/i.test(
      parsed.observed_model_text,
    )
  )
    return result("INVALID_DEVICE", "OUTSIDE_CATALOG");
  if (!linked || !observed) return result("UNCLEAR_IMAGE", "NEED_LINKED_MODEL");
  if (!parsed.authenticity_assessed)
    return result("HUMAN_REVIEW", "AUTHENTICITY_UNKNOWN", "UNKNOWN");
  const allPass =
    claimChecks.length > 0 && claimChecks.every((c) => c.status === "PASS");
  return allPass
    ? result("VALID_MATCH", "ALL_CHECKS_PASSED", "REAL_UNVERIFIED", "APPROVE")
    : result("VALID_MATCH", "CLAIM_CHECKS_REQUIRED");
}
