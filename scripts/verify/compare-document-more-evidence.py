"""Replay the saved native Document - More checks without reading a live vault.

Screenshot alignment and visible page content were inspected during capture;
these data/AX checks supplement that observation, not pixel-equivalence testing.
"""

import hashlib
import json
from datetime import datetime, timezone
from replay_support import EVIDENCE, replay_report, report_reference


NATIVE = EVIDENCE / "native-max-l4"


def read(name):
    return json.loads((NATIVE / name).read_text())


def ax(name):
    return (NATIVE / (name + ".ax.txt")).read_text()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


before = read("184-document-more-before-data.json")
after = read("201-document-more-after-data.json")
bookmarked = read("188-marginstudy-document-more-bookmark-data.json")
hidden = read("195-marginstudy-tabs-hidden-host-state.json")
disabled = read("196-document-tabs-hidden-disabled-state.json")
reloaded = read("197-document-tabs-hidden-reloaded-state.json")
receipt = json.loads((EVIDENCE / "checkpoints/20261017-document-more-final-deployment.json").read_text())

checks = {}
file_comparison = {
    name: {"before": old, "after": after["files"].get(name)}
    for name, old in before["files"].items()
}
checks["all_eight_original_documents_and_sidecars_unchanged"] = (
    len(file_comparison) == 8
    and all(value["before"] == value["after"] for value in file_comparison.values())
)
captured_sidecars = {
    path.name: sha(path)
    for path in sorted(NATIVE.glob("*.sidecar.json"))
    if 187 <= int(path.name.split("-", 1)[0]) <= 200
}
checks["all_fourteen_captured_pdf_sidecars_match_baseline_bytes"] = (
    len(captured_sidecars) == 14
    and all(value == before["files"]["l4-sample-alpha.pdf.mstudy.json"] for value in captured_sidecars.values())
)
model_comparison = {key: after["model"].get(key) == value for key, value in before["model"].items()}
checks["all_twelve_selected_model_sections_including_docmeta_unchanged"] = (
    len(model_comparison) == 12 and all(model_comparison.values())
)
checks["bookmark_adds_page_one_then_removal_restores_original_metadata"] = (
    before["model"]["docMeta"]["l4-sample-alpha.pdf"]["bookmarks"] == []
    and bookmarked["docMeta"]["l4-sample-alpha.pdf"]["bookmarks"] == [1]
    and after["model"]["docMeta"] == before["model"]["docMeta"]
)
checks["bookmark_action_label_changes_from_add_to_remove_and_back"] = (
    "button Add Bookmark" in ax("187-marginstudy-document-more-aligned")
    and "button Remove Bookmark" in ax("188-marginstudy-document-more-bookmarked")
    and "button Add Bookmark" in ax("198-marginstudy-document-tabs-restored")
)
checks["hidden_workspace_state_is_identical_before_disable_and_after_reload"] = (
    hidden["workspaceState"] == disabled["workspaceState"] == reloaded["workspaceState"]
)
workspace = reloaded["workspaceState"]
checks["reload_preserves_four_tabs_pdf_page_three_scale_and_navigation"] = (
    [tab["path"] for tab in workspace["tabs"]]
    == ["l4-sample-alpha.pdf", "合成Word位置验收.docx", "第二份资料.html", "验收说明.md"]
    and workspace["activePath"] == "l4-sample-alpha.pdf"
    and workspace["tabs"][0]["state"]["position"] == {"page": 3, "pageOffset": 0, "left": 0}
    and workspace["tabs"][0]["state"]["scale"] == 0.432
    and workspace["showTabs"] is False
    and workspace["documentNavigation"] is True
    and workspace["documentNavigationTab"] == "annotations"
    and workspace["auxiliary"] == "cards"
)
checks["final_workspace_only_restores_the_show_tabs_preference"] = (
    after["workspaceState"] == {**workspace, "showTabs": True}
)
checks["plugin_was_disabled_then_enabled_for_real_reload"] = (
    "margin-study" not in disabled["enabled_plugins"]
    and "margin-study" in reloaded["enabled_plugins"]
    and "margin-study" in after["enabled_plugins"]
)
checks["page_jump_starts_empty_then_has_confirmed_value_three"] = (
    "text field (settable) 跳转到页码\n" in ax("189-marginstudy-go-to-page-dialog")
    and "Description: 跳转到页码, Value: 3" in ax("190-marginstudy-go-to-page-value")
)
checks["document_notebooks_entry_opens_existing_notebook_manager"] = (
    "heading 文档笔记本" in ax("192-marginstudy-document-notebooks-opened")
    and "button + 新建文档笔记本" in ax("192-marginstudy-document-notebooks-opened")
    and "Description: 切换笔记本 主笔记本, Value: 1" in ax("192-marginstudy-document-notebooks-opened")
)
checks["card_grouping_board_entry_switches_review_to_cards"] = (
    "Description: 复习卡组, Value: 1" in ax("193-marginstudy-document-more-before-board")
    and "Description: 卡片列表, Value: 1" in ax("194-marginstudy-document-more-board-opened")
    and "Description: 复习卡组, Value: 0" in ax("194-marginstudy-document-more-board-opened")
    and "container 卡片分组看板" in ax("194-marginstudy-document-more-board-opened")
)
checks["tab_checkbox_changes_without_closing_document_more_menu"] = (
    "container Document - More" in ax("195-marginstudy-document-tabs-hidden")
    and "Description: Show Document Tabs, Value: 0" in ax("195-marginstudy-document-tabs-hidden")
    and "tab group 已打开的文档" not in ax("195-marginstudy-document-tabs-hidden")
    and "container Document - More" in ax("198-marginstudy-document-tabs-restored")
    and "Description: Show Document Tabs, Value: 1" in ax("198-marginstudy-document-tabs-restored")
    and "tab group 已打开的文档" in ax("198-marginstudy-document-tabs-restored")
)
checks["legacy_reader_tools_open_at_saved_page_three"] = (
    "container Document\n" in ax("199-marginstudy-reader-tools-new-route")
    and "Description: 跳转到页码, Value: 3" in ax("199-marginstudy-reader-tools-new-route")
    and "button 适应宽度" in ax("199-marginstudy-reader-tools-new-route")
)
checks["final_workspace_restores_tabs_without_floating_claudian_composer"] = (
    "tab group 已打开的文档" in ax("200-marginstudy-document-more-final-workspace")
    and "container Claudian chat" not in ax("200-marginstudy-document-more-final-workspace")
    and "container Document - More" not in ax("200-marginstudy-document-more-final-workspace")
)
checks["all_four_artifacts_match_development_installation_and_final_receipt"] = (
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
    "scope": "Five core Document - More entries and reload in the synthetic acceptance vault",
    "replay_uses_saved_evidence_only": True,
    "live_after_capture_time": after["time"],
    "checks": checks,
    "all_scoped_checks_passed": all(checks.values()),
    "original_documents_and_sidecars": file_comparison,
    "captured_pdf_sidecars": captured_sidecars,
    "core_model_sections_unchanged": model_comparison,
    "hidden_workspace_restored": workspace,
    "final_workspace": after["workspaceState"],
    "deployment": after["deployment"],
    "protected": after["protected"],
    "limitations": [
        "Only five supported core rows are implemented. This is not the complete original Document - More menu or whole-plugin parity.",
        "Native screenshot 186 records a real centered-row failure; 187 was visually inspected after the left-alignment fix. This script does not assert pixel equivalence.",
        "Native page visibility is established by inspected screenshot 191, not by the AX text for all PDF pages. Input value and persisted page are supplementary evidence.",
        "Invalid input, cancellation, source switching and closing the last tab are automated public UI coverage; those exact variants were not all repeated natively.",
        "The original and plugin checkbox hit areas and some icons differ. The original notebook and board destination dialogs were not compared in full this phase.",
        "Whole data.json byte equality is not asserted; reading and tab preferences changed intentionally. Historical empty pen and bookmarks list are retained.",
    ],
}
target = replay_report("202-document-more-reload-comparison.json")
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"report": report_reference(target), "checks": checks}, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
