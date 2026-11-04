import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type MarginStudyPlugin from "./main";
import { BRANCH_STYLES, ACCENTS, ThemeMode } from "./types";
import { applyTheme } from "./theme";

export class MarginStudySettingTab extends PluginSettingTab {
  plugin: MarginStudyPlugin;

  constructor(app: App, plugin: MarginStudyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.store.settings;

    new Setting(containerEl)
      .setName("标注颜色")
      .setDesc("每行一个十六进制颜色，例如 #ffd54f")
      .addTextArea((tb) => {
        tb.setValue(s.colors.join("\n"));
        tb.inputEl.rows = 4;
        tb.onChange((v) => {
          const cols = v.split("\n").map((x) => x.trim()).filter(Boolean);
          if (cols.length) {
            s.colors = cols;
            if (!s.colors.includes(s.defaultColor)) s.defaultColor = s.colors[0];
            this.plugin.store.save();
          }
        });
      });

    new Setting(containerEl)
      .setName("默认标注颜色")
      .addDropdown((dd) => {
        s.colors.forEach((c) => dd.addOption(c, c));
        dd.setValue(s.defaultColor);
        dd.onChange((v) => {
          s.defaultColor = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("默认缩放")
      .setDesc("新打开 PDF 的默认缩放比例")
      .addSlider((sl) => {
        sl.setLimits(0.5, 3, 0.1)
          .setValue(s.scale)
          .onChange((v) => {
            s.scale = v;
            this.plugin.store.save();
          });
      });

    new Setting(containerEl)
      .setName("页间距 (px)")
      .addText((t) => {
        t.setValue(String(s.pageGap));
        t.onChange((v) => {
          const n = parseInt(v, 10);
          if (!isNaN(n)) {
            s.pageGap = n;
            this.plugin.store.save();
          }
        });
      });

    new Setting(containerEl)
      .setName("默认分支样式")
      .setDesc("新建/打开思维导图时采用的分支布局（阅读器内可随时切换）")
      .addDropdown((dd) => {
        for (const st of BRANCH_STYLES) dd.addOption(st.id, st.name);
        dd.setValue(s.layout);
        dd.onChange((v) => {
          s.layout = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("默认沉浸模式")
      .setDesc("打开思维导图时自动进入沉浸模式（隐藏干扰元素）")
      .addToggle((tg) => {
        tg.setValue(s.immersive);
        tg.onChange((v) => {
          s.immersive = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("界面主题")
      .setDesc("亮色 / 暗色 / 跟随系统。立即生效。")
      .addDropdown((dd) => {
        dd.addOption("light", "亮色");
        dd.addOption("dark", "暗色");
        dd.addOption("auto", "跟随系统");
        dd.setValue(s.theme);
        dd.onChange((v) => {
          s.theme = v as ThemeMode;
          this.plugin.store.save();
          applyTheme(this.plugin);
        });
      });

    new Setting(containerEl)
      .setName("主题色")
      .setDesc("插件主色（按钮、高亮、强调）。立即生效。")
      .addDropdown((dd) => {
        for (const a of ACCENTS) dd.addOption(a.id, a.name);
        dd.setValue(s.accent);
        dd.onChange((v) => {
          s.accent = v;
          this.plugin.store.save();
          applyTheme(this.plugin);
        });
      });

    new Setting(containerEl)
      .setName("高亮后自动成卡")
      .setDesc("在 PDF/Word 中做高亮或下划线时，自动生成一张摘录卡（否则需手动点「摘录卡」）。")
      .addToggle((tg) => {
        tg.setValue(s.autoCardOnHighlight);
        tg.onChange((v) => {
          s.autoCardOnHighlight = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("区域摘录自动成卡")
      .setDesc("用套索框选区域生成摘录时，自动生成一张摘录卡（关闭后仅保留区域标注，需手动「摘录卡」）。")
      .addToggle((tg) => {
        tg.setValue(s.autoCardOnRegion);
        tg.onChange((v) => {
          s.autoCardOnRegion = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("生成卡片自动进脑图")
      .setDesc("在 PDF/Word 中做高亮/下划线/区域摘录/批注并生成卡片时，自动在右侧脑图同步创建一个对应节点（仿 MarginNote「摘录即节点」的实时联动）。关闭则只在卡片列表出现，需手动「加入脑图」。")
      .addToggle((tg) => {
        tg.setValue(s.autoNodeOnCard);
        tg.onChange((v) => {
          s.autoNodeOnCard = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("标签配色")
      .setDesc("每行一个 `标签: #颜色`，例如 `刑法: #ff5b8a`。用于卡片/脑图标签着色。")
      .addTextArea((tb) => {
        const cur = Object.entries(s.tagColors)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
        tb.setValue(cur);
        tb.inputEl.rows = 4;
        tb.onChange((v) => {
          const map: Record<string, string> = {};
          for (const line of v.split("\n")) {
            const m = line.split(":");
            if (m.length >= 2) {
              const key = m[0].trim();
              const col = m[1].trim();
              if (key && /^#?[0-9a-fA-F]{3,8}$/.test(col)) map[key] = col.startsWith("#") ? col : "#" + col;
            }
          }
          s.tagColors = map;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("每日自动备份")
      .setDesc("启用后，插件加载时若当天还没有备份，自动把数据备份到 vault 的 MarginStudyBackups/ 目录。")
      .addToggle((tg) => {
        tg.setValue(s.backupEnabled);
        tg.onChange((v) => {
          s.backupEnabled = v;
          this.plugin.store.save();
        });
      });

    new Setting(containerEl)
      .setName("用 MarginStudy 替代原生阅读器")
      .setDesc(
        "开启后，PDF、Word、EPUB 和 HTML 在原标签页中使用 MarginStudy 打开，并显示学习侧栏。Markdown 仍按 Obsidian 原有方式打开，可从右键菜单进入 MarginStudy。关闭后，新打开的文件使用原有阅读器。"
      )
      .addToggle((tg) => {
        tg.setValue(s.replaceNativeReader);
        tg.onChange((v) => {
          s.replaceNativeReader = v;
          this.plugin.store.save();
          new Notice(
            v
              ? "已启用：新打开的文档将使用 MarginStudy 阅读器"
              : "已关闭：新打开的文件将使用原有阅读器；当前阅读标签页可继续使用"
          );
        });
      });
  }
}
