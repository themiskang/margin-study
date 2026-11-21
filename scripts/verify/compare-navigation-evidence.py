"""Compare saved navigation evidence with the synthetic acceptance vault.

Read-only for the vault. Writes a report containing only the selected model and
file checks, never the host's other plugin configuration.
"""

import copy
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


DEV = Path(__file__).resolve().parents[1]
VAULT = DEV.parent / "MarginStudy验收库"
NATIVE = DEV / "evidence/native-max-l4"
CHECKPOINTS = DEV / "evidence/checkpoints"


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def host_states(value):
    found = []
    if isinstance(value, dict):
        if value.get("type") == "margin-study-workspace":
            found.append(value["state"])
        for child in value.values():
            found.extend(host_states(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(host_states(child))
    return found


before = read(NATIVE / "159-navigation-before-close-host-state.json")
closed = read(NATIVE / "160-navigation-closed-host-state.json")
reopened = read(NATIVE / "161-navigation-reopened-host-state.json")
disabled = read(NATIVE / "162-navigation-disabled-state.json")
reloaded = read(NATIVE / "163-navigation-reloaded-host-state.json")
baseline = read(CHECKPOINTS / "20261017-navigation-native-before-final.json")
initial_model = read(CHECKPOINTS / "20261017-navigation-data-before.json")
data = read(VAULT / ".obsidian/plugins/margin-study/data.json")
receipt = read(CHECKPOINTS / "20261017-document-navigation-final-deployment.json")
current_states = host_states(read(VAULT / ".obsidian/workspace.json"))

expected_closed = copy.deepcopy(before)
expected_closed["documentNavigation"] = False
checks = {}
checks["closing_changes_only_navigation_visibility"] = (
    before.get("documentNavigation") is True and closed == expected_closed
)
checks["reopening_restores_entire_saved_workspace_state"] = reopened == before
checks["disabled_plugin_saved_entire_workspace_state"] = (
    "margin-study" not in disabled["enabled_plugins"]
    and disabled["workspaceState"] == reopened
)
checks["reload_restores_entire_workspace_state"] = reloaded == disabled["workspaceState"]
checks["current_host_matches_reloaded_state"] = current_states == [reloaded]
checks["plugin_enabled_after_reload"] = "margin-study" in read(
    VAULT / ".obsidian/community-plugins.json"
)

reload_files = {
    name: {"before_reload": old, "current": sha(VAULT / name)}
    for name, old in disabled["files"].items()
}
checks["all_eight_sources_and_sidecars_unchanged_by_reload"] = all(
    values["before_reload"] == values["current"] for values in reload_files.values()
)
source_names = [
    "l4-sample-alpha.pdf", "合成Word位置验收.docx", "第二份资料.html", "验收说明.md"
]
source_files = {
    name: {"baseline": baseline["files"][name], "current": sha(VAULT / name)}
    for name in source_names
}
checks["all_four_original_documents_unchanged_during_final_native_run"] = all(
    values["baseline"] == values["current"] for values in source_files.values()
)
other_sidecars = {
    name + ".mstudy.json": {
        "baseline": baseline["files"][name + ".mstudy.json"],
        "current": sha(VAULT / (name + ".mstudy.json")),
    }
    for name in source_names[1:]
}
checks["all_three_non_pdf_sidecars_unchanged_during_final_native_run"] = all(
    values["baseline"] == values["current"] for values in other_sidecars.values()
)

pdf_name = "l4-sample-alpha.pdf.mstudy.json"
backup = VAULT / (
    "MarginStudyBackups/2026-10-16T17-23-46-287Z-backup-mvb8ler3-kcslu8/files/" + pdf_name
)
checks["pdf_backup_matches_recorded_before_final_hash"] = (
    sha(backup) == baseline["files"][pdf_name]
)
old_pdf = read(backup)
new_pdf = read(VAULT / pdf_name)
old_annotations = old_pdf["annotations"]
new_annotations = new_pdf["annotations"]
old_ids = {ann["id"] for ann in old_annotations}
added = [ann for ann in new_annotations if ann["id"] not in old_ids]
checks["all_three_preexisting_pdf_annotations_preserved_exactly"] = (
    len(old_annotations) == 3
    and [ann for ann in new_annotations if ann["id"] in old_ids] == old_annotations
    and {k: v for k, v in old_pdf.items() if k != "annotations"}
    == {k: v for k, v in new_pdf.items() if k != "annotations"}
)
expected_empty_pen = {
    "id": "ann-mvb9jx0m-z47ea4", "docPath": "l4-sample-alpha.pdf",
    "docKind": "pdf", "page": 1, "type": "pen", "rects": [], "text": "",
    "color": "#ffd54f", "strokes": [], "inkBrush": "pen", "inkLayerId": "default",
    "documentNotebookId": "default", "createdAt": "2026-10-17",
}
checks["only_pdf_addition_is_the_documented_empty_test_pen_record"] = added == [expected_empty_pen]

unchanged_keys = [key for key in initial_model if key not in ("docMeta", "workspaceState")]
model_checks = {
    key: {
        "equals_initial_phase_baseline": data.get(key) == initial_model[key],
        "equals_before_final_native_baseline": data.get(key) == baseline["model"][key],
    }
    for key in unchanged_keys
}
checks["all_eleven_core_model_sections_unchanged_against_both_baselines"] = (
    len(model_checks) == 11
    and all(all(values.values()) for values in model_checks.values())
)
expected_meta = copy.deepcopy(baseline["model"]["docMeta"])
expected_meta["l4-sample-alpha.pdf"] = {"bookmarks": []}
checks["document_metadata_only_adds_empty_bookmark_list_after_add_remove"] = (
    data.get("docMeta") == expected_meta
)

deployment = {}
for name, record in receipt["files"].items():
    deployment[name] = {
        "receipt": record["sha256"],
        "development": sha(DEV / name),
        "installed": sha(VAULT / ".obsidian/plugins/margin-study" / name),
    }
checks["all_four_installed_artifacts_match_development_and_final_receipt"] = all(
    len(set(values.values())) == 1 for values in deployment.values()
)
protected = [
    {"path": entry["path"], "baseline": entry["sha256"], "current": sha(Path(entry["path"]))}
    for entry in receipt["protected"]
]
checks["both_protected_plugins_remain_at_predevelopment_baseline"] = all(
    entry["baseline"] == entry["current"] for entry in protected
)

report = {
    "time": datetime.now(timezone.utc).isoformat(),
    "scope": "Synthetic acceptance vault; final native navigation run and plugin reload",
    "checks": checks,
    "all_scoped_integrity_checks_passed": all(checks.values()),
    "whole_stage_data_and_sidecars_byte_identical": False,
    "expected_final_workspace": reloaded,
    "reload_files": reload_files,
    "original_source_files": source_files,
    "non_pdf_sidecars": other_sidecars,
    "core_model_comparison": model_checks,
    "deployment": deployment,
    "protected": protected,
    "known_differences": {
        "pdf_sidecar": {
            "before_final": baseline["files"][pdf_name],
            "after_final": sha(VAULT / pdf_name),
            "baseline_copy": str(backup.relative_to(VAULT)),
            "added_annotations": added,
            "meaning": "Native test pen stroke was undone; one empty pen container remains. No visible test stroke, and all three prior annotations are unchanged. This is a known cleanup gap, not a byte-identical undo result.",
        },
        "docMeta": {
            "before_final": baseline["model"]["docMeta"],
            "after_final": data["docMeta"],
            "meaning": "Adding then removing the synthetic PDF bookmark leaves an explicit empty bookmarks list.",
        },
        "workspaceState": "Navigation selection, document positions and final PDF scale intentionally changed during native testing; saved state was compared separately across closing/reopening navigation and plugin reload.",
    },
    "limitations": [
        "No assertion of full MarginNote visual or functional equivalence.",
        "The in-memory width-fit intent flag is not persisted; spread mode clamped to the minimum scale was checked by isolated regression only, not across native plugin reload.",
        "The historical 20261016-document-navigation-before/baseline-hashes.json is empty and is not used as a source/sidecar baseline.",
    ],
}
target = NATIVE / "164-navigation-reload-comparison.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"report": str(target.relative_to(DEV)), "checks": checks}, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
