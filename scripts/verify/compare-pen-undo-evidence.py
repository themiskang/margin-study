"""Replay the saved native pen-creation Undo/Redo/reload comparison.

Only reads saved evidence. The vault is never modified or read by this replay;
173-pen-after-reload-data.json records the selected live checks at capture time.
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


DEV = Path(__file__).resolve().parents[1]
NATIVE = DEV / "evidence/native-max-l4"
BACKUP = DEV / "evidence/checkpoints/20261017-pen-undo-before"
TEST_ID = "ann-mvbn92sz-j25ck2"
HISTORICAL_EMPTY_ID = "ann-mvb9jx0m-z47ea4"


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


before = read(NATIVE / "167-pen-before-draw-data.json")
after = read(NATIVE / "173-pen-after-reload-data.json")
disabled = read(NATIVE / "172-pen-disabled-state.json")
host = read(NATIVE / "173-marginstudy-pen-after-reload-host-state.json")
receipt = read(DEV / "evidence/checkpoints/20261017-pen-undo-deployment.json")
baseline_path = BACKUP / "synthetic-vault/l4-sample-alpha.pdf.mstudy.json"
names = {
    "before": baseline_path,
    "drawn": NATIVE / "168-marginstudy-pen-drawn.sidecar.json",
    "undone": NATIVE / "169-marginstudy-pen-undone.sidecar.json",
    "redone": NATIVE / "170-marginstudy-pen-redone.sidecar.json",
    "final_undo": NATIVE / "171-marginstudy-pen-final-undo.sidecar.json",
    "reload": NATIVE / "173-marginstudy-pen-after-reload.sidecar.json",
}
sidecars = {name: read(path) for name, path in names.items()}
hashes = {name: sha(path) for name, path in names.items()}
pdf_name = "l4-sample-alpha.pdf.mstudy.json"
checks = {}
checks["baseline_backup_matches_recorded_before_drawing_hash_and_annotations"] = (
    hashes["before"] == before["files"][pdf_name]
    and sidecars["before"]["annotations"] == before["pdf_annotations"]
)
checks["undo_final_undo_and_reload_restore_pdf_sidecar_bytes_exactly"] = all(
    hashes[name] == hashes["before"] for name in ("undone", "final_undo", "reload")
)
checks["redo_restores_the_entire_drawn_pdf_sidecar_bytes_exactly"] = (
    hashes["drawn"] == hashes["redone"]
)
old_annotations = sidecars["before"]["annotations"]
old_ids = {ann["id"] for ann in old_annotations}
added = [ann for ann in sidecars["drawn"]["annotations"] if ann["id"] not in old_ids]
checks["drawing_adds_exactly_one_pen_with_expected_identity_page_and_stroke"] = (
    len(added) == 1
    and added[0]["id"] == TEST_ID
    and added[0]["type"] == "pen"
    and added[0]["docPath"] == "l4-sample-alpha.pdf"
    and added[0]["page"] == 1
    and len(added[0].get("strokes", [])) == 1
    and len(added[0]["strokes"][0]) >= 2
)
checks["test_pen_id_is_unique_in_drawn_and_redone_state"] = all(
    sum(ann["id"] == TEST_ID for ann in sidecars[name]["annotations"]) == 1
    for name in ("drawn", "redone")
)
checks["test_pen_record_absent_after_undo_final_undo_and_reload"] = all(
    all(ann["id"] != TEST_ID for ann in sidecars[name]["annotations"])
    for name in ("before", "undone", "final_undo", "reload")
)
checks["all_four_preexisting_annotations_preserved_in_every_state"] = (
    len(old_annotations) == 4
    and all(
        [ann for ann in value["annotations"] if ann["id"] in old_ids] == old_annotations
        and {key: val for key, val in value.items() if key != "annotations"}
        == {key: val for key, val in sidecars["before"].items() if key != "annotations"}
        for value in sidecars.values()
    )
)
checks["historical_empty_pen_preserved_without_migration_or_manual_cleanup"] = (
    any(ann["id"] == HISTORICAL_EMPTY_ID and ann.get("strokes") == [] for ann in old_annotations)
    and all(
        any(ann["id"] == HISTORICAL_EMPTY_ID and ann.get("strokes") == [] for ann in value["annotations"])
        for value in sidecars.values()
    )
)
file_comparison = {
    name: {"before_drawing": old, "after_reload": after["files"][name]}
    for name, old in before["files"].items()
}
checks["all_eight_original_documents_and_sidecars_return_to_baseline"] = (
    len(file_comparison) == 8
    and all(values["before_drawing"] == values["after_reload"] for values in file_comparison.values())
)
checks["captured_reload_sidecar_matches_post_reload_live_hash"] = (
    hashes["reload"] == after["files"][pdf_name] == disabled["pdf_sidecar_sha256"]
)
model_comparison = {key: after["model"].get(key) == value for key, value in before["model"].items()}
checks["all_twelve_selected_core_model_sections_including_docmeta_unchanged"] = (
    len(model_comparison) == 12 and all(model_comparison.values())
)
checks["plugin_disabled_before_reload_and_enabled_after_reload"] = (
    "margin-study" not in disabled["enabled_plugins"]
    and "margin-study" in after["enabled_plugins"]
)
checks["reload_restores_the_entire_saved_workspace_state"] = (
    host == after["workspaceState"] == disabled["workspaceState"]
)
checks["all_four_artifacts_match_development_installation_and_receipt"] = (
    len(after["deployment"]) == 4
    and all(
        len(set(values.values())) == 1
        and values["receipt"] == receipt["files"][name]["sha256"]
        for name, values in after["deployment"].items()
    )
)
checks["both_protected_plugins_still_match_predevelopment_baseline"] = (
    len(after["protected"]) == 2
    and all(entry["baseline"] == entry["current"] for entry in after["protected"])
)

report = {
    "time": datetime.now(timezone.utc).isoformat(),
    "scope": "Saved evidence from native pen creation, Undo, Redo, final Undo and plugin reload in the synthetic acceptance vault",
    "replay_uses_saved_evidence_only": True,
    "live_after_reload_capture_time": after["time"],
    "checks": checks,
    "all_scoped_integrity_checks_passed": all(checks.values()),
    "sidecar_sha256": hashes,
    "test_pen_id": TEST_ID,
    "test_pen_annotation": added,
    "original_documents_and_sidecars": file_comparison,
    "core_model_sections_unchanged": model_comparison,
    "expected_final_workspace": host,
    "deployment": after["deployment"],
    "protected": after["protected"],
    "limitations": [
        "Native mouse input verifies visible drawing, Undo/Redo and reload, not physical stylus pressure. Pressure is covered by synthetic public pointer events only.",
        "The historical empty pen and explicit empty bookmark list are retained. This change is not a library-wide migration.",
        "Whole data.json byte equality is not asserted: workspace reading/navigation state intentionally changed before this drawing run.",
        "Protection of referenced or externally annotated new pens, conflicting IDs, and external stroke changes is isolated automated coverage, not a claim that those exact concurrent schedules were controlled in native Obsidian.",
        "No full functional or visual equivalence with MarginNote 4 is claimed. Document menu production code was not changed in this phase.",
    ],
}
target = NATIVE / "174-pen-undo-reload-comparison.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"report": str(target.relative_to(DEV)), "checks": checks}, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
