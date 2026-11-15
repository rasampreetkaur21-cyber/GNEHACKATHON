import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from cases import decide, policy_fixtures  # noqa: E402
from dataset import CATALOG  # noqa: E402


class DatasetPolicyTests(unittest.TestCase):
    def test_catalog_is_exactly_six_products(self):
        self.assertEqual(
            set(CATALOG),
            {
                "samsung-galaxy-a26-5g", "samsung-galaxy-a36-5g", "samsung-galaxy-a56-5g",
                "boat-rockerz-450", "boat-rockerz-550", "boat-rockerz-650",
            },
        )

    def test_matching_and_cross_model(self):
        self.assertEqual(decide("clear", "linked_match"), "MATCH_LINKED_MODEL")
        self.assertEqual(decide("clear", "different_supported"), "DIFFERENT_SUPPORTED_MODEL")
        self.assertEqual(decide("clear", "outside_catalog"), "OUTSIDE_CATALOG")

    def test_quality_and_authenticity_escalation(self):
        self.assertEqual(decide("blurry", "linked_match"), "RETAKE_BLUR")
        self.assertEqual(decide("clear", "linked_match", "synthetic_indication"), "SYNTHETIC_SIGNAL")
        self.assertEqual(decide("clear", "linked_match", "exact_hash_on_other_claim"), "DUPLICATE_SIGNAL")

    def test_policy_covers_all_selected_models_and_hard_cases(self):
        cases = policy_fixtures()
        self.assertTrue(all(case["selected_model_id"] in CATALOG for case in cases))
        statuses = {case["expected_status"] for case in cases}
        self.assertTrue({"VALID_MATCH", "DEVICE_MISMATCH", "INVALID_DEVICE", "UNCLEAR_IMAGE", "HUMAN_REVIEW"} <= statuses)


if __name__ == "__main__":
    unittest.main()
