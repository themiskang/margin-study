/**
 * [INPUT]: 依赖 Obsidian 设置组件、插件存储与手写控制器。
 * [OUTPUT]: 提供插件设置面板。
 * [POS]: 保存设置并向手写控制器提供预测开关。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { App, PluginSettingTab, Setting, Notice, Platform } from "obsidian";
import type MarginStudyPlugin from "./main";
import { BRANCH_STYLES, ACCENTS, ThemeMode } from "./types";
import { applyTheme } from "./theme";
import { setInkPredictionReader } from "./annot/pen";
import { el } from "./utils/dom";

export class MarginStudySettingTab extends PluginSettingTab {
  plugin: MarginStudyPlugin;

  constructor(app: App, plugin: MarginStudyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    setInkPredictionReader(() => this.plugin.store.settings.inkPrediction ?? Platform.isMobile);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.store.settings;

    new Setting(containerEl)
      .setName("隐藏宿主标签栏")
      .setDesc("学习工作区激活时隐藏 Obsidian 标签栏。")
      .addToggle(toggle => toggle.setValue(s.hideHostTabBar ?? true).onChange(value => {
        s.hideHostTabBar = value;
        document.querySelectorAll<HTMLElement>(".ms-study-workspace").forEach(root => {
          root.dataset.hideHostTabBar = String(value);
        });
        this.plugin.store.save();
      }));

    new Setting(containerEl)
      .setName("手写笔迹预测")
      .setDesc("根据手写速度预测一帧笔迹，松笔后只保留真实笔迹。")
      .addToggle(toggle => toggle.setValue(s.inkPrediction ?? Platform.isMobile).onChange(value => {
        s.inkPrediction = value;
        this.plugin.store.save();
      }));

    if (Platform.isMobile) {
      new Setting(containerEl)
        .setName("移动端降低 PDF 分辨率")
        .setDesc("降低页面渲染负担；切换后重新打开 PDF 生效。")
        .addToggle(toggle => toggle.setValue(s.mobileLowRes !== false).onChange(value => {
          s.mobileLowRes = value;
          this.plugin.store.save();
        }));
    }

    if (!Platform.isMobile) {
      const state = this.plugin.localCli?.getState();
      new Setting(containerEl)
        .setName("本地 CLI 连接")
        .setDesc("仅允许本机 127.0.0.1 访问。默认关闭；插件重载后需重新启用。")
        .addToggle(toggle => toggle.setValue(state?.enabled ?? false).onChange(async enabled => {
          toggle.setDisabled(true);
          try {
            if (enabled) await this.plugin.enableLocalCli();
            else await this.plugin.localCli?.stop();
          } catch { new Notice("本地连接未能启动或停止，请检查本机端口权限。"); }
          this.display();
        }));
      new Setting(containerEl)
        .setName("本地连接状态")
        .setDesc(state?.enabled ? `已启用：127.0.0.1:${state.port}` : "已关闭，无监听端口");
      const token = new Setting(containerEl)
        .setName("本地令牌")
        .setDesc(state?.token ?? "启用后显示；请勿分享给不信任的程序。");
      if (state?.token) {
        token.descEl.style.userSelect = "text";
        token.addButton(button => button.setButtonText("复制").onClick(() => {
          void navigator.clipboard.writeText(state.token!).then(() => new Notice("本地令牌已复制。"), () => new Notice("复制失败，请手动选择令牌。"));
        }));
        token.addButton(button => button.setButtonText("重新生成").onClick(() => {
          try { this.plugin.localCli?.rotateToken(); this.display(); }
          catch { new Notice("请先启用本地连接。"); }
        }));
      }
      new Setting(containerEl)
        .setName("允许本地写入")
        .setDesc("仅对当前服务会话生效。打开后，本机持有令牌的程序可以整理卡片；每次命令可撤销。")
        .addToggle(toggle => toggle.setValue(state?.allowWrites ?? false).setDisabled(!state?.enabled).onChange(enabled => {
          try { this.plugin.localCli?.setWriteEnabled(enabled); }
          catch { new Notice("请先启用本地连接。"); }
          this.display();
        }));
    }

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

    if (typeof containerEl.createEl === "function") {
      containerEl.createEl("h3", { cls: "ms-settings-heading", text: "阅读" });
    } else if (typeof containerEl.append === "function" && typeof document !== "undefined") {
      containerEl.append(el("h3", { class: "ms-settings-heading", text: "阅读" }));
    }

    new Setting(containerEl)
      .setName("阅读区禁止左右滑动开侧栏")
      .setDesc("只在 MarginStudy 阅读器内生效，不影响上下翻页、不影响双指缩放。")
      .addToggle((tg) => {
        tg.setValue(s.blockSidebarSwipe !== false);
        tg.onChange((v) => {
          s.blockSidebarSwipe = v;
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
      .setName("拖选文本自动高亮")
      .setDesc("在「摘录 / 书写」场景拖选文字松手后自动生成高亮（默认关闭，仅选中文字并弹出操作菜单；开启「连续摘录」时不受此开关限制，始终逐笔自动摘录）。")
      .addToggle((tg) => {
        tg.setValue(s.autoHighlightOnSelect ?? false);
        tg.onChange((v) => {
          s.autoHighlightOnSelect = v;
          this.plugin.store.save();
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
      .setName("自动摘录与成卡最短字数")
      .setDesc("自动摘录与自动成卡最短字数（中文，英文自动按 2 倍折算；填 0 关闭）。")
      .addText((tb) => {
        const cur = s.autoExcerptMinChars ?? 4;
        tb.setValue(String(cur));
        tb.inputEl.placeholder = "4";
        tb.inputEl.type = "number";
        tb.inputEl.min = "0";
        tb.inputEl.max = "50";
        tb.inputEl.step = "1";
        tb.onChange((v) => {
          const parsed = Number.parseInt(v.trim(), 10);
          if (!Number.isFinite(parsed) || parsed < 0) return;
          s.autoExcerptMinChars = Math.min(50, parsed);
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

    new Setting(containerEl)
      .setName("停用持久化（仅诊断用）")
      .setDesc("诊断模式：不会写盘。退出前请先关闭此开关，等待保存完成。")
      .addToggle(toggle => toggle.setValue(s.diagnosticNoPersist).onChange(value => {
        s.diagnosticNoPersist = value;
        this.plugin.store.save();
        if (value) {
          const message = "诊断模式：不会写盘。退出前请先关闭此开关，等待保存完成。";
          new Notice(message, 12000);
          console.warn("MarginStudy:", message);
        }
      }));
  }
}
