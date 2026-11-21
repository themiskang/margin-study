"""Replay saved Read Settings evidence. Does not open or read a live vault.

Native screenshots were inspected at capture time. AX contains offscreen page
text, so this script deliberately makes no visible-paragraph or pixel claim.
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

DEV = Path(__file__).resolve().parents[1]
NATIVE = DEV / "evidence/native-max-l4"


def read(path):
    return json.loads(path.read_text())


def capture(number, suffix="data.json"):
    paths = list(NATIVE.glob(f"{number}-*.{suffix}"))
    if len(paths) != 1:
        raise ValueError(f"Expected one capture {number}/{suffix}, got {paths}")
    return read(paths[0])


def ax(number):
    return next(NATIVE.glob(f"{number}-*.ax.txt")).read_text()


def position(data, path):
    return next(tab["state"]["position"] for tab in data["workspaceState"]["tabs"] if tab["path"] == path)


before = read(NATIVE / "221-read-settings-before-data.json")
after = read(NATIVE / "279-read-settings-final-data.json")
before_raw = read(DEV / "evidence/checkpoints/20261017-read-settings-before/installed-data.json")
receipt = read(DEV / "evidence/checkpoints/20261017-read-settings-final-deployment.json")
verification = read(DEV / "evidence/verification/read-settings-final-green/results.json")
word, html, pdf = "合成Word位置验收.docx", "第二份资料.html", "l4-sample-alpha.pdf"
checks = {}

checks["eight_source_documents_and_sidecars_are_byte_unchanged"] = len(before["files"]) == 8 and before["files"] == after["files"]
captured_sidecars = {
    path.name: hashlib.sha256(path.read_bytes()).hexdigest()
    for path in sorted(NATIVE.glob("*.sidecar.json"))
    if 233 <= int(path.name.split("-", 1)[0]) <= 278
}
checks["forty_three_pdf_sidecar_captures_match_original_bytes"] = len(captured_sidecars) == 43 and set(captured_sidecars.values()) == {before["files"][pdf + ".mstudy.json"]}
model_comparison = {key: after["model"][key] == value for key, value in before["model"].items() if key != "docMeta"}
checks["eleven_learning_model_sections_are_exactly_unchanged"] = len(model_comparison) == 11 and all(model_comparison.values())
expected_meta = {**before["model"]["docMeta"], pdf: {"bookmarks": [], "foldedPages": [], "pdfLayout": "single", "pdfContinuous": True}}
checks["docmeta_has_only_the_exact_document_reading_defaults_whitelisted"] = after["model"]["docMeta"] == expected_meta and before["model"]["docMeta"][pdf] == {"bookmarks": []}
checks["all_settings_except_new_reading_theme_are_exactly_unchanged"] = (
    {key: value for key, value in after["settings"].items() if key != "readingTheme"}
    == {key: value for key, value in before_raw["settings"].items() if key != "readingTheme"}
    and after["settings"]["readingTheme"] == "white"
)

first_reload = [capture(i, "host.json") for i in (242, 243, 244)]
checks["sepia_horizontal_reload_preserves_entire_workspace_and_reading_preferences"] = (
    first_reload[0]["workspaceState"] == first_reload[1]["workspaceState"] == first_reload[2]["workspaceState"]
    and first_reload[0]["readingPreferences"] == first_reload[1]["readingPreferences"] == first_reload[2]["readingPreferences"]
)
checks["sepia_horizontal_reload_was_real_disable_enable"] = "margin-study" not in first_reload[1]["enabled_plugins"] and "margin-study" in first_reload[2]["enabled_plugins"]
first_pdf = first_reload[2]["workspaceState"]["tabs"][0]["state"]
checks["sepia_horizontal_reload_keeps_page_three_scale_and_single_page_mode"] = (
    first_pdf["position"] == {"page": 3, "pageOffset": 0, "left": 0}
    and first_pdf["scale"] == 0.432 and first_pdf["pdfLayout"] == "single" and first_pdf["pdfContinuous"] is False
    and first_reload[2]["readingPreferences"]["readingTheme"] == "sepia"
)
checks["horizontal_and_sepia_choices_are_selected_after_reopen"] = all(text in ax(245) for text in ("Description: Horizontal Flip, Value: 1", "Description: Sepia, Value: 1"))
checks["switching_horizontal_or_vertical_keeps_settings_panel_open"] = (
    "container Read Settings" in ax(240) and "Description: Horizontal Flip, Value: 1" in ax(240)
    and "container Read Settings" in ax(253) and "Description: Vertical Scroll, Value: 1" in ax(253)
)
checks["arrow_observation_keeps_saved_horizontal_mode_and_scale"] = all(
    capture(i)["workspaceState"]["tabs"][0]["state"]["pdfContinuous"] is False
    and capture(i)["workspaceState"]["tabs"][0]["state"]["scale"] == 0.432 for i in (240, 241)
)
checks["more_settings_opens_only_implemented_ui_theme_with_sepia_selected"] = "container Settings" in ax(246) and "UI Theme" in ax(246) and "Description: Sepia, Value: 1" in ax(246)
checks["ui_theme_choice_updates_in_place"] = "container Settings" in ax(247) and "Description: Gray, Value: 1" in ax(247) and capture(247)["settings"]["readingTheme"] == "gray"
checks["flowing_documents_disable_both_fixed_page_controls"] = all(
    "(disabled) Description: Horizontal Flip" in ax(i) and "(disabled) Description: Vertical Scroll" in ax(i)
    for i in (249, 251)
)
checks["word_and_html_theme_changes_preserve_saved_position_snapshots"] = position(capture(249), word) == position(capture(250), word) and position(capture(251), html) == position(capture(252), html)

diagnostic = capture(255, "host.json")
legacy_drift = {
    path: {"phase_before": position(before, path), "legacy_after_activation": position(capture(254), path)}
    for path in (word, html)
}
checks["legacy_first_activation_drift_is_retained_explicitly"] = all(value["phase_before"] != value["legacy_after_activation"] for value in legacy_drift.values()) and capture(254)["workspaceState"] == diagnostic["workspaceState"]
new_reload = [capture(i, "host.json") for i in (255, 256, 257)]
checks["final_install_reload_preserves_complete_diagnostic_baseline"] = new_reload[0]["workspaceState"] == new_reload[1]["workspaceState"] == new_reload[2]["workspaceState"] and new_reload[0]["readingPreferences"] == new_reload[1]["readingPreferences"] == new_reload[2]["readingPreferences"]
checks["final_build_install_has_real_disable_enable_evidence"] = "margin-study" not in new_reload[1]["enabled_plugins"] and "margin-study" in new_reload[2]["enabled_plugins"]
checks["word_switch_return_and_reload_keep_exact_saved_position"] = all(position(capture(i), word) == position(diagnostic, word) for i in (258, 259, 260, 265, 277, 278))
checks["html_switch_return_and_reload_keep_exact_saved_section_and_offset"] = all(position(capture(i), html) == position(diagnostic, html) for i in (260, 261, 264, 265, 275, 276, 277, 278))
flow_reload = [capture(i, "host.json") for i in (262, 273, 275)]
checks["active_html_real_reload_keeps_entire_workspace_and_preferences"] = flow_reload[0]["workspaceState"] == flow_reload[1]["workspaceState"] == flow_reload[2]["workspaceState"] and flow_reload[0]["readingPreferences"] == flow_reload[1]["readingPreferences"] == flow_reload[2]["readingPreferences"]
checks["active_html_reload_has_real_disable_enable_evidence"] = "margin-study" not in flow_reload[1]["enabled_plugins"] and "margin-study" in flow_reload[2]["enabled_plugins"]
checks["host_enable_list_failure_is_preserved_and_final_enable_persisted"] = "margin-study" not in capture(271, "host.json")["enabled_plugins"] and all("margin-study" in capture(i, "host.json")["enabled_plugins"] for i in (274, 275, 276, 277, 278)) and "margin-study" in after["enabled_plugins"]
checks["final_workspace_is_exactly_diagnostic_baseline_without_ignoring_positions"] = after["workspaceState"] == diagnostic["workspaceState"]
checks["final_mode_theme_tabs_navigation_and_cards_restored"] = (
    after["readingPreferences"] == {"readingTheme": "white", "theme": "light", "scale": 0.432, "pageGap": 24, "accent": "indigo"}
    and after["workspaceState"]["activePath"] == pdf and len(after["workspaceState"]["tabs"]) == 4
    and after["workspaceState"]["documentNavigation"] is True and after["workspaceState"]["documentNavigationTab"] == "annotations"
    and after["workspaceState"]["showTabs"] is True and after["workspaceState"]["auxiliary"] == "cards"
    and after["workspaceState"]["tabs"][0]["state"] == {"filePath": pdf, "scale": 0.432, "pdfLayout": "single", "pdfContinuous": True, "position": {"page": 3, "pageOffset": 0, "left": 0}}
)
checks["final_menu_and_selected_controls_exist_in_actual_host"] = all("button " + label in ax(266) for label in ("Add Bookmark", "Go to Page", "Document Notebooks", "Card Grouping Board", "Read Settings")) and "Description: White, Value: 1" in ax(267) and "Description: Vertical Scroll, Value: 1" in ax(267)
checks["final_workspace_has_no_settings_overlay_or_claudian_float"] = all(text not in ax(278) for text in ("container Read Settings", "container Settings", "container Claudian chat"))
checks["four_final_installed_artifacts_match_saved_deployment_receipt"] = len(after["deployment"]) == 4 and all(len(set(value.values())) == 1 and value["receipt"] == receipt["files"][name]["sha256"] for name, value in after["deployment"].items())
checks["both_protected_plugin_main_files_remain_at_original_baseline"] = len(after["protected"]) == 2 and all(value["baseline"] == value["current"] for value in after["protected"])
checks["complete_twenty_suite_verification_passed_after_navigation_fix"] = verification["completeRun"] and verification["passed"] and len(verification["suites"]) == 20 and all(suite["exitCode"] == 0 for suite in verification["suites"])

report = {
    "time": datetime.now(timezone.utc).isoformat(),
    "scope": "Read Settings, theme display, page mode and fixed-width navigation restoration; synthetic acceptance vault",
    "replay_uses_saved_evidence_only": True,
    "checks": checks,
    "all_scoped_checks_passed": all(checks.values()),
    "phase_before": "221-read-settings-before-data.json",
    "after_capture": "279-read-settings-final-data.json",
    "diagnostic_baseline": "255-read-settings-navigation-fix-before.host.json",
    "legacy_first_activation_position_failure": legacy_drift,
    "entire_phase_workspace_exactly_unchanged": before["workspaceState"] == after["workspaceState"],
    "final_workspace_exactly_matches_postdiagnosis_baseline": diagnostic["workspaceState"] == after["workspaceState"],
    "eleven_model_sections_unchanged": model_comparison,
    "docmeta_exact_allowed_final_value": expected_meta,
    "captured_pdf_sidecar_hashes": captured_sidecars,
    "deployment": after["deployment"],
    "protected": after["protected"],
    "manual_visual_observations": [
        "239: page 4 was unfolded; visible Chapter 2 page 3 aligns correctly. Earlier fold origin remains unknown.",
        "241: Right key actually displays page 4; the failed PageDown tool key name was not a successful flip.",
        "241 data.json is a last-saved snapshot still at page 3; it is not used to assert the visible page or current arrow-navigation position.",
        "258/259/265/277: Word paragraph 17 retains its visible location at the same final navigation column width.",
        "260/261/264/276: HTML energy-conversion heading and preceding cell paragraph retain their visible location.",
        "267/278: final controls and restored workspace inspected; this replay does not infer on-screen visibility from all-page AX text.",
    ],
    "limitations": [
        "Original 4.4.6 horizontal mode selection was observed; gesture/key page movement in 211-215 was not established.",
        "Only UI Theme under More Settings is implemented; full original Settings and image color correction remain incomplete.",
        "No whole-plugin, all-media-color, gesture/animation or pixel-equivalence claim.",
        "228/229 retain native contrast failures; 233-238 retain folded-page diagnostics, not normal restoration evidence.",
        "264-271 retain a running-plugin/on-switch versus persisted-disabled-list mismatch. 273-278 repeat disable/enable while keeping settings open until the enabled list is confirmed; the host-internal cause was not established.",
        "The whole phase did change legacy Word/HTML positions before the navigation timing fix. They were not silently reset or excluded.",
        "Whole data.json byte equality is not asserted. Historical empty records remain; no migration or manual cleanup was performed.",
    ],
}
target = NATIVE / "280-read-settings-comparison.json"
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"report": str(target.relative_to(DEV)), "checks_passed": sum(checks.values()), "checks_total": len(checks), "failed": [name for name, passed in checks.items() if not passed]}, ensure_ascii=False, indent=2))
if not all(checks.values()):
    raise SystemExit(1)
