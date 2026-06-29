import { Notice, Plugin, TFile, TFolder, normalizePath, Modal, type App, type WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type MindmapPluginSettings } from "./src/settings";
import { MindmapSettingTab } from "./src/settings-tab";
import { normalizeMindmapDocument, walkNodes } from "./src/store";
import { createDefaultMindmap, type MindmapDocument, type MindmapNode } from "./src/types";
import { MINDMAP_VIEW_TYPE, MindmapView } from "./src/view";

const PRIMARY_MINDMAP_EXTENSION = "mindmap";
const LEGACY_MINDMAP_EXTENSION = "mindmap.json";
const DEBUG_TAB_DEDUPE = true;

type MindmapSearchMatchType = "title" | "note";

type MindmapSearchResult = {
  file: TFile;
  nodeId: string;
  nodeTitle: string;
  matchType: MindmapSearchMatchType;
  excerpt: string;
  path: string[];
};

class MindmapGlobalSearchModal extends Modal {
  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private results: MindmapSearchResult[] = [];
  private searchTimer: number | null = null;
  private searchToken = 0;
  private readonly searchDebounceMs = 350;

  constructor(
    app: App,
    private readonly search: (query: string) => Promise<MindmapSearchResult[]>,
    private readonly onChoose: (result: MindmapSearchResult) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindmap-global-search-modal");
    contentEl.createEl("h2", { text: "全局搜索导图" });

    this.inputEl = contentEl.createEl("input", {
      cls: "mindmap-global-search-input",
      type: "search",
      attr: {
        placeholder: "搜索节点标题或节点笔记内容..."
      }
    });

    this.statusEl = contentEl.createDiv({ cls: "mindmap-global-search-status" });
    this.resultsEl = contentEl.createDiv({ cls: "mindmap-global-search-results" });
    this.renderEmpty("输入关键词开始搜索所有导图");

    this.inputEl.addEventListener("input", () => this.scheduleSearch());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && this.results[0]) {
        event.preventDefault();
        void this.chooseResult(this.results[0]);
      }
    });

    window.setTimeout(() => this.inputEl.focus(), 0);
  }

  onClose(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private scheduleSearch(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
    }
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.runSearch();
    }, this.searchDebounceMs);
  }

  private async runSearch(): Promise<void> {
    const query = this.inputEl.value.trim();
    const token = ++this.searchToken;
    if (!query) {
      this.results = [];
      this.renderEmpty("输入关键词开始搜索所有导图");
      return;
    }
    if (query.length < 2) {
      this.results = [];
      this.renderEmpty("至少输入 2 个字符开始搜索");
      return;
    }

    this.statusEl.setText(this.results.length > 0 ? "继续输入后将更新搜索结果..." : "搜索中...");
    const results = await this.search(query);
    if (token !== this.searchToken) {
      return;
    }
    this.results = results;
    this.renderResults(results, query);
  }

  private renderEmpty(text: string): void {
    this.statusEl.setText(text);
    this.resultsEl.empty();
  }

  private renderResults(results: MindmapSearchResult[], query: string): void {
    this.resultsEl.empty();
    if (results.length === 0) {
      this.statusEl.setText(`未找到与“${query}”相关的导图节点`);
      return;
    }
    this.statusEl.setText(`找到 ${results.length} 条结果`);
    results.forEach((result) => {
      const itemEl = this.resultsEl.createEl("button", { cls: "mindmap-global-search-result" });
      itemEl.type = "button";
      itemEl.addEventListener("click", () => {
        void this.chooseResult(result);
      });

      const titleEl = itemEl.createDiv({ cls: "mindmap-global-search-result-title" });
      titleEl.createSpan({ cls: "mindmap-global-search-result-node", text: result.nodeTitle || "未命名节点" });
      titleEl.createSpan({
        cls: "mindmap-global-search-result-badge",
        text: result.matchType === "title" ? "标题" : "笔记"
      });

      itemEl.createDiv({ cls: "mindmap-global-search-result-excerpt", text: result.excerpt });
      itemEl.createDiv({ cls: "mindmap-global-search-result-path", text: `${result.file.path} · ${result.path.join(" / ")}` });
    });
  }

  private async chooseResult(result: MindmapSearchResult): Promise<void> {
    this.close();
    await this.onChoose(result);
  }
}

export default class MindmapPlugin extends Plugin {
  settings: MindmapPluginSettings = { ...DEFAULT_SETTINGS };
  private readonly preferredLeafIds = new Map<string, string>();
  private readonly dedupeTimers = new Set<number>();
  private isApplyingDedupe = false;
  private lastSplitCreationTime = 0;
  private readonly SPLIT_SCREEN_PROTECTION_DELAY = 5000; // 5 seconds protection after explicit split creation
  private readonly intentionalSplitLeafIds = new Set<string>(); // Track intentionally created splits
  
  // Method to be called by views when they create intentional splits
  public markSplitCreation(leafId: string): void {
    this.intentionalSplitLeafIds.add(leafId);
    console.log('[MindmapPlugin] ✅ Marked intentional split:', leafId, 'Total protected:', this.intentionalSplitLeafIds.size);
    this.logTabDebug("mark-split-creation", { leafId, totalProtected: this.intentionalSplitLeafIds.size });
    
    // Clean up after protection delay
    window.setTimeout(() => {
      this.intentionalSplitLeafIds.delete(leafId);
      console.log('[MindmapPlugin] ❌ Cleared intentional split protection:', leafId);
      this.logTabDebug("clear-split-protection", { leafId });
    }, this.SPLIT_SCREEN_PROTECTION_DELAY);
  }
  
  private isIntentionalSplit(leafId: string): boolean {
    const result = this.intentionalSplitLeafIds.has(leafId);
    if (result) {
      console.log('[MindmapPlugin] 🔒 Leaf is protected:', leafId);
    }
    return result;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MindmapSettingTab(this.app, this));
    this.registerView(MINDMAP_VIEW_TYPE, (leaf) => new MindmapView(leaf));
    this.registerExtensions([PRIMARY_MINDMAP_EXTENSION, LEGACY_MINDMAP_EXTENSION], MINDMAP_VIEW_TYPE);
    this.logTabDebug("plugin-onload");
    this.scheduleMindmapTabDedupe();
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!this.isMindmapFile(file)) {
          return;
        }
        this.logTabDebug("event:file-open", { file: file.path });
        this.scheduleMindmapTabDedupe(file);
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const path = leaf ? this.getAnyLeafPath(leaf) : undefined;
        this.logTabDebug("event:active-leaf-change", {
          debugWanted: "PLEASE_COPY_ALL_WORKSPACE_LEAVES_JSON_AND_VISIBLE_TAB_HEADERS_JSON",
          leafId: leaf ? this.getLeafId(leaf) : null,
          leafType: leaf?.view.getViewType(),
          path
        });
        if (!path) {
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile && this.isMindmapFile(file)) {
          this.scheduleMindmapTabDedupe(file);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.logTabDebug("event:layout-change");
        this.scheduleMindmapTabDedupe();
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const folder = file instanceof TFolder ? file : file?.parent;
        if (!folder) {
          return;
        }
        menu.addItem((item) => {
          item.setTitle("新建思维导图").setIcon("network").onClick(() => {
            void this.createMindmapFile(folder);
          });
        });
        if (file instanceof TFile && this.isMindmapFile(file)) {
          menu.addItem((item) => {
            item.setTitle("导出为 Markdown").setIcon("file-text").onClick(() => {
              void this.exportMindmapFileToMarkdown(file);
            });
          });
        }
        if (file instanceof TFile && this.isMarkdownFile(file)) {
          menu.addItem((item) => {
            item.setTitle("转换为思维导图").setIcon("network").onClick(() => {
              void this.convertMarkdownFileToMindmap(file);
            });
          });
        }
      })
    );

    this.addCommand({
      id: "create-mindmap-file",
      name: "Create a new mindmap file",
      callback: () => void this.createMindmapFile()
    });

    this.addCommand({
      id: "toggle-selected-node-note-drawer",
      name: "Toggle selected node note drawer",
      hotkeys: [{ modifiers: ["Mod"], key: "E" }],
      checkCallback: (checking) => {
        const activeView = this.app.workspace.getActiveViewOfType(MindmapView);
        if (!(activeView instanceof MindmapView)) {
          return false;
        }
        const canRun = !!activeView.getState().file;
        if (!canRun) {
          return false;
        }
        if (!checking) {
          void activeView.toggleDrawerForSelection();
        }
        return true;
      }
    });

    this.addCommand({
      id: "open-active-mindmap-in-view",
      name: "Open active mindmap in mindmap view",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const ok = this.isMindmapFile(file);
        if (!ok) {
          return false;
        }
        if (!checking && file) {
          void this.openMindmapFile(file);
        }
        return true;
      }
    });

    this.addCommand({
      id: "global-search-mindmaps",
      name: "Search all mindmaps",
      hotkeys: [{ modifiers: ["Mod"], key: "f" }],
      callback: () => {
        this.openGlobalSearchModal();
      }
    });
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData() as Partial<MindmapPluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...loaded };
    if (this.settings.minChildCount > this.settings.maxChildCount) {
      this.settings.maxChildCount = this.settings.minChildCount;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async onunload(): Promise<void> {
    for (const timer of this.dedupeTimers) {
      window.clearTimeout(timer);
    }
    this.dedupeTimers.clear();
    await this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE).reduce(async (prev, leaf) => {
      await prev;
      await leaf.setViewState({ type: "empty" });
    }, Promise.resolve());
  }

  private getVisibleTabHeaders(): Array<Record<string, unknown>> {
    return Array.from(document.querySelectorAll(".workspace-tab-header")).map((tabEl, index) => {
      const element = tabEl as HTMLElement;
      const titleEl = element.querySelector(".workspace-tab-header-inner-title");
      return {
        index,
        text: titleEl?.textContent?.trim() ?? element.textContent?.trim() ?? "",
        ariaLabel: element.getAttribute("aria-label"),
        active: element.classList.contains("is-active"),
        classes: element.className
      };
    });
  }

  private snapshotLeaf(leaf: WorkspaceLeaf): Record<string, unknown> {
    return {
      id: this.getLeafId(leaf),
      type: leaf.view.getViewType(),
      path: this.getAnyLeafPath(leaf),
      mindmapPath: this.getMindmapLeafPath(leaf),
      isMindmap: this.getMindmapLeafPath(leaf) !== undefined
    };
  }

  private logTabDebug(stage: string, extra?: Record<string, unknown>): void {
    if (!DEBUG_TAB_DEDUPE) {
      return;
    }
    const activeLeaf = this.app.workspace.getMostRecentLeaf() as WorkspaceLeaf | null;
    const candidateLeaves = this.getAllCandidateLeaves().map((leaf) => this.snapshotLeaf(leaf));
    const allWorkspaceLeaves = this.getAllWorkspaceLeaves().map((leaf) => this.snapshotLeaf(leaf));
    const visibleTabHeaders = this.getVisibleTabHeaders();
    console.log("[mindmap-tab-debug]", stage, {
      preferredLeafIds: Object.fromEntries(this.preferredLeafIds.entries()),
      activeLeafId: this.getLeafId(activeLeaf),
      candidateLeaves,
      candidateLeavesJson: JSON.stringify(candidateLeaves),
      allWorkspaceLeaves,
      allWorkspaceLeavesJson: JSON.stringify(allWorkspaceLeaves),
      visibleTabHeaders,
      visibleTabHeadersJson: JSON.stringify(visibleTabHeaders),
      ...extra
    });
  }

  private async createMindmapFile(targetFolder?: TFolder | null): Promise<void> {
    const folder = targetFolder ?? this.resolveCurrentFolder();
    const finalPath = this.getNextMindmapPath(folder?.path ?? "", "新建导图");
    const newFile = await this.app.vault.create(
      finalPath,
      JSON.stringify(createDefaultMindmap(), null, 2)
    );
    // new Notice(`已创建导图：${newFile.path}`);
    this.logTabDebug("create-mindmap-file", { file: newFile.path, folder: folder?.path ?? "" });
    await this.openMindmapFile(newFile);
  }

  private async exportMindmapFileToMarkdown(file: TFile): Promise<void> {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const doc = JSON.parse(raw) as MindmapDocument;
      const markdown = this.mindmapDocumentToMarkdown(doc);
      const folderPath = file.parent?.path ?? "";
      const baseName = file.basename.replace(/\.mindmap$/i, "");
      const finalPath = this.getNextMarkdownPath(folderPath, baseName);
      const markdownFile = await this.app.vault.create(finalPath, markdown);
      new Notice(`已导出 Markdown：${markdownFile.path}`);
    } catch (error) {
      new Notice(`导出 Markdown 失败：${String(error)}`);
    }
  }

  private async convertMarkdownFileToMindmap(file: TFile): Promise<void> {
    try {
      const markdown = await this.app.vault.cachedRead(file);
      const doc = this.markdownToMindmapDocument(markdown, file.basename, file.path);
      const folderPath = file.parent?.path ?? "";
      const finalPath = this.getNextMindmapPath(folderPath, file.basename);
      doc.selfPath = finalPath;
      const mindmapFile = await this.app.vault.create(finalPath, JSON.stringify(doc, null, 2));
      new Notice(`已转换为思维导图：${mindmapFile.path}`);
      await this.openMindmapFile(mindmapFile);
    } catch (error) {
      new Notice(`转换思维导图失败：${String(error)}`);
    }
  }

  private createNodeFromMarkdownHeading(title: string, note: string): MindmapNode {
    return {
      id: crypto.randomUUID(),
      title: title.trim() || "未命名节点",
      x: 240,
      y: 200,
      collapsed: false,
      note: note.trim(),
      children: []
    };
  }

  private stripMarkdownTitleMarkup(title: string): string {
    return title
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
  }

  private markdownToMindmapDocument(markdownText: string, fallbackTitle: string, sourcePath?: string): MindmapDocument {
    const sections: Array<{ level: number; title: string; lines: string[] }> = [];
    let current: { level: number; title: string; lines: string[] } | null = null;
    let inFence = false;
    const preamble: string[] = [];

    markdownText.split(/\r?\n/).forEach((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
      }
      const headingMatch = !inFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim()) : null;
      if (headingMatch) {
        current = {
          level: headingMatch[1].length,
          title: this.stripMarkdownTitleMarkup(headingMatch[2]),
          lines: []
        };
        sections.push(current);
        return;
      }
      if (current) {
        current.lines.push(line);
      } else {
        preamble.push(line);
      }
    });

    if (sections.length === 0) {
      const root = this.createNodeFromMarkdownHeading(fallbackTitle || "导图", markdownText);
      return {
        version: 1,
        root,
        selfPath: sourcePath
      };
    }

    const firstSection = sections[0];
    const rootNote = [...preamble, ...firstSection.lines].join("\n").trim();
    const rootTitle = firstSection.title || fallbackTitle || "导图";
    const root = this.createNodeFromMarkdownHeading(rootTitle, rootNote);
    const stack: Array<{ level: number; node: MindmapNode }> = [{ level: firstSection.level, node: root }];

    sections.slice(1).forEach((section) => {
      const node = this.createNodeFromMarkdownHeading(section.title, section.lines.join("\n"));
      while (stack.length > 1 && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]?.level < section.level
        ? stack[stack.length - 1].node
        : root;
      parent.children.push(node);
      stack.push({ level: section.level, node });
    });

    return {
      version: 1,
      root,
      selfPath: sourcePath
    };
  }

  private mindmapDocumentToMarkdown(doc: MindmapDocument): string {
    const blocks: string[] = [];
    const appendNode = (node: MindmapNode, depth: number): void => {
      const headingLevel = Math.min(6, Math.max(1, depth));
      blocks.push(`${"#".repeat(headingLevel)} ${node.title.trim() || "未命名节点"}`);
      const note = node.note?.trim();
      if (note) {
        blocks.push(note);
      }
      node.children.forEach((child) => appendNode(child, depth + 1));
    };
    appendNode(doc.root, 1);
    return `${blocks.join("\n\n").trim()}\n`;
  }

  private getNextMarkdownPath(folderPath: string, baseName: string): string {
    let index = 0;
    while (true) {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const candidateName = `${baseName}${suffix}.md`;
      const candidatePath = normalizePath(folderPath ? `${folderPath}/${candidateName}` : candidateName);
      if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }
      index += 1;
    }
  }

  private resolveCurrentFolder(): TFolder | null {
    const active = this.app.workspace.getActiveFile();
    if (active?.parent) {
      return active.parent;
    }
    const root = this.app.vault.getRoot();
    return root instanceof TFolder ? root : null;
  }

  private getNextMindmapPath(folderPath: string, baseName: string): string {
    let index = 0;
    while (true) {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const candidateName = `${baseName}${suffix}.${PRIMARY_MINDMAP_EXTENSION}`;
      const candidatePath = normalizePath(folderPath ? `${folderPath}/${candidateName}` : candidateName);
      if (!this.app.vault.getAbstractFileByPath(candidatePath)) {
        return candidatePath;
      }
      index += 1;
    }
  }

  private isMindmapFile(file: TFile | null): file is TFile {
    if (!file) {
      return false;
    }
    return file.name.endsWith(`.${PRIMARY_MINDMAP_EXTENSION}`) || file.name.endsWith(`.${LEGACY_MINDMAP_EXTENSION}`);
  }

  private isMarkdownFile(file: TFile | null): file is TFile {
    return !!file && file.extension.toLowerCase() === "md";
  }

  public openGlobalSearchModal(): void {
    new MindmapGlobalSearchModal(
      this.app,
      (query) => this.searchMindmapFiles(query),
      (result) => this.openSearchResult(result)
    ).open();
  }

  private async searchMindmapFiles(query: string): Promise<MindmapSearchResult[]> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const results: MindmapSearchResult[] = [];
    const files = this.app.vault.getFiles()
      .filter((file) => this.isMindmapFile(file))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));

    for (const file of files) {
      try {
        const raw = await this.app.vault.cachedRead(file);
        const parsed = JSON.parse(raw) as MindmapDocument;
        const doc = normalizeMindmapDocument(parsed);
        const nodePaths = new Map<string, string[]>();
        const collectPaths = (node: MindmapNode, path: string[]): void => {
          const nodeTitle = node.title.trim() || "未命名节点";
          const nextPath = [...path, nodeTitle];
          nodePaths.set(node.id, nextPath);
          node.children.forEach((child) => collectPaths(child, nextPath));
        };
        collectPaths(doc.root, []);

        walkNodes(doc.root, (node) => {
          const title = node.title ?? "";
          const note = node.note ?? "";
          const titleIndex = title.toLowerCase().indexOf(normalizedQuery);
          const noteIndex = note.toLowerCase().indexOf(normalizedQuery);
          if (titleIndex >= 0) {
            results.push({
              file,
              nodeId: node.id,
              nodeTitle: title.trim() || "未命名节点",
              matchType: "title",
              excerpt: this.createSearchExcerpt(title, titleIndex, query),
              path: nodePaths.get(node.id) ?? [title.trim() || "未命名节点"]
            });
            return;
          }
          if (noteIndex >= 0) {
            results.push({
              file,
              nodeId: node.id,
              nodeTitle: title.trim() || "未命名节点",
              matchType: "note",
              excerpt: this.createSearchExcerpt(note, noteIndex, query),
              path: nodePaths.get(node.id) ?? [title.trim() || "未命名节点"]
            });
          }
        });
      } catch (error) {
        console.warn("Failed to search mindmap file", file.path, error);
      }
    }

    return results.slice(0, 100);
  }

  private createSearchExcerpt(text: string, matchIndex: number, query: string): string {
    const compactText = text.replace(/\s+/g, " ").trim();
    if (!compactText) {
      return "";
    }
    const normalizedText = compactText.toLowerCase();
    const normalizedQuery = query.trim().toLowerCase();
    const compactMatchIndex = Math.max(0, normalizedText.indexOf(normalizedQuery, Math.max(0, matchIndex - 20)));
    const start = Math.max(0, compactMatchIndex - 36);
    const end = Math.min(compactText.length, compactMatchIndex + Math.max(normalizedQuery.length, 1) + 72);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < compactText.length ? "..." : "";
    return `${prefix}${compactText.slice(start, end)}${suffix}`;
  }

  private async openSearchResult(result: MindmapSearchResult): Promise<void> {
    const leaf = await this.openMindmapFile(result.file);
    const view = leaf.view;
    if (view instanceof MindmapView) {
      view.revealNodeById(result.nodeId, { openDrawer: result.matchType === "note" });
      return;
    }
    new Notice("已打开导图，但未能定位节点");
  }

  private scheduleMindmapTabDedupe(file?: TFile): void {
    const delays = [30, 120, 360]; // Removed 0ms delay to avoid race conditions with new splits
    this.logTabDebug("schedule-dedupe", { file: file?.path, delays });
    for (const delay of delays) {
      const timer = window.setTimeout(() => {
        this.dedupeTimers.delete(timer);
        if (this.isApplyingDedupe) {
          this.logTabDebug("skip-dedupe-while-applying", { file: file?.path, delay });
          return;
        }
        this.logTabDebug("run-dedupe-timer", { file: file?.path, delay });
        if (file) {
          void this.ensureSingleMindmapTab(file);
          return;
        }
        void this.ensureUniqueMindmapTabs();
      }, delay);
      this.dedupeTimers.add(timer);
    }
  }

  private async openMindmapFile(file: TFile): Promise<WorkspaceLeaf> {
    const existingLeaf = this.findLeafByFilePath(file.path) ?? this.findMindmapLeafByPath(file.path);
    // Only reuse existing leaf if it exists; otherwise create a new split
    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
    
    // If we're creating a new split (not reusing), mark the protection timestamp
    if (!existingLeaf) {
      this.lastSplitCreationTime = Date.now();
      this.logTabDebug("open-mindmap-file:new-split-created", {
        file: file.path,
        targetLeafId: this.getLeafId(leaf)
      });
    }
    
    this.logTabDebug("open-mindmap-file", {
      file: file.path,
      existingLeafId: existingLeaf ? this.getLeafId(existingLeaf) : null,
      targetLeafId: this.getLeafId(leaf),
      targetLeafType: leaf.view.getViewType()
    });
    this.preferredLeafIds.set(file.path, this.getLeafId(leaf));
    await leaf.setViewState({
      type: MINDMAP_VIEW_TYPE,
      active: true,
      state: { file: file.path }
    });
    this.app.workspace.revealLeaf(leaf);
    this.logTabDebug("open-mindmap-file:done", {
      file: file.path,
      targetLeafId: this.getLeafId(leaf)
    });
    return leaf;
  }

  private findMindmapLeafByPath(path: string): WorkspaceLeaf | undefined {
    return this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE).find((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MindmapView)) {
        return false;
      }
      return view.getState().file === path;
    });
  }

  private findLeafByFilePath(path: string): WorkspaceLeaf | undefined {
    const workspace = this.app.workspace as unknown as {
      getLeavesOfType: (type: string) => WorkspaceLeaf[];
    };
    const candidateTypes = [MINDMAP_VIEW_TYPE, "markdown", "empty"];
    for (const type of candidateTypes) {
      for (const leaf of workspace.getLeavesOfType(type)) {
        const leafPath = this.getAnyLeafPath(leaf);
        if (leafPath === path) {
          this.logTabDebug("find-leaf-by-file-path:hit", {
            path,
            leafId: this.getLeafId(leaf),
            leafType: leaf.view.getViewType()
          });
          return leaf;
        }
      }
    }
    this.logTabDebug("find-leaf-by-file-path:miss", { path });
    return undefined;
  }

  private async ensureSingleMindmapTab(file: TFile): Promise<void> {
    if (this.isApplyingDedupe) {
      this.logTabDebug("ensure-single:skip-reentrant", { file: file.path });
      return;
    }
    this.isApplyingDedupe = true;
    try {
      const leaves = this.getAllLeavesByFilePath(file.path);
      
      // Filter out intentional splits from deduplication consideration
      const nonIntentionalLeaves = leaves.filter(leaf => !this.isIntentionalSplit(this.getLeafId(leaf)));
      const intentionalLeaves = leaves.filter(leaf => this.isIntentionalSplit(this.getLeafId(leaf)));
      
      this.logTabDebug("ensure-single:start", {
        debugWanted: "PLEASE_COPY_LEAVES_JSON",
        file: file.path,
        totalLeaves: leaves.length,
        intentionalLeaves: intentionalLeaves.length,
        nonIntentionalLeaves: nonIntentionalLeaves.length,
        intentionalLeafIds: intentionalLeaves.map(l => this.getLeafId(l)),
        leavesJson: JSON.stringify(leaves.map((leaf) => this.snapshotLeaf(leaf)))
      });
      
      // Allow up to 2 leaves for the same file (split-screen support)
      // This applies to both intentional splits and regular splits (right-click tab)
      const maxAllowedLeaves = 2;
      
      if (leaves.length <= maxAllowedLeaves) {
        if (leaves[0]) {
          this.preferredLeafIds.set(file.path, this.getLeafId(leaves[0]));
        }
        this.logTabDebug("ensure-single:allow-leaves", { 
          file: file.path, 
          count: leaves.length,
          maxAllowed: maxAllowedLeaves,
          reason: "Within allowed limit (split-screen supported)"
        });
        return;
      }

      // Close excess leaves beyond the allowed limit
      const leavesToKeep = leaves.slice(0, maxAllowedLeaves);
      const leavesToRemove = leaves.slice(maxAllowedLeaves);
      
      this.logTabDebug("ensure-single:excess-leaves", {
        file: file.path,
        keepCount: leavesToKeep.length,
        removeCount: leavesToRemove.length,
        removeLeafIds: leavesToRemove.map(l => this.getLeafId(l))
      });
      
      // Keep the preferred leaf active
      if (leavesToKeep[0]) {
        this.preferredLeafIds.set(file.path, this.getLeafId(leavesToKeep[0]));
      }
      
      // Remove excess leaves
      for (const leaf of leavesToRemove) {
        if (!this.isIntentionalSplit(this.getLeafId(leaf))) {
          this.detachLeaf(leaf);
        } else {
          console.warn('[MindmapPlugin] ⚠️ Skipping removal of protected intentional split:', this.getLeafId(leaf));
        }
      }
      
      // Reveal the preferred leaf
      if (leavesToKeep[0]) {
        this.app.workspace.revealLeaf(leavesToKeep[0]);
      }
    } finally {
      this.isApplyingDedupe = false;
    }
  }

  private async ensureUniqueMindmapTabs(): Promise<void> {
    if (this.isApplyingDedupe) {
      this.logTabDebug("ensure-unique:skip-reentrant");
      return;
    }
    this.isApplyingDedupe = true;
    try {
      const orphanMindmapLeaves = this.getAllWorkspaceLeaves().filter((leaf) => {
        return leaf.view.getViewType() === MINDMAP_VIEW_TYPE && !this.getAnyLeafPath(leaf);
      });
      if (orphanMindmapLeaves.length > 0) {
        this.logTabDebug("ensure-unique:orphan-mindmap-leaves", {
          orphans: orphanMindmapLeaves.map((leaf) => this.snapshotLeaf(leaf)),
          orphansJson: JSON.stringify(orphanMindmapLeaves.map((leaf) => this.snapshotLeaf(leaf)))
        });
        for (const leaf of orphanMindmapLeaves) {
          this.detachLeaf(leaf);
        }
      }

      const groups = new Map<string, WorkspaceLeaf[]>();
      for (const leaf of this.getAllCandidateLeaves()) {
        const path = this.getAnyLeafPath(leaf);
        if (!path) {
          continue;
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || !this.isMindmapFile(file)) {
          continue;
        }
        const list = groups.get(path) ?? [];
        if (!list.includes(leaf)) {
          list.push(leaf);
        }
        groups.set(path, list);
      }

      this.logTabDebug("ensure-unique:start", {
        debugWanted: "PLEASE_COPY_GROUPS_JSON",
        groups: Array.from(groups.entries()).map(([path, leaves]) => ({
          path,
          leaves: leaves.map((leaf) => this.snapshotLeaf(leaf))
        })),
        groupsJson: JSON.stringify(
          Array.from(groups.entries()).map(([path, leaves]) => ({
            path,
            leaves: leaves.map((leaf) => this.snapshotLeaf(leaf))
          }))
        )
      });

      for (const [path, leaves] of groups) {
        // Filter intentional splits
        const intentionalLeaves = leaves.filter(leaf => this.isIntentionalSplit(this.getLeafId(leaf)));
        const nonIntentionalLeaves = leaves.filter(leaf => !this.isIntentionalSplit(this.getLeafId(leaf)));
        
        // Allow up to 2 leaves for the same file (split-screen support)
        // This applies to both intentional splits and regular splits (right-click tab)
        const maxAllowedLeaves = 2;
        
        if (leaves.length <= maxAllowedLeaves) {
          if (leaves[0]) {
            this.preferredLeafIds.set(path, this.getLeafId(leaves[0]));
          }
          this.logTabDebug("ensure-unique:allow-group", {
            path,
            count: leaves.length,
            intentionalCount: intentionalLeaves.length,
            maxAllowed: maxAllowedLeaves,
            reason: "Within allowed limit (split-screen supported)"
          });
          continue;
        }
        
        const keeper = this.pickKeeperLeaf(path, [...intentionalLeaves, ...nonIntentionalLeaves]);
        this.logTabDebug("ensure-unique:keeper-picked", {
          path,
          keeperId: this.getLeafId(keeper),
          keeperType: keeper.view.getViewType(),
          keeperPath: this.getAnyLeafPath(keeper),
          isIntentional: this.isIntentionalSplit(this.getLeafId(keeper))
        });
        this.preferredLeafIds.set(path, this.getLeafId(keeper));
        if (this.getMindmapLeafPath(keeper) !== path) {
          this.logTabDebug("ensure-unique:convert-keeper", {
            path,
            keeperId: this.getLeafId(keeper),
            keeperType: keeper.view.getViewType()
          });
          await keeper.setViewState({
            type: MINDMAP_VIEW_TYPE,
            active: true,
            state: { file: path }
          });
        }
        for (const leaf of leaves) {
          if (leaf === keeper) {
            continue;
          }
          // Never detach intentional splits
          if (this.isIntentionalSplit(this.getLeafId(leaf))) {
            this.logTabDebug("ensure-unique:skip-intentional-leaf", {
              path,
              leafId: this.getLeafId(leaf)
            });
            continue;
          }
          this.logTabDebug("ensure-unique:detach-leaf", {
            path,
            leafId: this.getLeafId(leaf),
            leafType: leaf.view.getViewType(),
            leafPath: this.getAnyLeafPath(leaf)
          });
          this.detachLeaf(leaf);
        }
        this.app.workspace.revealLeaf(keeper);
      }

      this.logTabDebug("ensure-unique:done");
    } finally {
      this.isApplyingDedupe = false;
    }
  }

  private getMindmapLeavesByPath(path: string): WorkspaceLeaf[] {
    return this.getAllMindmapLeaves().filter((leaf) => this.getMindmapLeafPath(leaf) === path);
  }

  private getAllMindmapLeaves(): WorkspaceLeaf[] {
    const grouped = new Map<string, WorkspaceLeaf>();
    for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
      const path = this.getMindmapLeafPath(leaf);
      if (!path || grouped.has(`${path}::${this.getLeafId(leaf)}`)) {
        continue;
      }
      grouped.set(`${path}::${this.getLeafId(leaf)}`, leaf);
    }
    return Array.from(grouped.values());
  }

  private getAllCandidateLeaves(): WorkspaceLeaf[] {
    const grouped = new Map<string, WorkspaceLeaf>();
    const candidateTypes = [MINDMAP_VIEW_TYPE, "markdown", "empty", "file-explorer"];
    for (const leaf of this.getAllWorkspaceLeaves()) {
      const type = leaf.view.getViewType();
      if (!candidateTypes.includes(type)) {
        continue;
      }
      const key = this.getLeafId(leaf);
      if (!key || grouped.has(key)) {
        continue;
      }
      grouped.set(key, leaf);
    }
    return Array.from(grouped.values());
  }

  private getAllWorkspaceLeaves(): WorkspaceLeaf[] {
    const workspace = this.app.workspace as unknown as {
      iterateAllLeaves?: (callback: (leaf: WorkspaceLeaf) => void) => void;
      getLeavesOfType: (type: string) => WorkspaceLeaf[];
    };
    const grouped = new Map<string, WorkspaceLeaf>();

    if (typeof workspace.iterateAllLeaves === "function") {
      workspace.iterateAllLeaves((leaf) => {
        const key = this.getLeafId(leaf);
        if (!key || grouped.has(key)) {
          return;
        }
        grouped.set(key, leaf);
      });
      return Array.from(grouped.values());
    }

    const fallbackTypes = [MINDMAP_VIEW_TYPE, "markdown", "empty", "file-explorer"];
    for (const type of fallbackTypes) {
      for (const leaf of workspace.getLeavesOfType(type)) {
        const key = this.getLeafId(leaf);
        if (!key || grouped.has(key)) {
          continue;
        }
        grouped.set(key, leaf);
      }
    }
    return Array.from(grouped.values());
  }

  private getAllLeavesByFilePath(path: string): WorkspaceLeaf[] {
    return this.getAllCandidateLeaves().filter((leaf) => this.getAnyLeafPath(leaf) === path);
  }

  private getMindmapLeafPath(leaf: WorkspaceLeaf): string | undefined {
    const view = leaf.view;
    if (!(view instanceof MindmapView)) {
      return undefined;
    }
    return view.getState().file;
  }

  private getAnyLeafPath(leaf: WorkspaceLeaf): string | undefined {
    const mindmapPath = this.getMindmapLeafPath(leaf);
    if (mindmapPath) {
      return mindmapPath;
    }

    const viewWithFile = leaf.view as { file?: TFile | null; getState?: () => { file?: string } };
    if (viewWithFile.file instanceof TFile) {
      return viewWithFile.file.path;
    }
    const statePath = viewWithFile.getState?.().file;
    if (statePath) {
      return statePath;
    }
    return undefined;
  }

  private pickKeeperLeaf(path: string, leaves: WorkspaceLeaf[]): WorkspaceLeaf {
    const preferredId = this.preferredLeafIds.get(path);
    if (preferredId) {
      const preferredLeaf = leaves.find((leaf) => this.getLeafId(leaf) === preferredId);
      if (preferredLeaf) {
        this.logTabDebug("pick-keeper:preferred", {
          path,
          keeperId: this.getLeafId(preferredLeaf)
        });
        return preferredLeaf;
      }
    }

    const existingMindmapLeaf = leaves.find((leaf) => this.getMindmapLeafPath(leaf) === path && leaf !== this.app.workspace.getMostRecentLeaf());
    if (existingMindmapLeaf) {
      this.logTabDebug("pick-keeper:existing-mindmap", {
        path,
        keeperId: this.getLeafId(existingMindmapLeaf)
      });
      return existingMindmapLeaf;
    }

    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    if (activeLeaf && leaves.includes(activeLeaf)) {
      this.logTabDebug("pick-keeper:active-leaf", {
        path,
        keeperId: this.getLeafId(activeLeaf)
      });
      return activeLeaf;
    }

    const fallback = [...leaves].sort((a, b) => this.getLeafId(a).localeCompare(this.getLeafId(b)))[0];
    this.logTabDebug("pick-keeper:fallback", {
      path,
      keeperId: this.getLeafId(fallback)
    });
    return fallback;
  }

  private getLeafId(leaf: WorkspaceLeaf | null | undefined): string {
    if (!leaf) {
      return "<none>";
    }
    const withId = leaf as WorkspaceLeaf & { id?: string | number };
    return String(withId.id ?? "");
  }

  private detachLeaf(leaf: WorkspaceLeaf): void {
    const leafId = this.getLeafId(leaf);
    const isProtected = this.isIntentionalSplit(leafId);
    
    console.log('[MindmapPlugin] 🗑️ DETACHING leaf:', {
      leafId,
      leafType: leaf.view.getViewType(),
      leafPath: this.getAnyLeafPath(leaf),
      isProtected,
      protectedIds: Array.from(this.intentionalSplitLeafIds)
    });
    
    if (isProtected) {
      console.error('[MindmapPlugin] ❌ ERROR: Attempting to detach PROTECTED leaf!', leafId);
    }
    
    this.logTabDebug("detach-leaf", {
      leafId,
      leafType: leaf.view.getViewType(),
      leafPath: this.getAnyLeafPath(leaf)
    });
    const workspace = this.app.workspace as unknown as {
      detachLeaf?: (leaf: WorkspaceLeaf) => void;
      removeLeaf?: (leaf: WorkspaceLeaf) => void;
    };
    const leafWithDetach = leaf as WorkspaceLeaf & { detach?: () => void };

    if (typeof workspace.detachLeaf === "function") {
      workspace.detachLeaf(leaf);
      return;
    }
    if (typeof workspace.removeLeaf === "function") {
      workspace.removeLeaf(leaf);
      return;
    }
    if (typeof leafWithDetach.detach === "function") {
      leafWithDetach.detach();
    }
  }
}
