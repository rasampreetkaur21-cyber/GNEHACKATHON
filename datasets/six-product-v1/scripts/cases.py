"""Claim-review policy fixtures. Inputs here represent observations, not a vision model."""
from dataset import CASE_FIELDS, CATALOG, QUALITY_REASONS, write_tables

REASONS = {
    "MATCH_LINKED_MODEL": ("VALID_MATCH", "Readable model is linked to the pictured device.", "CONTINUE_CLAIM_CHECKS"),
    "DIFFERENT_SUPPORTED_MODEL": ("DEVICE_MISMATCH", "Evidence identifies a different supported model.", "REPLACE_PHOTO_OR_CORRECT_MODEL"),
    "OUTSIDE_CATALOG": ("INVALID_DEVICE", "The clear subject is outside the supported catalog.", "UPLOAD_SUPPORTED_DEVICE"),
    "NEED_LINKED_MODEL": ("UNCLEAR_IMAGE", "Exact model needs a readable identifier linked to this device.", "UPLOAD_ID_PHOTO"),
    "RETAKE_BLUR": ("UNCLEAR_IMAGE", "Blur obscures identifying detail.", "RETAKE_PHOTO"),
    "RETAKE_DARK": ("UNCLEAR_IMAGE", "Lighting is too low to see identifying detail.", "RETAKE_PHOTO"),
    "RETAKE_CROP": ("UNCLEAR_IMAGE", "The image omits the device or identifying area.", "RETAKE_PHOTO"),
    "RETAKE_OCCLUSION": ("UNCLEAR_IMAGE", "The device is partly blocked.", "RETAKE_PHOTO"),
    "RETAKE_GLARE": ("UNCLEAR_IMAGE", "Reflections conceal the identifying area.", "RETAKE_PHOTO"),
    "RETAKE_RESOLUTION": ("UNCLEAR_IMAGE", "Resolution is too low to read identifying detail.", "RETAKE_PHOTO"),
    "SYNTHETIC_SIGNAL": ("HUMAN_REVIEW", "An authenticity signal suggests generated imagery. Request a fresh photo.", "REVIEW_AND_REQUEST_FRESH_PHOTO"),
    "EDIT_SIGNAL": ("HUMAN_REVIEW", "The damage region may have been altered. Request a fresh photo.", "REVIEW_AND_REQUEST_FRESH_PHOTO"),
    "REPLAY_SIGNAL": ("HUMAN_REVIEW", "The upload appears to be a screenshot or recaptured image.", "REVIEW_AND_REQUEST_FRESH_PHOTO"),
    "DUPLICATE_SIGNAL": ("HUMAN_REVIEW", "An exact image hash matched evidence on another claim.", "REVIEW_AND_REQUEST_FRESH_PHOTO"),
    "REGISTRY_CONFLICT": ("HUMAN_REVIEW", "The device identifier and claim record conflict.", "REVIEW_DEVICE_EVIDENCE"),
}
SIGNAL_REASONS = {
    "synthetic_indication": "SYNTHETIC_SIGNAL",
    "damage_edit_indication": "EDIT_SIGNAL",
    "replay_indication": "REPLAY_SIGNAL",
    "exact_hash_on_other_claim": "DUPLICATE_SIGNAL",
    "registry_conflict": "REGISTRY_CONFLICT",
}


def decide(quality, observed_relation, authenticity_signal="none"):
    if authenticity_signal != "none":
        return SIGNAL_REASONS[authenticity_signal]
    if quality != "clear":
        return QUALITY_REASONS[quality]
    return {
        "linked_match": "MATCH_LINKED_MODEL",
        "different_supported": "DIFFERENT_SUPPORTED_MODEL",
        "outside_catalog": "OUTSIDE_CATALOG",
        "unverified": "NEED_LINKED_MODEL",
    }[observed_relation]


def make_case(case_id, selected, truth, quality, observation, signal="none", asset=None):
    code = decide(quality, observation, signal)
    status, reason, action = REASONS[code]
    return {
        "case_id": case_id, "asset_id": asset["asset_id"] if asset else "",
        "image_path": asset["image_path"] if asset else "",
        "selected_model_id": selected, "identity_relation": truth,
        "expected_status": status, "reason_code": code, "reason": reason,
        "next_action": action, "evaluation_mode": "image" if asset else "policy_fixture",
        "evidence_quality": quality, "observed_relation": observation,
        "authenticity_signal": signal, "split": asset["split"] if asset else "policy_fixture",
    }


def relation_for(asset, selected):
    model = asset["model_id"]
    if model in CATALOG:
        return "same_supported" if model == selected else "other_supported"
    return "unsupported" if model == "unsupported" else "unknown"


def cases_for_assets(assets):
    cases = []
    for asset in assets:
        signal = {
            "ai_generated": "synthetic_indication",
            "digital_edit": "damage_edit_indication",
            "simulated_screenshot": "replay_indication",
        }.get(asset["origin"], "none")
        selected_models = (asset["prompted_model_id"],) if asset["prompted_model_id"] else CATALOG
        for selected in selected_models:
            truth = relation_for(asset, selected)
            observation = "unverified"
            if truth == "unsupported" and asset["visible_model_evidence"] == "outside_catalog":
                observation = "outside_catalog"
            elif asset["visible_model_evidence"] == "device_linked":
                observation = {
                    "same_supported": "linked_match", "other_supported": "different_supported",
                    "unsupported": "outside_catalog", "unknown": "unverified",
                }[truth]
            elif (truth == "other_supported"
                  and CATALOG[asset["model_id"]]["category"] != CATALOG[selected]["category"]):
                observation = "different_supported"
            cases.append(make_case(
                f"img-{asset['asset_id']}--{selected}", selected, truth, asset["quality"],
                observation, signal, asset,
            ))
    return cases


def policy_fixtures():
    cases = []
    for selected in CATALOG:
        for actual in CATALOG:
            same = selected == actual
            cases.append(make_case(
                f"policy-{selected}--observed-{actual}", selected,
                "same_supported" if same else "other_supported", "clear",
                "linked_match" if same else "different_supported",
            ))
        specs = (
            ("unsupported", "unsupported", "clear", "outside_catalog", "none"),
            ("lookalike", "other_supported", "clear", "unverified", "none"),
            ("packaging-only", "same_supported", "clear", "unverified", "none"),
            ("blur", "same_supported", "blurry", "unverified", "none"),
            ("synthetic", "unknown", "clear", "unverified", "synthetic_indication"),
            ("edit", "same_supported", "clear", "linked_match", "damage_edit_indication"),
            ("duplicate", "same_supported", "clear", "linked_match", "exact_hash_on_other_claim"),
            ("registry", "same_supported", "clear", "linked_match", "registry_conflict"),
        )
        for name, truth, quality, observation, signal in specs:
            cases.append(make_case(f"policy-{selected}--{name}", selected, truth, quality, observation, signal))
    return cases


def save_cases(folder, assets, include_policy=False):
    cases = cases_for_assets(assets)
    if include_policy:
        cases.extend(policy_fixtures())
    return write_tables(folder, "cases", CASE_FIELDS, cases)
