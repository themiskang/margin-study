"""Replay saved PDF Crop evidence; never opens or reads a live vault.

Screenshots were inspected during native capture. AX includes offscreen text:
this replay verifies saved states and controls, not pixel or gesture parity.
"""

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

DEV = Path(__file__).resolve().parents[2]
NATIVE = DEV / "evidence/native-max-l4"
BEFORE = DEV / "evidence/checkpoints/20261017-pdf-crop-before"
PDF = "l4-sample-alpha.pdf"


def read(path):
    return json.loads(path.read_text())


def file_for(number, suffix):
    matches = list(NATIVE.glob(f"{number}-*.{suffix}"))
    if len(matches) != 1:
        raise ValueError(f"Expected one capture {number}/{suffix}, got {matches}")
    return matches[0]


def capture(number, suffix="host.json"):
    return read(file_for(number, suffix))


def ax(number):
    return file_for(number, "ax.txt").read_text()


def crop(number):
    return capture(number)["docMeta"][PDF]["pdfCrop"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


before = read(BEFORE / "host-before.json")
raw_before = read(BEFORE / "installed-data.json")
after = read(NATIVE / "322-plugin-pdf-crop-final-data.json")
raw_after = capture(321)
receipt = read(DEV / "evidence/checkpoints/20261017-pdf-crop-deployment.json")
verification = read(DEV / "evidence/verification/pdf-crop-final-green/results.json")
reader = read(DEV / "evidence/verification/pdf-crop-final-green/reader-results.json")
workspace = read(DEV / "evidence/verification/pdf-crop-final-green/workspace-results.json")
inner = {"left": 0.09913793103448276, "top": 0, "right": 1, "bottom": 1}
expanded = {"left": -0.19827586206896552, "top": 0, "right": 1, "bottom": 1}
checks = {}

checks["eight_source_documents_and_final_sidecars_byte_unchanged"] = (
    len(before["files"]) == 8 and before["files"] == after["files"]
)
checks["final_snapshot_matches_captured_host_data"] = (
    after["raw_snapshot_matches_current_data"]
    and after["raw_snapshot_sha256"] == digest(file_for(321, "host.json"))
    and after["settings"] == raw_after["settings"]
    and after["workspaceState"] == raw_after["workspaceState"]
    and all(raw_after[key] == value for key, value in after["model"].items())
)
model_checks = {
    key: raw_before[key] == value for key, value in after["model"].items() if key != "docMeta"
}
checks["eleven_learning_model_sections_exactly_unchanged"] = len(model_checks) == 11 and all(model_checks.values())
metadata_keys = {"revision", "writerId", "savedAt"}
all_other_keys = (set(raw_before) | set(raw_after)) - metadata_keys - {"docMeta"}
checks["all_other_root_data_fields_exactly_unchanged"] = all(
    key in raw_before and key in raw_after and raw_before[key] == raw_after[key]
    for key in all_other_keys
)
expected_meta = deepcopy(raw_before["docMeta"])
expected_meta[PDF]["pdfCrop"] = expanded
checks["docmeta_only_adds_exact_expanded_bounds_for_alpha_pdf"] = after["model"]["docMeta"] == expected_meta
checks["all_plugin_settings_exactly_unchanged"] = raw_before["settings"] == after["settings"]
checks["entire_workspace_exactly_restored_including_all_document_positions"] = raw_before["workspaceState"] == after["workspaceState"]

controls = (
    "调整左上边界", "调整上边界", "调整右上边界", "调整右边界",
    "调整右下边界", "调整下边界", "调整左下边界", "调整左边界",
)
checks["native_crop_sheet_exposes_eight_handles_and_done"] = all(
    all("button " + label in ax(i) for label in (*controls, "Done"))
    and "heading Crop" in ax(i) for i in (298, 301, 307, 320)
)
menu = ax(297)
checks["crop_menu_keeps_observed_relative_bookmark_and_page_jump_order"] = (
    menu.index("button Add Bookmark") < menu.index("button Crop") < menu.index("button Go to Page")
)
checks["inward_crop_is_saved_and_reopens_with_same_bounds"] = crop(301) == inner
checks["moving_then_escaping_does_not_commit_crop_or_other_host_data"] = capture(301) == capture(302) == capture(303)
checks["thumbnail_navigation_retains_all_four_page_targets"] = all("button 第 " + str(i) + " 页" in ax(304) for i in range(1, 5))
checks["expanded_bounds_are_saved_and_survive_a_new_plugin_instance"] = all(crop(i) == expanded for i in (310, 314, 316, 319, 320, 321))

original_sidecar = before["files"][PDF + ".mstudy.json"]
unchanged_capture_numbers = [i for i in range(296, 322) if i not in (309, 310, 312)]
sidecar_hashes = {str(i): digest(file_for(i, "sidecar.json")) for i in unchanged_capture_numbers}
checks["all_twenty_three_non_ink_snapshots_keep_original_pdf_sidecar_bytes"] = len(sidecar_hashes) == 23 and set(sidecar_hashes.values()) == {original_sidecar}
base_annotations = read(BEFORE / "vault-files" / (PDF + ".mstudy.json"))["annotations"]
ink_annotations = capture(310, "sidecar.json")["annotations"]
added = [item for item in ink_annotations if item["id"] not in {item["id"] for item in base_annotations}]
checks["one_new_stroke_is_saved_entirely_in_the_extended_left_margin"] = (
    len(added) == 1 and added[0]["type"] == "pen" and added[0]["page"] == 3
    and len(added[0]["strokes"]) == 1 and len(added[0]["strokes"][0]) >= 2
    and all(expanded["left"] <= point["x"] < 0 for point in added[0]["strokes"][0])
    and [item for item in ink_annotations if item["id"] not in {entry["id"] for entry in added}] == base_annotations
)
checks["native_undo_removes_new_record_and_restores_original_sidecar_bytes"] = digest(file_for(311, "sidecar.json")) == original_sidecar
checks["native_redo_restores_same_stroke_identity_and_all_content"] = capture(310, "sidecar.json") == capture(312, "sidecar.json")
checks["final_undo_leaves_no_new_empty_pen_record"] = all(digest(file_for(i, "sidecar.json")) == original_sidecar for i in (313, 314, 321))
checks["undo_redo_buttons_follow_actual_native_ink_history"] = (
    "Description: 撤销, Help: 撤销手写" in ax(310)
    and "Description: 重做, Help: 重做手写" in ax(311)
    and "Description: 撤销, Help: 撤销手写" in ax(312)
)

checks["real_disable_and_reenable_are_confirmed_in_persisted_host_list"] = (
    capture(316, "enabled.json") == ["realclaudian"]
    and capture(318, "enabled.json") == before["enabled_plugins"] == after["enabled_plugins"]
    and capture(321, "enabled.json") == before["enabled_plugins"]
)
checks["early_disabled_capture_is_retained_as_async_persistence_diagnostic"] = (
    "margin-study" in capture(315, "enabled.json")
    and "margin-study" not in capture(316, "enabled.json")
)
checks["reload_preserves_complete_workspace_and_preferences"] = all(
    capture(i)["workspaceState"] == raw_before["workspaceState"]
    and capture(i)["settings"] == raw_before["settings"]
    for i in (314, 315, 316, 317, 318, 319, 320, 321)
)
ws = after["workspaceState"]
checks["final_pdf_page_three_scale_four_tabs_handwriting_navigation_and_cards_restored"] = (
    ws["activePath"] == PDF and len(ws["tabs"]) == 4
    and ws["tabs"][0]["state"] == {
        "filePath": PDF, "scale": 0.432, "pdfLayout": "single", "pdfContinuous": True,
        "position": {"page": 3, "pageOffset": 0, "left": 0},
    }
    and ws["documentNavigationTab"] == "annotations" and ws["documentNavigation"] is True
    and ws["auxiliary"] == "cards" and ws["showTabs"] is True
    and after["readingPreferences"]["readingTheme"] == "white"
)
checks["final_native_study_view_has_no_crop_sheet_or_claudian_composer"] = (
    "学习工作区" in ax(321) and "Description: 手写标注, Value: 1" in ax(321)
    and all(text not in ax(321) for text in ("container Crop", "Model unavailable", "Ask to make changes"))
)
checks["four_installed_artifacts_match_development_and_deployment_receipt"] = (
    len(after["deployment"]) == 4
    and all(len(set(value.values())) == 1 and value["receipt"] == receipt["files"][name]["sha256"] for name, value in after["deployment"].items())
)
checks["both_protected_plugin_main_files_match_original_baseline"] = len(after["protected"]) == 2 and all(item["baseline"] == item["current"] for item in after["protected"])
checks["complete_twenty_suite_verification_passed"] = verification["completeRun"] and verification["passed"] and len(verification["suites"]) == 20 and all(item["exitCode"] == 0 for item in verification["suites"])
checks["reader_eighty_four_and_workspace_seventy_eight_checks_passed"] = (
    reader["done"] and len(reader["results"]) == 84 and all(item["passed"] for item in reader["results"])
    and workspace["done"] and len(workspace["results"]) == 78 and not workspace["errors"] and all(item["passed"] for item in workspace["results"])
)

report = {
    "time": datetime.now(timezone.utc).isoformat(),
    "scope": "PDF Crop and expanded paper, synthetic desktop acceptance vault only",
    "replay_uses_saved_evidence_only": True,
    "checks": checks,
    "all_scoped_checks_passed": all(checks.values()),
    "before": "evidence/checkpoints/20261017-pdf-crop-before/",
    "after": "322-plugin-pdf-crop-final-data.json",
    "eleven_model_sections_unchanged": model_checks,
    "other_exactly_unchanged_root_fields": sorted(all_other_keys),
    "ignored_metadata_only": sorted(metadata_keys),
    "docmeta_exact_allowed_final_value": expected_meta,
    "entire_phase_workspace_exactly_unchanged": raw_before["workspaceState"] == after["workspaceState"],
    "unchanged_captured_pdf_sidecar_hashes": sidecar_hashes,
    "temporary_added_ink": added,
    "deployment": after["deployment"],
    "protected": after["protected"],
    "manual_visual_observations": [
        "298/301: gray Crop sheet, original page preview, eight red handles and Crop/Done; reopened inward left edge is retained.",
        "302/303: inward movement is visible in preview; Escape returns to the previously saved crop.",
        "304/306: all four thumbnails remain; page 2 body and its thumbnail preserve the existing 90 degree text orientation.",
        "305: U2 source card locates page 1 highlighting, which aligns to the text; U2 is not on page 2.",
        "307/308: outward left drag creates a wider white margin and refreshes all four thumbnail previews.",
        "309-313: stroke is visible in expanded margin, vanishes on Undo, returns on Redo and vanishes after final Undo.",
        "315/316: switch is off; immediate enabled-list snapshot 315 is early. 316 confirms persisted disable before reenabling.",
        "318: settings close leaves a normal empty Obsidian tab after disable; 319 explicitly reopens study workspace and restores the saved state.",
        "320/321: new plugin instance retains expanded boundary; final study view has page 3 image, handwriting navigation and Cards without floating composer.",
    ],
    "limitations": [
        "MN4 4.4.6 runtime evidence 281-295 is separate from Qoder 4.4.5 L3 and official manual descriptions.",
        "No whole-plugin, all-window-size, exact-pixel or native stylus parity claim.",
        "Special collapse-to-point reset, crop-preserving export, mixed page ratios and original CropBox-hidden content are not completed.",
        "Cross-reader synchronization, all four rotations, eraser/lasso, stale gestures and voice projections were tested with isolated real PDF.js fixtures, not every native combination.",
        "PDF page editing and Extend Normal/Margin/Collapse remain unimplemented; paper expansion is not Extend.",
        "Implementation bounds -2 to 3 and minimum 1 percent are plugin choices, not confirmed MN4 constants.",
        "Source protection refers to plugin synthetic vault files. Original MN4 PDF/database bytes were not inspected.",
        "Metadata revision/writerId/savedAt changed; whole data.json byte equality is not asserted. Historical empty pen records were preserved.",
    ],
}
target = NATIVE / "323-pdf-crop-comparison.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"report": str(target.relative_to(DEV)), "checks_passed": sum(checks.values()), "checks_total": len(checks), "failed": [name for name, passed in checks.items() if not passed]}, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
