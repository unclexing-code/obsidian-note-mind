import { Notice, Plugin, TFile, TFolder, normalizePath, type WorkspaceLeaf } from "obsidian";
import { createDefaultMindmap } from "./src/types";
import { MINDMAP_VIEW_TYPE, MindmapView } from "./src/view";

const PRIMARY_MINDMAP_EXTENSION = "mindmap";
const LEGACY_MINDMAP_EXTENSION = "mindmap.json";
const DEBUG_TAB_DEDUPE = true;

export default class MindmapPlugin extends Plugin {
  private readonly preferredLeafIds = new Map<string, string>();
  private readonly dedupeTimers = new Set<number>();
  private isApplyingDedupe = false;

  async onload(): Promise<void> {
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
    new Notice(`已创建导图：${newFile.path}`);
    this.logTabDebug("create-mindmap-file", { file: newFile.path, folder: folder?.path ?? "" });
    await this.openMindmapFile(newFile);
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

  private scheduleMindmapTabDedupe(file?: TFile): void {
    const delays = [0, 30, 120, 360];
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

  private async openMindmapFile(file: TFile): Promise<void> {
    const existingLeaf = this.findLeafByFilePath(file.path) ?? this.findMindmapLeafByPath(file.path);
    const leaf = existingLeaf ?? this.app.workspace.getLeaf(true);
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
      this.logTabDebug("ensure-single:start", {
        debugWanted: "PLEASE_COPY_LEAVES_JSON",
        file: file.path,
        leaves,
        leavesJson: JSON.stringify(leaves.map((leaf) => this.snapshotLeaf(leaf)))
      });
      if (leaves.length <= 1) {
        if (leaves[0]) {
          this.preferredLeafIds.set(file.path, this.getLeafId(leaves[0]));
        }
        this.logTabDebug("ensure-single:no-duplicates", { file: file.path });
        return;
      }

      const keeper = this.pickKeeperLeaf(file.path, leaves);
      this.logTabDebug("ensure-single:keeper-picked", {
        file: file.path,
        keeperId: this.getLeafId(keeper),
        keeperType: keeper.view.getViewType(),
        keeperPath: this.getAnyLeafPath(keeper)
      });
      this.preferredLeafIds.set(file.path, this.getLeafId(keeper));
      if (this.getMindmapLeafPath(keeper) !== file.path) {
        this.logTabDebug("ensure-single:convert-keeper", {
          file: file.path,
          keeperId: this.getLeafId(keeper),
          keeperType: keeper.view.getViewType()
        });
        await keeper.setViewState({
          type: MINDMAP_VIEW_TYPE,
          active: true,
          state: { file: file.path }
        });
      }
      for (const leaf of leaves) {
        if (leaf === keeper) {
          continue;
        }
        this.logTabDebug("ensure-single:detach-leaf", {
          file: file.path,
          leafId: this.getLeafId(leaf),
          leafType: leaf.view.getViewType(),
          leafPath: this.getAnyLeafPath(leaf)
        });
        this.detachLeaf(leaf);
      }
      this.app.workspace.revealLeaf(keeper);
      this.logTabDebug("ensure-single:done", {
        file: file.path,
        keeperId: this.getLeafId(keeper)
      });
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
        if (leaves.length <= 1) {
          if (leaves[0]) {
            this.preferredLeafIds.set(path, this.getLeafId(leaves[0]));
          }
          continue;
        }
        const keeper = this.pickKeeperLeaf(path, leaves);
        this.logTabDebug("ensure-unique:keeper-picked", {
          path,
          keeperId: this.getLeafId(keeper),
          keeperType: keeper.view.getViewType(),
          keeperPath: this.getAnyLeafPath(keeper)
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
    this.logTabDebug("detach-leaf", {
      leafId: this.getLeafId(leaf),
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
