# PDF 裁边阶段回退说明

此检查点仅安装在 `MarginStudy验收库/.obsidian/plugins/margin-study`。原 WorkBuddy 开发源码及 yan 正式插件未覆盖，不需要对它们执行回退。

阶段前副本在 `evidence/checkpoints/20261017-pdf-crop-before/`：

- `installed-plugin/`：安装前的 main.js、styles.css、manifest.json、pdf.worker.js。
- `installed-data.json`：安装前验收库插件主数据。
- `vault-files/`：八份合成源文档/sidecar；最终它们与此前副本字节相等，普通产物回退无需复制这些文件。
- `index.json`：保存时的开发源码、旧产物及文档哈希；`host-before.json`：源/sidecar、保护插件、启用列表的基线。

需要回退时，先另存当时的主数据，确保不会丢弃本阶段之后新增的学习内容；在 Obsidian 设置里停用验收库的 MarginStudy，确认停用已落盘，然后用 `installed-plugin/` 的四个文件替换上述唯一安装目录的同名文件。不要复制任何 Claudian 配置。

重新启用并打开学习工作区，检查四标签、文档位置、Cards 及来源定位。旧构建不识别 `pdfCrop`，原页会恢复完整显示，源 PDF/旧批注仍在。如确实要恢复整份合成验收主数据，也须先保留最新副本，再在插件停用期间恢复 `installed-data.json`；此举会回退之后的主数据变化，不能用于正式资料库。

最新开发源码、产物、验证和原生证据归档为 `evidence/checkpoints/20261017-pdf-crop-verified.tar.gz`，对应 SHA256 与逐文件清单在同名 `.receipt.json`；归档内含本说明、检查点和阶段前副本。解压到新的文件夹核对，不覆盖正在使用的源码或库。旧 `20261017-read-settings-verified.tar.gz` 独立保留。
