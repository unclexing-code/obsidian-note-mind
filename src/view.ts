import { App, ItemView, MarkdownRenderer, Menu, Modal, Notice, Platform, TFile, TFolder, normalizePath, type ViewStateResult } from "obsidian";
import { addChildNode, findNodeById, findParentOfNode, normalizeMindmapDocument, removeNode, reorderNodeWithinParent, reparentNode, visibleNodes, walkNodes } from "./store";
import { createDefaultMindmap, type MindmapDocument, type MindmapNode } from "./types";

type MindmapClipboardPayload = {
  version: 1;
  sourcePath: string | null;
  subtree: MindmapNode;
  forest?: MindmapNode[];
  operation: "copy" | "cut";
};

type MindmapLinkCandidate = {
  file: TFile;
  title: string;
  obsidianUrl: string;
};

const PRIMARY_MINDMAP_EXTENSION = "mindmap";
const LEGACY_MINDMAP_EXTENSION = "mindmap.json";

export const MINDMAP_VIEW_TYPE = "mindmap-view";

class MindmapAssociationModal extends Modal {
  private query = "";
  private inputEl!: HTMLInputElement;
  private listEl!: HTMLDivElement;
  private createButtonEl!: HTMLButtonElement;

  constructor(
    app: App,
    private readonly candidates: MindmapLinkCandidate[],
    private readonly createInitialTitle: string,
    private readonly onSelect: (candidate: MindmapLinkCandidate) => void,
    private readonly onCreate: (title: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindmap-association-modal");
    contentEl.createEl("h2", { text: "关联导图" });

    this.inputEl = contentEl.createEl("input", {
      cls: "mindmap-association-search",
      type: "text"
    });
    this.inputEl.placeholder = "输入导图名称或路径进行筛选，未找到可快速创建";
    this.inputEl.value = this.createInitialTitle;
    this.query = this.createInitialTitle;

    this.createButtonEl = contentEl.createEl("button", {
      cls: "mindmap-association-create-button",
      text: "快速创建并关联"
    });
    this.createButtonEl.type = "button";
    this.createButtonEl.addEventListener("click", () => {
      void this.createFromQuery();
    });

    this.listEl = contentEl.createDiv({ cls: "mindmap-association-list" });

    this.inputEl.addEventListener("input", () => {
      this.query = this.inputEl.value.trim();
      this.renderList();
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const filtered = this.getFilteredCandidates();
        if (filtered[0]) {
          this.chooseCandidate(filtered[0]);
        } else {
          void this.createFromQuery();
        }
      }
    });

    this.renderList();
    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private getFilteredCandidates(): MindmapLinkCandidate[] {
    const lowerQuery = this.query.toLowerCase();
    if (!lowerQuery) {
      return this.candidates;
    }
    return this.candidates.filter((candidate) => {
      return candidate.title.toLowerCase().includes(lowerQuery)
        || candidate.file.path.toLowerCase().includes(lowerQuery);
    });
  }

  private renderList(): void {
    this.listEl.empty();
    const title = this.query || this.createInitialTitle || "新建导图";
    this.createButtonEl.setText(`快速创建「${title}」并关联`);
    const filtered = this.getFilteredCandidates();
    if (filtered.length === 0) {
      this.listEl.createDiv({ cls: "mindmap-association-empty", text: "没有匹配的导图，可以直接快速创建。" });
      return;
    }
    filtered.forEach((candidate) => {
      const itemEl = this.listEl.createEl("button", { cls: "mindmap-association-item" });
      itemEl.type = "button";
      itemEl.createDiv({ cls: "mindmap-association-item-title", text: candidate.title });
      itemEl.createDiv({ cls: "mindmap-association-item-path", text: candidate.file.path });
      itemEl.addEventListener("click", () => this.chooseCandidate(candidate));
    });
  }

  private chooseCandidate(candidate: MindmapLinkCandidate): void {
    this.onSelect(candidate);
    this.close();
  }

  private async createFromQuery(): Promise<void> {
    const title = this.query || this.createInitialTitle || "新建导图";
    this.createButtonEl.disabled = true;
    try {
      await this.onCreate(title);
      this.close();
    } finally {
      this.createButtonEl.disabled = false;
    }
  }
}

export class MindmapView extends ItemView {
  private static readonly MINDMAP_CLIPBOARD_STORAGE_KEY = "obsidian-note-mind:clipboard";
  private static readonly DEFAULT_NODE_WIDTH = 160;
  private static readonly DEFAULT_NODE_HEIGHT = 44;
  private static readonly MIN_NODE_WIDTH = 120;
  private static readonly MIN_NODE_HEIGHT = 44;
  private static readonly DEFAULT_DRAWER_WIDTH = 380;
  private static readonly MIN_DRAWER_WIDTH = 300;
  private static readonly MAX_DRAWER_WIDTH = 860;
  private static readonly MIN_ZOOM_SCALE = 0.1;
  private static readonly MAX_ZOOM_SCALE = 3;
  private static readonly MOBILE_NODE_TOOLTIP_REOPEN_DELAY = 420;
  private static readonly MOBILE_NODE_DRAG_LONG_PRESS_DELAY = 300;
  private file: TFile | null = null;
  private doc: MindmapDocument | null = null;
  private layoutEl!: HTMLDivElement;
  private canvasEl!: HTMLDivElement;
  private mobileAddButtonEl!: HTMLButtonElement;
  private mobileSiblingAddButtonEl!: HTMLButtonElement;
  private mobileUndoButtonEl!: HTMLButtonElement;
  private mobileRedoButtonEl!: HTMLButtonElement;
  private mobileDeleteButtonEl!: HTMLButtonElement;
  private mobileNoteButtonEl!: HTMLButtonElement;
  private mobileLinkButtonEl!: HTMLButtonElement;
  private mobileSyncButtonEl!: HTMLButtonElement;
  private mobileRefreshButtonEl!: HTMLButtonElement;
  private desktopActionClusterEl!: HTMLDivElement;
  private desktopSyncButtonEl!: HTMLButtonElement;
  private desktopRefreshButtonEl!: HTMLButtonElement;
  private mobileZenButtonEl!: HTMLButtonElement;
  private mobileActionClusterEl!: HTMLDivElement;
  private mobileNodeTooltipEl!: HTMLDivElement;
  private mobileGlobalActionClusterEl!: HTMLDivElement;
  private nodeLinkActionButtonEl!: HTMLButtonElement;
  private drawerResizeHandleEl!: HTMLDivElement;
  private drawerEl!: HTMLDivElement;
  private drawerHeaderEl!: HTMLDivElement;
  private drawerTitleEl!: HTMLHeadingElement;
  private drawerCloseEl!: HTMLButtonElement;
  private noteModeToggleEl!: HTMLButtonElement;
  private nodeLinkInputEl!: HTMLInputElement;
  private noteSurfaceEl!: HTMLDivElement;
  private noteInputEl!: HTMLTextAreaElement;
  private notePreviewEl!: HTMLDivElement;
  private svgEl!: SVGSVGElement;
  private graphLayerEl!: SVGGElement;
  private marqueeEl!: HTMLDivElement;
  private selectedNodeId: string | null = null;
  private selectedNodeIds = new Set<string>();
  private editingNodeId: string | null = null;
  private saveTimer: number | null = null;
  private pendingRenderFrame: number | null = null;
  private pendingNodeSelectionTimer: number | null = null;
  private lastMobileNodeTap: { nodeId: string; time: number } | null = null;
  private isDragging = false;
  private dropTargetNodeId: string | null = null;
  private draggingNodeIds = new Set<string>();
  private dragOffset = { x: 0, y: 0 };
  private panOffset = { x: 0, y: 0 };
  private zoomScale = 1;
  private drawerWidth = MindmapView.DEFAULT_DRAWER_WIDTH;
  private isMobileLayout = Platform.isMobile;
  private pinchStartDistance: number | null = null;
  private pinchStartScale = 1;
  private touchPanStart: { x: number; y: number; panX: number; panY: number } | null = null;
  private zenTapCandidate: { nodeId: string | null; isCollapseToggle: boolean; x: number; y: number; time: number } | null = null;
  private lastZenNodeTap: { nodeId: string; time: number } | null = null;
  private audioContext: AudioContext | null = null;
  private isReloadingFromDisk = false;
  private blockEdgeSidebarGesture = false;
  private isZenMode = false;
  private shouldForceMobileZenOnNextRender = false;
  private navigationStack: string[] = [];
  private undoStack: MindmapDocument[] = [];
  private redoStack: MindmapDocument[] = [];
  private isApplyingHistory = false;
  private noteHistoryCapturedForSession = false;
  private linkHistoryCapturedForSession = false;
  private shouldCenterOnNextRender = false;
  private shouldFocusRootOnNextRender = false;
  private pendingFocusLinkedFromPath: string | null = null;
  private readonly textMeasureCanvas = document.createElement("canvas");
  private marqueeSelection: { startX: number; startY: number; currentX: number; currentY: number } | null = null;
  private mobileCanvasLongPressTimer: number | null = null;
  private pendingCanvasPanStart: { x: number; y: number; panX: number; panY: number; startedAt: number; startedOnNode: boolean } | null = null;
  private mobileLongPressMarqueeActive = false;
  private lastMobileCanvasTap: { x: number; y: number; time: number } | null = null;
  private mobileTooltipNodeId: string | null = null;
  private dragGhostPositions = new Map<string, { x: number; y: number }>();
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (this.shouldIgnoreMindmapShortcuts(event)) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        void this.redo();
      } else {
        void this.undo();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
      if (this.shouldIgnoreMindmapShortcuts(event)) {
        return;
      }
      event.preventDefault();
      if (this.drawerEl.hasClass("is-hidden")) {
        if (this.selectedNodeId) {
          void this.openDrawer(this.selectedNodeId);
        }
      } else {
        this.closeDrawer();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      if (this.shouldIgnoreMindmapShortcuts(event)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c") {
        if (!this.doc || (!this.selectedNodeId && this.selectedNodeIds.size === 0)) {
          return;
        }
        event.preventDefault();
        this.copySelectedNodeSubtrees();
        return;
      }
      if (key === "x") {
        if (!this.doc || (!this.selectedNodeId && this.selectedNodeIds.size === 0)) {
          return;
        }
        event.preventDefault();
        void this.cutSelectedNodeSubtrees();
        return;
      }
      if (key === "v") {
        if (!this.doc || !this.selectedNodeId) {
          return;
        }
        event.preventDefault();
        this.pasteClipboardSubtreeToNode(this.selectedNodeId);
        return;
      }
    }
    if (event.key === "Escape" && !this.drawerEl.hasClass("is-hidden")) {
      event.preventDefault();
      this.closeDrawer();
      return;
    }
    if (event.key === "Escape" && this.selectedNodeIds.size > 0) {
      event.preventDefault();
      this.setSingleSelectedNode(null);
      this.editingNodeId = null;
      this.renderMindmap();
      return;
    }
    if (this.shouldIgnoreMindmapShortcuts(event)) {
      return;
    }
    if (event.key === "Tab" && (!this.doc || !this.selectedNodeId)) {
      event.preventDefault();
      return;
    }
    if (!this.doc) {
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      const rootIds = this.getSelectedOperationRootIds();
      if (rootIds.length === 0) {
        return;
      }
      event.preventDefault();
      void this.deleteSelectedNodeSubtrees();
      return;
    }
    if (!this.selectedNodeId) {
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      this.createChildNode(this.selectedNodeId);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.createSiblingNode(this.selectedNodeId);
      return;
    }
  };
  private shouldIgnoreMindmapShortcuts(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    if (target.isContentEditable) {
      return true;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return true;
    }
    if (target.closest("input, textarea, [contenteditable='true'], [contenteditable=''], .mindmap-drawer")) {
      return true;
    }
    return false;
  }

  private activateMindmapLeaf(): void {
    this.app.workspace.revealLeaf(this.leaf);
    void this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.focusContainerWithoutScroll();
  }

  private focusContainerWithoutScroll(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  private isDirectLinkOpenGesture(event: MouseEvent | PointerEvent): boolean {
    return (event.metaKey || event.ctrlKey) && event.altKey;
  }

  private cloneDocument(doc: MindmapDocument): MindmapDocument {
    return JSON.parse(JSON.stringify(doc)) as MindmapDocument;
  }

  private cloneNode(node: MindmapNode): MindmapNode {
    return JSON.parse(JSON.stringify(node)) as MindmapNode;
  }

  private getClipboardPayload(): MindmapClipboardPayload | null {
    try {
      const raw = window.localStorage.getItem(MindmapView.MINDMAP_CLIPBOARD_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<MindmapClipboardPayload>;
      if (parsed.version !== 1 || (!parsed.subtree && !parsed.forest?.length)) {
        return null;
      }
      const forest = Array.isArray(parsed.forest)
        ? parsed.forest.map((node) => this.cloneNode(node as MindmapNode))
        : parsed.subtree
          ? [this.cloneNode(parsed.subtree as MindmapNode)]
          : [];
      if (forest.length === 0) {
        return null;
      }
      return {
        version: 1,
        sourcePath: typeof parsed.sourcePath === "string" ? parsed.sourcePath : null,
        subtree: forest[0],
        forest,
        operation: parsed.operation === "cut" ? "cut" : "copy"
      };
    } catch {
      return null;
    }
  }

  private hasClipboardSubtree(): boolean {
    return !!this.getClipboardPayload();
  }

  private writeClipboardPayload(node: MindmapNode, operation: "copy" | "cut"): void {
    this.writeClipboardForest([node], operation);
  }

  private writeClipboardForest(nodes: MindmapNode[], operation: "copy" | "cut"): void {
    const forest = nodes.map((node) => this.cloneNode(node));
    const payload: MindmapClipboardPayload = {
      version: 1,
      sourcePath: this.file?.path ?? null,
      subtree: forest[0],
      forest,
      operation
    };
    window.localStorage.setItem(MindmapView.MINDMAP_CLIPBOARD_STORAGE_KEY, JSON.stringify(payload));
  }

  private getSelectedOperationRootIds(): string[] {
    if (!this.doc) {
      return [];
    }
    const selectedIds = this.selectedNodeIds.size > 0
      ? Array.from(this.selectedNodeIds)
      : this.selectedNodeId
        ? [this.selectedNodeId]
        : [];
    const existingSelectedIds = selectedIds.filter((id) => !!findNodeById(this.doc!, id));
    return existingSelectedIds.filter((id) => {
      const lookup = findParentOfNode(this.doc!, id);
      return !lookup || !existingSelectedIds.includes(lookup.parent.id);
    });
  }

  private copySelectedNodeSubtrees(): void {
    if (!this.doc) {
      return;
    }
    const rootIds = this.getSelectedOperationRootIds();
    if (rootIds.length === 0) {
      return;
    }
    const nodes = rootIds
      .map((id) => findNodeById(this.doc!, id))
      .filter((node): node is MindmapNode => !!node);
    if (nodes.length === 0) {
      return;
    }
    this.writeClipboardForest(nodes, "copy");
    new Notice(nodes.length === 1
      ? `已复制节点「${nodes[0].title}」及其子树`
      : `已复制 ${nodes.length} 个节点子树`);
    this.updateMobileActionButtons();
  }

  private copyNodeSubtree(nodeId: string): void {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    this.writeClipboardPayload(node, "copy");
    new Notice(`已复制节点「${node.title}」及其子树`);
    this.updateMobileActionButtons();
  }

  private reassignSubtreeIds(node: MindmapNode): MindmapNode {
    const cloned = this.cloneNode(node);
    const walk = (current: MindmapNode): void => {
      current.id = crypto.randomUUID();
      current.children.forEach(walk);
    };
    walk(cloned);
    return cloned;
  }

  private pasteSubtreeIntoParent(parent: MindmapNode, subtree: MindmapNode): MindmapNode {
    const inserted = this.reassignSubtreeIds(subtree);
    inserted.x = parent.x + 180;
    inserted.y = parent.y + (parent.children.length + 1) * 56;
    parent.children.push(inserted);
    parent.collapsed = false;
    return inserted;
  }

  private async cutSelectedNodeSubtrees(): Promise<void> {
    if (!this.doc) {
      return;
    }
    const rootIds = this.getSelectedOperationRootIds();
    if (rootIds.length === 0) {
      return;
    }
    if (rootIds.includes(this.doc.root.id)) {
      new Notice("根节点不可剪切");
      return;
    }
    const nodes = rootIds
      .map((id) => findNodeById(this.doc!, id))
      .filter((node): node is MindmapNode => !!node);
    if (nodes.length === 0) {
      return;
    }
    const accepted = window.confirm(nodes.length === 1
      ? `确认剪切节点「${nodes[0].title}」及其全部子孙节点吗？`
      : `确认剪切这 ${nodes.length} 个节点及其全部子孙节点吗？`);
    if (!accepted) {
      return;
    }
    const snapshotBeforeCut = this.cloneDocument(this.doc);
    this.writeClipboardForest(nodes, "cut");
    const affectedParentIds = new Set<string>();
    rootIds.forEach((nodeId) => {
      const parentLookup = findParentOfNode(this.doc!, nodeId);
      if (parentLookup) {
        affectedParentIds.add(parentLookup.parent.id);
      }
      removeNode(this.doc!, nodeId);
    });
    this.pushHistoryState(snapshotBeforeCut);
    const fallbackSelectionId = Array.from(affectedParentIds)[0] ?? this.doc.root.id;
    this.selectedNodeId = fallbackSelectionId;
    this.selectedNodeIds = new Set([fallbackSelectionId]);
    this.editingNodeId = null;
    if (!this.drawerEl.hasClass("is-hidden")) {
      await this.syncOpenDrawerWithSelection();
    }
    this.closeMobileNodeTooltip();
    this.playNodeActionSound("delete");
    this.normalizeLayoutKeepingNodePosition(fallbackSelectionId);
    this.requestSave();
    this.updateMobileActionButtons();
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
    new Notice(nodes.length === 1 ? "已剪切节点，可粘贴到任意导图节点下" : `已剪切 ${nodes.length} 个节点，可粘贴到任意导图节点下`);
  }

  private async cutNodeSubtree(nodeId: string): Promise<void> {
    if (!this.doc) {
      return;
    }
    if (nodeId === this.doc.root.id) {
      new Notice("根节点不可剪切");
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    const parentLookup = findParentOfNode(this.doc, nodeId);
    if (!node || !parentLookup) {
      return;
    }
    const accepted = window.confirm(`确认剪切节点「${node.title}」及其全部子孙节点吗？`);
    if (!accepted) {
      return;
    }
    const snapshotBeforeCut = this.cloneDocument(this.doc);
    this.writeClipboardPayload(node, "cut");
    const result = removeNode(this.doc, nodeId);
    if (!result) {
      new Notice("剪切失败：未找到节点");
      return;
    }
    this.pushHistoryState(snapshotBeforeCut);
    this.selectedNodeId = result.parent.id;
    this.selectedNodeIds = new Set([result.parent.id]);
    this.editingNodeId = null;
    if (!this.drawerEl.hasClass("is-hidden")) {
      await this.syncOpenDrawerWithSelection();
    }
    this.closeMobileNodeTooltip();
    this.playNodeActionSound("delete");
    this.normalizeLayoutKeepingNodePosition(result.parent.id);
    this.requestSave();
    this.updateMobileActionButtons();
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
    new Notice("已剪切节点，可粘贴到任意导图节点下");
  }

  private deleteSelectedNodeSubtrees(): Promise<void> {
    if (!this.doc) {
      return Promise.resolve();
    }
    const rootIds = this.getSelectedOperationRootIds();
    if (rootIds.length === 0) {
      return Promise.resolve();
    }
    if (rootIds.includes(this.doc.root.id)) {
      new Notice("根节点不可删除");
      return Promise.resolve();
    }
    const nodes = rootIds
      .map((id) => findNodeById(this.doc!, id))
      .filter((node): node is MindmapNode => !!node);
    if (nodes.length === 0) {
      return Promise.resolve();
    }
    const accepted = window.confirm(nodes.length === 1
      ? `确认删除节点「${nodes[0].title}」及其全部子孙节点吗？`
      : `确认删除这 ${nodes.length} 个节点及其全部子孙节点吗？`);
    if (!accepted) {
      return Promise.resolve();
    }
    const snapshotBeforeDelete = this.cloneDocument(this.doc);
    const affectedParentIds = new Set<string>();
    rootIds.forEach((nodeId) => {
      const parentLookup = findParentOfNode(this.doc!, nodeId);
      if (parentLookup) {
        affectedParentIds.add(parentLookup.parent.id);
      }
      removeNode(this.doc!, nodeId);
    });
    this.pushHistoryState(snapshotBeforeDelete);
    const fallbackSelectionId = Array.from(affectedParentIds)[0] ?? this.doc.root.id;
    this.selectedNodeId = fallbackSelectionId;
    this.selectedNodeIds = new Set([fallbackSelectionId]);
    this.editingNodeId = null;
    if (!this.drawerEl.hasClass("is-hidden")) {
      return this.syncOpenDrawerWithSelection().then(() => {
        this.closeMobileNodeTooltip();
        this.playNodeActionSound("delete");
        this.normalizeLayoutKeepingNodePosition(fallbackSelectionId);
        this.requestSave();
        this.updateMobileActionButtons();
        this.updateMobileActionClusterVisibility();
        this.renderMindmap();
        new Notice(nodes.length === 1 ? "已删除节点" : `已删除 ${nodes.length} 个节点`);
      });
    }
    this.closeMobileNodeTooltip();
    this.playNodeActionSound("delete");
    this.normalizeLayoutKeepingNodePosition(fallbackSelectionId);
    this.requestSave();
    this.updateMobileActionButtons();
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
    new Notice(nodes.length === 1 ? "已删除节点" : `已删除 ${nodes.length} 个节点`);
    return Promise.resolve();
  }

  private pasteClipboardSubtreeToNode(parentId: string): void {
    if (!this.doc) {
      return;
    }
    const payload = this.getClipboardPayload();
    if (!payload) {
      new Notice("剪贴板里没有可粘贴的节点");
      return;
    }
    const parent = findNodeById(this.doc, parentId);
    if (!parent) {
      new Notice("未找到粘贴目标节点");
      return;
    }
    const snapshotBeforePaste = this.cloneDocument(this.doc);
    const forest = payload.forest?.length ? payload.forest : [payload.subtree];
    const insertedNodes = forest.map((subtree) => this.pasteSubtreeIntoParent(parent, subtree));
    this.pushHistoryState(snapshotBeforePaste);
    const selectedInsertedIds = insertedNodes.map((node) => node.id);
    this.selectedNodeId = selectedInsertedIds[0] ?? null;
    this.selectedNodeIds = new Set(selectedInsertedIds);
    this.closeMobileNodeTooltip();
    this.playNodeActionSound("add");
    this.normalizeLayoutKeepingNodePosition(parent.id);
    this.requestSave();
    this.updateMobileActionButtons();
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
    new Notice(forest.length === 1
      ? `已将${payload.operation === "cut" ? "剪切" : "复制"}内容粘贴到「${parent.title}」下`
      : `已将 ${forest.length} 个${payload.operation === "cut" ? "剪切" : "复制"}节点粘贴到「${parent.title}」下`);
  }

  private captureHistorySnapshot(): void {
    if (!this.doc || this.isApplyingHistory) {
      return;
    }
    this.pushHistoryState(this.doc);
  }

  private pushHistoryState(snapshot: MindmapDocument): void {
    if (this.isApplyingHistory) {
      return;
    }
    this.undoStack.push(this.cloneDocument(snapshot));
    if (this.undoStack.length > 100) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateMobileActionButtons();
  }

  private syncSelectionAfterHistoryApply(): void {
    if (!this.doc) {
      this.selectedNodeId = null;
      this.selectedNodeIds.clear();
      this.editingNodeId = null;
      if (!this.drawerEl.hasClass("is-hidden")) {
        this.closeDrawer();
      }
      return;
    }
    if (!this.selectedNodeId || !findNodeById(this.doc, this.selectedNodeId)) {
      this.selectedNodeId = this.doc.root.id;
    }
    const nextSelectedIds = new Set<string>();
    this.selectedNodeIds.forEach((id) => {
      if (findNodeById(this.doc!, id)) {
        nextSelectedIds.add(id);
      }
    });
    if (nextSelectedIds.size === 0 && this.selectedNodeId) {
      nextSelectedIds.add(this.selectedNodeId);
    }
    this.selectedNodeIds = nextSelectedIds;
    if (this.editingNodeId && !findNodeById(this.doc, this.editingNodeId)) {
      this.editingNodeId = null;
    }
  }

  private async applyHistoryState(nextDoc: MindmapDocument): Promise<void> {
    this.doc = normalizeMindmapDocument(this.cloneDocument(nextDoc));
    this.normalizeLayout();
    this.refreshTabTitle();
    this.syncSelectionAfterHistoryApply();
    this.noteHistoryCapturedForSession = false;
    this.linkHistoryCapturedForSession = false;
    await this.syncOpenDrawerWithSelection();
    this.requestSave();
    this.renderMindmap();
    this.updateMobileActionButtons();
  }

  private async undo(): Promise<void> {
    if (!this.doc || this.undoStack.length === 0) {
      return;
    }
    const previous = this.undoStack.pop();
    if (!previous) {
      return;
    }
    this.isApplyingHistory = true;
    try {
      this.redoStack.push(this.cloneDocument(this.doc));
      await this.applyHistoryState(previous);
    } finally {
      this.isApplyingHistory = false;
    }
  }

  private async redo(): Promise<void> {
    if (!this.doc || this.redoStack.length === 0) {
      return;
    }
    const next = this.redoStack.pop();
    if (!next) {
      return;
    }
    this.isApplyingHistory = true;
    try {
      this.undoStack.push(this.cloneDocument(this.doc));
      await this.applyHistoryState(next);
    } finally {
      this.isApplyingHistory = false;
    }
  }

  private closeMobileNodeTooltip(): void {
    this.mobileTooltipNodeId = null;
    this.mobileNodeTooltipEl?.addClass("is-hidden");
    this.mobileActionClusterEl?.addClass("is-hidden");
  }

  private openMobileNodeTooltip(nodeId: string): void {
    if (!this.isMobileLayout || !this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    const point = this.getCanvasClientPoint(node.x, node.y);
    const canvasRect = this.canvasEl.getBoundingClientRect();
    const viewportPadding = 12;
    const arrowGap = 10;

    this.mobileTooltipNodeId = nodeId;
    this.mobileActionClusterEl?.removeClass("is-hidden");
    this.mobileNodeTooltipEl?.removeClass("is-hidden");
    this.mobileNodeTooltipEl?.removeClass("is-below");
    this.mobileNodeTooltipEl?.style.removeProperty("visibility");
    this.mobileNodeTooltipEl?.style.removeProperty("--mindmap-tooltip-arrow-left");
    this.mobileNodeTooltipEl.style.visibility = "hidden";
    this.mobileNodeTooltipEl.style.left = "0px";
    this.mobileNodeTooltipEl.style.top = "0px";

    const tooltipWidth = this.mobileNodeTooltipEl.offsetWidth || 160;
    const tooltipHeight = this.mobileNodeTooltipEl.offsetHeight || 60;
    const minCenterX = viewportPadding + tooltipWidth / 2;
    const maxCenterX = Math.max(minCenterX, canvasRect.width - viewportPadding - tooltipWidth / 2);
    const clampedCenterX = Math.min(Math.max(point.x, minCenterX), maxCenterX);
    const arrowLeft = Math.min(
      Math.max(point.x - clampedCenterX + tooltipWidth / 2, 18),
      tooltipWidth - 18
    );

    const preferredTop = point.y - arrowGap;
    const topSpace = preferredTop - tooltipHeight;
    const shouldPlaceBelow = topSpace < viewportPadding && point.y + arrowGap + tooltipHeight <= canvasRect.height - viewportPadding;
    const tooltipTop = shouldPlaceBelow
      ? Math.min(canvasRect.height - viewportPadding - tooltipHeight, point.y + arrowGap)
      : Math.max(viewportPadding, preferredTop);

    this.mobileNodeTooltipEl.style.left = `${clampedCenterX}px`;
    this.mobileNodeTooltipEl.style.top = `${tooltipTop}px`;
    this.mobileNodeTooltipEl.style.setProperty("--mindmap-tooltip-arrow-left", `${arrowLeft}px`);
    this.mobileNodeTooltipEl.toggleClass("is-below", shouldPlaceBelow);
    this.mobileNodeTooltipEl.style.visibility = "";
    this.updateMobileActionButtons();
  }

  private toggleMobileNodeTooltip(nodeId: string): void {
    if (this.mobileTooltipNodeId === nodeId && !this.mobileNodeTooltipEl?.hasClass("is-hidden")) {
      this.closeMobileNodeTooltip();
      return;
    }
    this.openMobileNodeTooltip(nodeId);
  }

  private shouldOpenMobileNodeTooltip(nodeId: string, now: number): boolean {
    return !!this.lastMobileNodeTap
      && this.lastMobileNodeTap.nodeId === nodeId
      && now - this.lastMobileNodeTap.time >= MindmapView.MOBILE_NODE_TOOLTIP_REOPEN_DELAY;
  }

  private handleMobileUndoButtonClick(): void {
    void this.undo();
  }

  private clearMobileCanvasLongPressTimer(): void {
    if (this.mobileCanvasLongPressTimer !== null) {
      window.clearTimeout(this.mobileCanvasLongPressTimer);
      this.mobileCanvasLongPressTimer = null;
    }
  }

  private beginSelectionMarquee(startX: number, startY: number): void {
    this.marqueeSelection = {
      startX,
      startY,
      currentX: startX,
      currentY: startY
    };
    this.mobileLongPressMarqueeActive = true;
    this.pendingCanvasPanStart = null;
    this.selectedNodeId = null;
    this.selectedNodeIds.clear();
    this.editingNodeId = null;
    this.renderMindmap();
    navigator.vibrate?.(10);
  }

  private finishSelectionMarquee(): void {
    if (!this.doc || !this.marqueeSelection) {
      this.mobileLongPressMarqueeActive = false;
      return;
    }
    const selectedIds = this.getNodesInMarquee(this.marqueeSelection);
    this.selectedNodeIds = selectedIds;
    this.selectedNodeId = Array.from(selectedIds)[0] ?? null;
    this.marqueeSelection = null;
    this.mobileLongPressMarqueeActive = false;
    this.renderMindmap();
  }

  private readonly onContainerZenTouchStart = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        ".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox"
      )
    ) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onContainerZenTouchMove = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        ".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox"
      )
    ) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onContainerZenTouchEnd = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        ".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox"
      )
    ) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private setZenMode(enabled: boolean): void {
    this.isZenMode = enabled;
    this.blockEdgeSidebarGesture = enabled;
    document.body.toggleClass("mindmap-mobile-gesture-lock", enabled && this.isMobileLayout);
    document.documentElement.toggleClass("mindmap-mobile-gesture-lock", enabled && this.isMobileLayout);
    document.body.toggleClass("mindmap-mobile-chrome-hidden", enabled && this.isMobileLayout);
    document.documentElement.toggleClass("mindmap-mobile-chrome-hidden", enabled && this.isMobileLayout);
    this.containerEl.toggleClass("is-zen-mode", enabled);
    this.layoutEl?.toggleClass("is-zen-mode", enabled);
    this.canvasEl?.toggleClass("is-zen-mode", enabled);
    this.mobileActionClusterEl?.toggleClass("is-zen-mode", enabled);
    if (this.mobileZenButtonEl) {
      this.mobileZenButtonEl.toggleClass("is-active", enabled);
      this.mobileZenButtonEl.setText(enabled ? "解锁" : "锁住");
      this.mobileZenButtonEl.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
    if (!enabled) {
      this.blockEdgeSidebarGesture = false;
      this.touchPanStart = null;
      this.pinchStartDistance = null;
    }
  }

  private unlockMobileZenWhenViewportChanges(): void {
    if (!this.isMobileLayout || !this.isZenMode) {
      return;
    }
    const activeView = this.app.workspace.getActiveViewOfType(ItemView);
    if (activeView !== this) {
      this.setZenMode(false);
    }
  }

  private readonly onWindowTouchStart = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".mindmap-canvas")) {
      event.stopPropagation();
      this.onTouchStart(event, true);
      return;
    }
    if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onWindowTouchMove = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".mindmap-canvas")) {
      event.stopPropagation();
      this.onTouchMove(event, true);
      return;
    }
    if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onWindowTouchEnd = (event: TouchEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".mindmap-canvas")) {
      event.stopPropagation();
      this.onTouchEnd(event, true);
      return;
    }
    if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-mobile-global-action-cluster, .mindmap-mobile-node-tooltip, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private readonly onWindowWheel = (event: WheelEvent): void => {
    if (!this.isZenMode || !this.isMobileLayout) {
      return;
    }
    if (this.shouldAllowZenGestureTarget(event.target)) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
  };

  private handleZenCanvasTouchStart(event: TouchEvent): void {
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (first && second) {
      this.clearMobileCanvasLongPressTimer();
      this.touchPanStart = null;
      this.pendingCanvasPanStart = null;
      this.blockEdgeSidebarGesture = false;
      this.zenTapCandidate = null;
      this.pinchStartDistance = this.getTouchDistance(first, second);
      this.pinchStartScale = this.zoomScale;
      return;
    }

    if (!first) {
      this.clearMobileCanvasLongPressTimer();
      this.pinchStartDistance = null;
      this.zenTapCandidate = null;
      return;
    }

    const target = event.target;
    if (target instanceof Element) {
      const isInteractiveControl = !!target.closest(".mindmap-jump-group, .mindmap-mobile-action-cluster, .mindmap-drawer");
      if (isInteractiveControl) {
        this.clearMobileCanvasLongPressTimer();
        this.touchPanStart = null;
        this.pendingCanvasPanStart = null;
        this.zenTapCandidate = null;
        return;
      }
      const collapseGroup = target.closest(".mindmap-collapse-group");
      if (collapseGroup) {
        this.clearMobileCanvasLongPressTimer();
        const nodeGroup = collapseGroup.closest<SVGGElement>(".mindmap-node-group");
        const nodeId = nodeGroup?.dataset.id ?? null;
        this.touchPanStart = null;
        this.pendingCanvasPanStart = null;
        this.pinchStartDistance = null;
        this.zenTapCandidate = {
          nodeId,
          isCollapseToggle: true,
          x: first.clientX,
          y: first.clientY,
          time: Date.now()
        };
        return;
      }
      const nodeGroup = target.closest<SVGGElement>(".mindmap-node-group");
      if (nodeGroup) {
        this.clearMobileCanvasLongPressTimer();
        const nodeId = nodeGroup.dataset.id ?? null;
        this.touchPanStart = null;
        this.pendingCanvasPanStart = {
          x: first.clientX,
          y: first.clientY,
          panX: this.panOffset.x,
          panY: this.panOffset.y,
          startedAt: Date.now(),
          startedOnNode: true
        };
        this.pinchStartDistance = null;
        this.zenTapCandidate = {
          nodeId,
          isCollapseToggle: false,
          x: first.clientX,
          y: first.clientY,
          time: Date.now()
        };
        return;
      }
    }

    this.blockEdgeSidebarGesture = true;
    this.pinchStartDistance = null;
    this.zenTapCandidate = null;
    this.pendingCanvasPanStart = {
      x: first.clientX,
      y: first.clientY,
      panX: this.panOffset.x,
      panY: this.panOffset.y,
      startedAt: Date.now(),
      startedOnNode: false
    };
    const startPoint = this.getDocumentPoint(first.clientX, first.clientY);
    this.clearMobileCanvasLongPressTimer();
    this.mobileCanvasLongPressTimer = window.setTimeout(() => {
      this.mobileCanvasLongPressTimer = null;
      this.beginSelectionMarquee(startPoint.x, startPoint.y);
    }, 360);
  };

  private handleZenCanvasTouchMove(event: TouchEvent): void {
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (first && second && this.pinchStartDistance !== null) {
      this.clearMobileCanvasLongPressTimer();
      this.zenTapCandidate = null;
      const nextDistance = this.getTouchDistance(first, second);
      if (nextDistance <= 0) {
        return;
      }
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      const nextScale = Math.min(
        MindmapView.MAX_ZOOM_SCALE,
        Math.max(MindmapView.MIN_ZOOM_SCALE, this.pinchStartScale * (nextDistance / this.pinchStartDistance))
      );
      this.setZoomAt(centerX, centerY, nextScale);
      return;
    }

    if (first && this.zenTapCandidate) {
      const moveDistance = Math.hypot(first.clientX - this.zenTapCandidate.x, first.clientY - this.zenTapCandidate.y);
      if (moveDistance > 10) {
        this.zenTapCandidate = null;
      }
    }

    if (this.mobileLongPressMarqueeActive && first && this.marqueeSelection) {
      const point = this.getDocumentPoint(first.clientX, first.clientY);
      this.marqueeSelection = {
        startX: this.marqueeSelection.startX,
        startY: this.marqueeSelection.startY,
        currentX: point.x,
        currentY: point.y
      };
      this.renderMindmap();
      return;
    }

    if (!first) {
      return;
    }

    if (this.pendingCanvasPanStart) {
      const distance = Math.hypot(first.clientX - this.pendingCanvasPanStart.x, first.clientY - this.pendingCanvasPanStart.y);
      if (distance > 10) {
        this.clearMobileCanvasLongPressTimer();
        this.touchPanStart = this.pendingCanvasPanStart;
        this.pendingCanvasPanStart = null;
        this.lastMobileCanvasTap = null;
      }
    }

    if (!this.touchPanStart) {
      return;
    }

    this.panOffset.x = this.touchPanStart.panX + (first.clientX - this.touchPanStart.x);
    this.panOffset.y = this.touchPanStart.panY + (first.clientY - this.touchPanStart.y);
    this.renderMindmap();
  }

  private handleZenCanvasTouchEnd(event: TouchEvent): void {
    const remainingTouches = event.touches.length;
    if (remainingTouches >= 2) {
      const first = event.touches.item(0);
      const second = event.touches.item(1);
      if (first && second) {
        this.pinchStartDistance = this.getTouchDistance(first, second);
        this.pinchStartScale = this.zoomScale;
      }
      this.zenTapCandidate = null;
      return;
    }
    if (remainingTouches === 1) {
      const first = event.touches.item(0);
      if (first) {
        this.pinchStartDistance = null;
        this.zenTapCandidate = null;
        this.touchPanStart = {
          x: first.clientX,
          y: first.clientY,
          panX: this.panOffset.x,
          panY: this.panOffset.y
        };
      }
      return;
    }

    const hadPendingCanvasTap = !!this.pendingCanvasPanStart;
    const hadActivePan = !!this.touchPanStart;
    const tapCandidate = this.zenTapCandidate;
    this.zenTapCandidate = null;
    this.pinchStartDistance = null;
    this.touchPanStart = null;
    this.pendingCanvasPanStart = null;
    this.blockEdgeSidebarGesture = true;

    this.clearMobileCanvasLongPressTimer();
    if (this.mobileLongPressMarqueeActive) {
      this.finishSelectionMarquee();
      this.lastMobileCanvasTap = null;
      return;
    }

    if (tapCandidate?.nodeId && this.doc) {
      const node = findNodeById(this.doc, tapCandidate.nodeId);
      if (!node) {
        return;
      }

      if (tapCandidate.isCollapseToggle) {
        node.collapsed = !node.collapsed;
        this.normalizeLayout();
        this.requestSave();
        this.renderMindmap();
        return;
      }

      const now = Date.now();
      if (this.lastZenNodeTap && this.lastZenNodeTap.nodeId === node.id && now - this.lastZenNodeTap.time <= 320) {
        this.lastZenNodeTap = null;
        this.selectedNodeId = node.id;
        this.startInlineNodeEdit(node.id);
        return;
      }

      this.lastZenNodeTap = { nodeId: node.id, time: now };
      this.setSingleSelectedNode(node.id);
      this.focusContainerWithoutScroll();
      this.renderMindmap();
      return;
    }

    if (!hadActivePan && hadPendingCanvasTap && event.changedTouches.length === 1) {
      const touch = event.changedTouches.item(0);
      if (touch) {
        this.handleMobileCanvasDoubleTap(touch.clientX, touch.clientY);
      }
      return;
    }

    if (hadActivePan) {
      this.lastMobileCanvasTap = null;
    }
  }

  private shouldAllowZenGestureTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    return !!target.closest(".mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input");
  }

  private readonly onWheelPan = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.zoomAt(event.clientX, event.clientY, -event.deltaY * 0.0015);
      this.updateViewportTransform();
      return;
    }
    this.panOffset.x -= event.deltaX;
    this.panOffset.y -= event.deltaY;
    this.updateViewportTransform();
  };

  private readonly onTouchStart = (event: TouchEvent, allowInZenMode = false): void => {
    if (this.isZenMode && this.isMobileLayout && !allowInZenMode) {
      return;
    }
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (first && second) {
      this.clearMobileCanvasLongPressTimer();
      event.preventDefault();
      this.touchPanStart = null;
      this.pendingCanvasPanStart = null;
      this.blockEdgeSidebarGesture = false;
      this.pinchStartDistance = this.getTouchDistance(first, second);
      this.pinchStartScale = this.zoomScale;
      return;
    }

    if (!first || !this.isMobileLayout) {
      this.clearMobileCanvasLongPressTimer();
      this.pinchStartDistance = null;
      this.blockEdgeSidebarGesture = false;
      return;
    }

    this.blockEdgeSidebarGesture = this.isZenMode;

    const target = event.target;
    const startedOnNode = target instanceof Element && !!target.closest(".mindmap-node-group");
    if (target instanceof Element) {
      const isInteractiveControl = !!target.closest(".mindmap-collapse-group, .mindmap-jump-group, .mindmap-mobile-action-cluster, .mindmap-drawer");
      if (isInteractiveControl) {
        this.clearMobileCanvasLongPressTimer();
        this.touchPanStart = null;
        this.pendingCanvasPanStart = null;
        return;
      }
      if (target.closest(".mindmap-resize-handle")) {
        this.clearMobileCanvasLongPressTimer();
        this.touchPanStart = null;
        this.pendingCanvasPanStart = null;
        this.pinchStartDistance = null;
        if (!this.isZenMode) {
          event.preventDefault();
        }
        return;
      }
    }

    event.preventDefault();
    this.pinchStartDistance = null;
    this.pendingCanvasPanStart = {
      x: first.clientX,
      y: first.clientY,
      panX: this.panOffset.x,
      panY: this.panOffset.y,
      startedAt: Date.now(),
      startedOnNode
    };
    if (startedOnNode) {
      this.clearMobileCanvasLongPressTimer();
      return;
    }
    const startPoint = this.getDocumentPoint(first.clientX, first.clientY);
    this.clearMobileCanvasLongPressTimer();
    this.mobileCanvasLongPressTimer = window.setTimeout(() => {
      this.mobileCanvasLongPressTimer = null;
      this.beginSelectionMarquee(startPoint.x, startPoint.y);
    }, 360);
  };

  private handleMobileCanvasDoubleTap(clientX: number, clientY: number): boolean {
    if (!this.doc) {
      return false;
    }
    const lastTap = this.lastMobileCanvasTap;
    const now = Date.now();
    if (lastTap && now - lastTap.time <= 320 && Math.hypot(clientX - lastTap.x, clientY - lastTap.y) <= 18) {
      this.lastMobileCanvasTap = null;
      this.centerViewportOnRoot(this.doc.root, visibleNodes(this.doc.root));
      this.updateViewportTransform();
      return true;
    }
    this.lastMobileCanvasTap = { x: clientX, y: clientY, time: now };
    return false;
  }

  private readonly onTouchMove = (event: TouchEvent, allowInZenMode = false): void => {
    if (this.isZenMode && this.isMobileLayout && !allowInZenMode) {
      return;
    }
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (first && second && this.pinchStartDistance !== null) {
      this.clearMobileCanvasLongPressTimer();
      event.preventDefault();
      const nextDistance = this.getTouchDistance(first, second);
      if (nextDistance <= 0) {
        return;
      }
      const centerX = (first.clientX + second.clientX) / 2;
      const centerY = (first.clientY + second.clientY) / 2;
      const nextScale = Math.min(
        MindmapView.MAX_ZOOM_SCALE,
        Math.max(MindmapView.MIN_ZOOM_SCALE, this.pinchStartScale * (nextDistance / this.pinchStartDistance))
      );
      this.setZoomAt(centerX, centerY, nextScale);
      this.updateViewportTransform();
      return;
    }

    if (this.blockEdgeSidebarGesture) {
      event.preventDefault();
    }

    if (this.mobileLongPressMarqueeActive && first && this.marqueeSelection) {
      event.preventDefault();
      const point = this.getDocumentPoint(first.clientX, first.clientY);
      this.marqueeSelection = {
        startX: this.marqueeSelection.startX,
        startY: this.marqueeSelection.startY,
        currentX: point.x,
        currentY: point.y
      };
      this.updateMarqueeOverlay();
      return;
    }

    if (!first) {
      return;
    }

    if (this.pendingCanvasPanStart) {
      const distance = Math.hypot(first.clientX - this.pendingCanvasPanStart.x, first.clientY - this.pendingCanvasPanStart.y);
      if (distance > 10) {
        const shouldPreferNodeDrag = this.pendingCanvasPanStart.startedOnNode
          && Date.now() - this.pendingCanvasPanStart.startedAt >= MindmapView.MOBILE_NODE_DRAG_LONG_PRESS_DELAY;
        this.clearMobileCanvasLongPressTimer();
        if (shouldPreferNodeDrag) {
          this.pendingCanvasPanStart = null;
          return;
        }
        this.touchPanStart = this.pendingCanvasPanStart;
        this.pendingCanvasPanStart = null;
      }
    }

    if (!this.touchPanStart) {
      return;
    }

    event.preventDefault();
    this.panOffset.x = this.touchPanStart.panX + (first.clientX - this.touchPanStart.x);
    this.panOffset.y = this.touchPanStart.panY + (first.clientY - this.touchPanStart.y);
    this.updateViewportTransform();
  };

  private readonly onTouchEnd = (event: TouchEvent, allowInZenMode = false): void => {
    if (this.isZenMode && this.isMobileLayout && !allowInZenMode) {
      return;
    }
    const hadPendingCanvasTap = !!this.pendingCanvasPanStart;
    const pendingCanvasStartedOnNode = this.pendingCanvasPanStart?.startedOnNode ?? false;
    const hadActivePan = !!this.touchPanStart;
    this.clearMobileCanvasLongPressTimer();
    if (this.mobileLongPressMarqueeActive) {
      this.finishSelectionMarquee();
      this.lastMobileCanvasTap = null;
    } else if (this.isMobileLayout && event.changedTouches.length === 1 && !hadActivePan && hadPendingCanvasTap && !pendingCanvasStartedOnNode) {
      const touch = event.changedTouches.item(0);
      if (touch) {
        const centered = this.handleMobileCanvasDoubleTap(touch.clientX, touch.clientY);
        if (centered) {
          event.preventDefault();
        } else {
          this.clearCanvasSelection();
        }
      }
    } else if (hadActivePan) {
      this.lastMobileCanvasTap = null;
    }
    this.pinchStartDistance = null;
    this.touchPanStart = null;
    this.pendingCanvasPanStart = null;
    this.blockEdgeSidebarGesture = this.isZenMode;
  };

  private readonly onCanvasPointerDown = (event: PointerEvent): void => {
    if (this.isMobileLayout) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(".mindmap-node-group, .mindmap-collapse-group, .mindmap-jump-group, .mindmap-drawer, .mindmap-mobile-action-cluster, .mindmap-desktop-action-cluster")) {
      return;
    }
    if (this.pendingNodeSelectionTimer) {
      window.clearTimeout(this.pendingNodeSelectionTimer);
      this.pendingNodeSelectionTimer = null;
    }

    const startPoint = this.getDocumentPoint(event.clientX, event.clientY);
    const startClient = { x: event.clientX, y: event.clientY };
    let marqueeStarted = false;

    const clearSelection = (): void => {
      this.clearCanvasSelection();
    };

    const finishMarquee = (): void => {
      if (!this.doc || !this.marqueeSelection) {
        return;
      }
      const selectedIds = this.getNodesInMarquee(this.marqueeSelection);
      this.selectedNodeIds = selectedIds;
      this.selectedNodeId = selectedIds.size === 1 ? Array.from(selectedIds)[0] ?? null : null;
      this.editingNodeId = null;
      this.renderMindmap();
    };

    const onMove = (moveEvent: PointerEvent): void => {
      const distance = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
      if (!marqueeStarted) {
        if (distance < 6) {
          return;
        }
        marqueeStarted = true;
        clearSelection();
        this.marqueeSelection = {
          startX: startPoint.x,
          startY: startPoint.y,
          currentX: this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY).x,
          currentY: this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY).y
        };
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const point = this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY);
      this.marqueeSelection = {
        startX: startPoint.x,
        startY: startPoint.y,
        currentX: point.x,
        currentY: point.y
      };
      this.renderMindmap();
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!marqueeStarted) {
        clearSelection();
        return;
      }
      finishMarquee();
      this.marqueeSelection = null;
      this.renderMindmap();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  private readonly onCanvasDoubleClick = (event: MouseEvent): void => {
    if (!this.doc) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(".mindmap-node-group, .mindmap-collapse-group, .mindmap-jump-group, .mindmap-drawer, .mindmap-mobile-action-cluster")) {
      return;
    }
    event.preventDefault();
    this.centerViewportOnRoot(this.doc.root, visibleNodes(this.doc.root));
    this.renderMindmap();
  };

  getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (!this.file && !this.doc) {
      return "Mindmap";
    }
    const mindmapTitle = this.doc?.root.title.trim();
    return mindmapTitle && mindmapTitle.length > 0
      ? mindmapTitle
      : this.file?.basename ?? "Mindmap";
  }

  private refreshTabTitle(): void {
    const leaf = this.leaf as typeof this.leaf & { updateHeader?: () => void };
    leaf.updateHeader?.();
  }

  getIcon(): string {
    return "network";
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("mindmap-root-view");
    this.containerEl.toggleClass("is-mobile", this.isMobileLayout);
    this.containerEl.tabIndex = 0;
    this.containerEl.addEventListener("keydown", this.onKeydown);
    if (this.isMobileLayout) {
      this.containerEl.addEventListener("pointerdown", this.activateMindmapLeaf);
      this.containerEl.addEventListener("touchstart", this.activateMindmapLeaf, { passive: true });
      this.containerEl.addEventListener("touchstart", this.onContainerZenTouchStart, { passive: false, capture: true });
      this.containerEl.addEventListener("touchmove", this.onContainerZenTouchMove, { passive: false, capture: true });
      this.containerEl.addEventListener("touchend", this.onContainerZenTouchEnd, { passive: false, capture: true });
      this.containerEl.addEventListener("touchcancel", this.onContainerZenTouchEnd, { passive: false, capture: true });
      window.addEventListener("touchstart", this.onWindowTouchStart, { passive: false, capture: true });
      window.addEventListener("touchmove", this.onWindowTouchMove, { passive: false, capture: true });
      window.addEventListener("touchend", this.onWindowTouchEnd, { passive: false, capture: true });
      window.addEventListener("touchcancel", this.onWindowTouchEnd, { passive: false, capture: true });
      window.addEventListener("wheel", this.onWindowWheel, { passive: false, capture: true });
      document.addEventListener("touchstart", this.onWindowTouchStart, { passive: false, capture: true });
      document.addEventListener("touchmove", this.onWindowTouchMove, { passive: false, capture: true });
      document.addEventListener("touchend", this.onWindowTouchEnd, { passive: false, capture: true });
      document.addEventListener("touchcancel", this.onWindowTouchEnd, { passive: false, capture: true });
    }
    window.setTimeout(() => this.focusContainerWithoutScroll(), 0);

    this.layoutEl = this.containerEl.createDiv({ cls: "mindmap-layout" });
    this.updateDrawerWidth();
    this.canvasEl = this.layoutEl.createDiv({ cls: "mindmap-canvas" });
    this.marqueeEl = this.canvasEl.createDiv({ cls: "mindmap-selection-marquee is-hidden" });
    this.desktopActionClusterEl = this.containerEl.createDiv({ cls: "mindmap-desktop-action-cluster" });
    // this.desktopSyncButtonEl = this.desktopActionClusterEl.createEl("button", { cls: "mindmap-desktop-sync-button", text: "同步" });
    // this.desktopSyncButtonEl.type = "button";
    // this.desktopSyncButtonEl.addEventListener("click", () => {
    //   void this.syncNow();
    // });
    // this.desktopRefreshButtonEl = this.desktopActionClusterEl.createEl("button", { cls: "mindmap-desktop-refresh-button", text: "刷新" });
    // this.desktopRefreshButtonEl.type = "button";
    // this.desktopRefreshButtonEl.addEventListener("click", () => {
    //   void this.reloadFromDisk(true);
    // });
    this.mobileActionClusterEl = this.containerEl.createDiv({ cls: "mindmap-mobile-action-cluster" });
    this.mobileActionClusterEl.addClass("is-hidden");
    this.mobileNodeTooltipEl = this.containerEl.createDiv({ cls: "mindmap-mobile-node-tooltip is-hidden" });
    this.mobileNodeTooltipEl.appendChild(this.mobileActionClusterEl);
    this.mobileGlobalActionClusterEl = this.containerEl.createDiv({ cls: "mindmap-mobile-global-action-cluster" });
    const mobileActionClusterEl = this.mobileActionClusterEl;
    const mobileGlobalActionClusterEl = this.mobileGlobalActionClusterEl;
    // 增加“新增节点”按钮
    this.mobileAddButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-add-button", text: "子+" });
    this.mobileAddButtonEl.type = "button";
    this.mobileAddButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      const targetId = this.selectedNodeId ?? this.doc?.root.id;
      if (targetId) {
        this.createChildNode(targetId);
      }
    });

    this.mobileSiblingAddButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-sibling-add-button", text: "同+" });
    this.mobileSiblingAddButtonEl.type = "button";
    this.mobileSiblingAddButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      const targetId = this.selectedNodeId ?? this.doc?.root.id;
      if (targetId) {
        this.createSiblingNode(targetId);
      }
    });

    this.mobileUndoButtonEl = mobileGlobalActionClusterEl.createEl("button", { cls: "mindmap-mobile-undo-button", text: "撤回" });
    this.mobileUndoButtonEl.type = "button";
    this.mobileUndoButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      void this.undo();
    });
    this.mobileRedoButtonEl = mobileGlobalActionClusterEl.createEl("button", { cls: "mindmap-mobile-redo-button", text: "重做" });
    this.mobileRedoButtonEl.type = "button";
    this.mobileRedoButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      void this.redo();
    });

    // 增加“删除节点”按钮
    this.mobileDeleteButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-delete-button", text: "-" });
    this.mobileDeleteButtonEl.type = "button";
    this.mobileDeleteButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      if (this.selectedNodeId && this.doc && this.selectedNodeId !== this.doc.root.id) {
        void this.deleteNodeById(this.selectedNodeId);
      }
    });
    this.mobileLinkButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-link-button", text: "跳转" });
    this.mobileLinkButtonEl.type = "button";
    this.mobileLinkButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      if (!this.doc || !this.selectedNodeId) {
        return;
      }
      const node = findNodeById(this.doc, this.selectedNodeId);
      if (!node?.linkTarget?.trim()) {
        return;
      }
      this.unlockMobileZenIfNeeded();
      void this.openLinkedTarget(node.linkTarget);
    });
    // this.mobileSyncButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-sync-button", text: "同步" });
    // this.mobileSyncButtonEl.type = "button";
    // this.mobileSyncButtonEl.addEventListener("click", () => {
    //   void this.syncNow();
    // });
    // this.mobileRefreshButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-refresh-button", text: "刷新" });
    // this.mobileRefreshButtonEl.type = "button";
    // this.mobileRefreshButtonEl.addEventListener("click", () => {
    //   void this.reloadFromDisk(true);
    // });
    this.mobileNoteButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-note-button", text: "笔记" });
    this.mobileNoteButtonEl.type = "button";
    this.mobileNoteButtonEl.addEventListener("click", () => {
      this.closeMobileNodeTooltip();
      if (this.selectedNodeId) {
        void this.openDrawer(this.selectedNodeId);
      }
    });
    this.mobileZenButtonEl = mobileGlobalActionClusterEl.createEl("button", { cls: "mindmap-mobile-zen-button", text: "锁住" });
    this.mobileZenButtonEl.type = "button";
    this.mobileZenButtonEl.addEventListener("click", () => {
      this.setZenMode(!this.isZenMode);
    });
    this.updateMobileActionButtons();
    this.drawerResizeHandleEl = this.layoutEl.createDiv({ cls: "mindmap-drawer-resize-handle" });
    this.drawerResizeHandleEl.addEventListener("pointerdown", (event) => this.startDrawerResize(event));
    this.drawerEl = this.layoutEl.createDiv({ cls: "mindmap-drawer is-hidden" });
    this.drawerHeaderEl = this.drawerEl.createDiv({ cls: "mindmap-drawer-header" });
    const drawerHeaderMetaEl = this.drawerHeaderEl.createDiv({ cls: "mindmap-drawer-header-meta" });
    this.drawerTitleEl = drawerHeaderMetaEl.createEl("h3", { text: "节点笔记" });
    const drawerHeaderPathEl = drawerHeaderMetaEl.createDiv({ cls: "mindmap-drawer-header-path" });
    drawerHeaderPathEl.setText(this.file?.path ?? "");
    const drawerHeaderActionsEl = this.drawerHeaderEl.createDiv({ cls: "mindmap-drawer-header-actions" });
    // const backButtonEl = drawerHeaderActionsEl.createEl("button", {
    //   cls: "mindmap-drawer-back",
    //   text: "返回"
    // });
    // backButtonEl.type = "button";
    // backButtonEl.addEventListener("click", () => {
    //   void this.goBackFromLinkedTarget();
    // });
    this.noteModeToggleEl = drawerHeaderActionsEl.createEl("button", {
      cls: "mindmap-note-mode-toggle",
      text: "编辑"
    });
    this.noteModeToggleEl.type = "button";
    this.noteModeToggleEl.addEventListener("click", () => {
      const editing = !this.noteSurfaceEl.hasClass("is-editing");
      this.setNoteEditing(editing);
    });
    this.drawerCloseEl = drawerHeaderActionsEl.createEl("button", {
      cls: "mindmap-drawer-close",
      text: "关闭"
    });
    this.drawerCloseEl.type = "button";
    this.drawerCloseEl.addEventListener("click", () => {
      this.closeDrawer();
    });
    // this.nodeTitleInputEl = this.drawerEl.createEl("input", {
    //   cls: "mindmap-node-title-input",
    //   type: "text"
    // });
    // this.nodeTitleInputEl.placeholder = "节点标题";
    // this.nodeTitleInputEl.addEventListener("input", () => {
    //   if (!this.doc || !this.selectedNodeId) {
    //     return;
    //   }
    //   const node = findNodeById(this.doc, this.selectedNodeId);
    //   if (!node) {
    //     return;
    //   }
    //   const nextTitle = this.nodeTitleInputEl.value.trim();
    //   node.title = nextTitle.length > 0 ? nextTitle : "未命名节点";
    //   this.drawerTitleEl.setText(`${node.title}`);
    //   if (node.id === this.doc.root.id) {
    //     this.refreshTabTitle();
    //   }
    //   this.normalizeLayoutKeepingNodePosition(node.id);
    //   this.requestSave();
    //   this.renderMindmap();
    // });
    const nodeLinkActionsEl = this.drawerEl.createDiv({ cls: "mindmap-node-link-actions" });
    this.nodeLinkInputEl = nodeLinkActionsEl.createEl("input", {
      cls: "mindmap-node-link-input",
      type: "text"
    });
    this.nodeLinkInputEl.placeholder = "输入链接目标：导图或笔记路径";
    this.nodeLinkActionButtonEl = nodeLinkActionsEl.createEl("button", {
      cls: "mindmap-node-link-action-button is-disabled",
      text: "跳转"
    });
    this.nodeLinkActionButtonEl.type = "button";
    this.nodeLinkActionButtonEl.disabled = true;
    this.nodeLinkActionButtonEl.addEventListener("click", () => {
      if (!this.doc || !this.selectedNodeId) {
        return;
      }
      const node = findNodeById(this.doc, this.selectedNodeId);
      if (!node?.linkTarget?.trim()) {
        return;
      }
      this.unlockMobileZenIfNeeded();
      void this.openLinkedTarget(node.linkTarget);
    });
    this.nodeLinkInputEl.addEventListener("input", () => {
      if (!this.doc || !this.selectedNodeId || this.selectedNodeId === this.doc.root.id) {
        return;
      }
      const node = findNodeById(this.doc, this.selectedNodeId);
      if (!node) {
        return;
      }
      if (!this.linkHistoryCapturedForSession) {
        this.captureHistorySnapshot();
        this.linkHistoryCapturedForSession = true;
      }
      node.linkTarget = this.nodeLinkInputEl.value.trim();
      this.updateNodeLinkActionButton(node.linkTarget ?? "");
      this.requestSave();
      this.renderMindmap();
    });
    this.noteSurfaceEl = this.drawerEl.createDiv({ cls: "mindmap-note-surface" });
    this.noteInputEl = this.noteSurfaceEl.createEl("textarea", {
      cls: "mindmap-note-input"
    });
    this.noteInputEl.placeholder = "使用 Markdown 记录节点笔记...";
    this.notePreviewEl = this.noteSurfaceEl.createDiv({ cls: "mindmap-note-preview markdown-preview-view" });

    this.noteInputEl.addEventListener("focus", () => {
      this.updateMobileActionClusterVisibility();
    });
    this.noteInputEl.addEventListener("blur", () => {
      window.setTimeout(() => this.updateMobileActionClusterVisibility(), 0);
    });
    this.noteInputEl.addEventListener("input", () => {
      if (!this.doc || !this.selectedNodeId) {
        return;
      }
      const node = findNodeById(this.doc, this.selectedNodeId);
      if (!node) {
        return;
      }
      if (!this.noteHistoryCapturedForSession) {
        this.captureHistorySnapshot();
        this.noteHistoryCapturedForSession = true;
      }
      node.note = this.noteInputEl.value;
      this.scheduleMarkdownRender(node.note ?? "");
      this.requestSave();
    });
    this.noteInputEl.addEventListener("paste", (event) => {
      void this.handlePaste(event);
    });
    this.noteInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        this.indentNoteSelection(event.shiftKey);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        this.setNoteEditing(false);
      }
    });

    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgEl.classList.add("mindmap-svg");
    this.graphLayerEl = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.svgEl.appendChild(this.graphLayerEl);
    this.canvasEl.addEventListener("pointerdown", this.onCanvasPointerDown);
    this.canvasEl.addEventListener("wheel", this.onWheelPan, { passive: false });
    this.canvasEl.addEventListener("dblclick", this.onCanvasDoubleClick);
    this.canvasEl.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.canvasEl.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvasEl.addEventListener("touchend", this.onTouchEnd, { passive: false });
    this.canvasEl.addEventListener("touchcancel", this.onTouchEnd, { passive: false });
    this.canvasEl.appendChild(this.svgEl);

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.file || file.path !== this.file.path || this.isReloadingFromDisk) {
        return;
      }
      void this.reloadFromDisk(false);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || !this.file) {
        return;
      }
      if (oldPath !== this.file.path) {
        return;
      }
      this.file = file;
      if (this.doc) {
        this.doc.selfPath = file.path;
      }
      this.refreshTabTitle();
      void this.syncOpenDrawerWithSelection();
      this.renderMindmap();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || !this.file || file.path !== this.file.path) {
        return;
      }
      this.file = null;
      this.doc = null;
      this.closeDrawer();
      this.selectedNodeId = null;
      this.selectedNodeIds.clear();
      this.editingNodeId = null;
      this.mobileTooltipNodeId = null;
      this.refreshTabTitle();
      this.renderMindmap();
      window.setTimeout(() => {
        void this.leaf.setViewState({ type: "empty" });
      }, 0);
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      this.unlockMobileZenWhenViewportChanges();
    }));

    await this.loadFromFile();
    this.renderMindmap();
  }

  async onClose(): Promise<void> {
    this.containerEl.removeEventListener("keydown", this.onKeydown);
    if (this.isMobileLayout) {
      this.setZenMode(false);
      this.containerEl.removeEventListener("pointerdown", this.activateMindmapLeaf);
      this.containerEl.removeEventListener("touchstart", this.activateMindmapLeaf);
      this.containerEl.removeEventListener("touchstart", this.onContainerZenTouchStart, true);
      this.containerEl.removeEventListener("touchmove", this.onContainerZenTouchMove, true);
      this.containerEl.removeEventListener("touchend", this.onContainerZenTouchEnd, true);
      this.containerEl.removeEventListener("touchcancel", this.onContainerZenTouchEnd, true);
      window.removeEventListener("touchstart", this.onWindowTouchStart, true);
      window.removeEventListener("touchmove", this.onWindowTouchMove, true);
      window.removeEventListener("touchend", this.onWindowTouchEnd, true);
      window.removeEventListener("touchcancel", this.onWindowTouchEnd, true);
      window.removeEventListener("wheel", this.onWindowWheel, true);
      document.removeEventListener("touchstart", this.onWindowTouchStart, true);
      document.removeEventListener("touchmove", this.onWindowTouchMove, true);
      document.removeEventListener("touchend", this.onWindowTouchEnd, true);
      document.removeEventListener("touchcancel", this.onWindowTouchEnd, true);
    }
    this.canvasEl.removeEventListener("pointerdown", this.onCanvasPointerDown);
    this.canvasEl.removeEventListener("wheel", this.onWheelPan);
    this.canvasEl.removeEventListener("dblclick", this.onCanvasDoubleClick);
    this.canvasEl.removeEventListener("touchstart", this.onTouchStart);
    this.canvasEl.removeEventListener("touchmove", this.onTouchMove);
    this.canvasEl.removeEventListener("touchend", this.onTouchEnd);
    this.canvasEl.removeEventListener("touchcancel", this.onTouchEnd);
    if (this.pendingRenderFrame !== null) {
      window.cancelAnimationFrame(this.pendingRenderFrame);
      this.pendingRenderFrame = null;
    }
    await this.flushSave();
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const nextState = (state ?? {}) as { file?: string; focusLinkedFrom?: string };
    const path = nextState.file;
    if (!path) {
      return;
    }
    this.pendingFocusLinkedFromPath = nextState.focusLinkedFrom ? normalizePath(nextState.focusLinkedFrom) : null;

    const duplicateLeaf = this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE).find((leaf) => {
      if (leaf === this.leaf) {
        return false;
      }
      const view = leaf.view;
      if (!(view instanceof MindmapView)) {
        return false;
      }
      return view.getState().file === path;
    });
    if (duplicateLeaf) {
      const duplicateView = duplicateLeaf.view;
      if (duplicateView instanceof MindmapView && this.pendingFocusLinkedFromPath) {
        duplicateView.focusLinkedNodeFromPath(this.pendingFocusLinkedFromPath);
      }
      this.pendingFocusLinkedFromPath = null;
      this.app.workspace.revealLeaf(duplicateLeaf);
      await this.leaf.setViewState({ type: "empty" });
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }
    this.file = file;
    await this.loadFromFile();
    this.focusLinkedNodeFromPendingPath();
    this.renderMindmap();
  }

  getState(): { file?: string; focusLinkedFrom?: string } {
    return {
      file: this.file?.path,
      focusLinkedFrom: this.pendingFocusLinkedFromPath ?? undefined
    };
  }

  setFile(file: TFile): void {
    this.file = file;
  }

  private async loadFromFile(): Promise<void> {
    if (!this.file) {
      this.doc = null;
      if (this.isMobileLayout) {
        this.setZenMode(false);
      }
      return;
    }
    try {
      const raw = await this.app.vault.cachedRead(this.file);
      this.doc = normalizeMindmapDocument(JSON.parse(raw) as MindmapDocument);
      this.undoStack = [];
      this.redoStack = [];
      this.noteHistoryCapturedForSession = false;
      this.linkHistoryCapturedForSession = false;
      this.normalizeLayout();
      this.refreshTabTitle();
      if (!this.doc.selfPath && this.file) {
        this.doc.selfPath = this.file.path;
        this.requestSave();
      }
      this.shouldCenterOnNextRender = true;
      this.shouldFocusRootOnNextRender = true;
      if (this.isMobileLayout) {
        this.shouldForceMobileZenOnNextRender = true;
        this.closeDrawer();
        this.closeMobileNodeTooltip();
      }
    } catch (error) {
      new Notice(`导图读取失败：${String(error)}`);
      this.doc = null;
      if (this.isMobileLayout) {
        this.setZenMode(false);
      }
    }
  }

  private renderMindmap(): void {
    if (this.pendingRenderFrame !== null) {
      window.cancelAnimationFrame(this.pendingRenderFrame);
    }
    this.pendingRenderFrame = window.requestAnimationFrame(() => {
      this.pendingRenderFrame = null;
      this.renderMindmapNow();
    });
  }

  private updateViewportTransform(): void {
    if (!this.graphLayerEl) {
      return;
    }
    this.graphLayerEl.setAttribute(
      "transform",
      `translate(${this.panOffset.x}, ${this.panOffset.y}) scale(${this.zoomScale})`
    );
  }

  private updateMarqueeOverlay(): void {
    if (!this.marqueeEl) {
      return;
    }
    if (this.marqueeSelection) {
      const rect = this.getMarqueeClientRect(this.marqueeSelection);
      this.marqueeEl.removeClass("is-hidden");
      this.marqueeEl.style.left = `${rect.left}px`;
      this.marqueeEl.style.top = `${rect.top}px`;
      this.marqueeEl.style.width = `${rect.width}px`;
      this.marqueeEl.style.height = `${rect.height}px`;
    } else {
      this.marqueeEl.addClass("is-hidden");
    }
  }

  private renderMindmapNow(): void {
    if (!this.graphLayerEl) {
      return;
    }
    this.graphLayerEl.innerHTML = "";
    this.updateMobileActionButtons();
    if (!this.doc) {
      return;
    }

    const nodes = visibleNodes(this.doc.root);
    if (this.shouldCenterOnNextRender) {
      if (this.shouldFocusRootOnNextRender) {
        this.centerViewportOnRoot(this.doc.root, nodes);
        this.shouldFocusRootOnNextRender = false;
      } else {
        this.centerViewportOnNodes(nodes);
      }
      this.shouldCenterOnNextRender = false;
    }

    if (this.shouldForceMobileZenOnNextRender) {
      this.shouldForceMobileZenOnNextRender = false;
      this.setZenMode(true);
    }

    this.updateViewportTransform();

    const draggingIds = this.draggingNodeIds.size > 0
      ? new Set(this.draggingNodeIds)
      : (() => {
        const draggingRoot = this.isDragging && this.selectedNodeId && this.doc
          ? findNodeById(this.doc, this.selectedNodeId)
          : null;
        return draggingRoot
          ? new Set(this.collectSubtreeNodes(draggingRoot).map((current) => current.id))
          : null;
      })();
    const dragGhostPositions = this.dragGhostPositions;

    this.updateMarqueeOverlay();

    const drawOrthogonalConnectors = (node: MindmapNode): void => {
      if (node.collapsed || node.children.length === 0) {
        return;
      }
      const fromSize = this.ensureNodeSize(node);
      const parentPosition = draggingIds?.has(node.id) ? dragGhostPositions.get(node.id) ?? node : node;
      const parentX = parentPosition.x + fromSize.width / 2;

      if (node.children.length === 1) {
        const child = node.children[0];
        const childSize = this.ensureNodeSize(child);
        const childPosition = draggingIds?.has(child.id) ? dragGhostPositions.get(child.id) ?? child : child;
        const childX = childPosition.x - childSize.width / 2;
        const directPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        directPath.setAttribute("d", `M ${parentX} ${parentPosition.y} H ${childX}`);
        directPath.classList.add("mindmap-edge");
        if (draggingIds?.has(node.id) || draggingIds?.has(child.id)) {
          directPath.classList.add("is-dragging");
        }
        this.graphLayerEl.appendChild(directPath);
        drawOrthogonalConnectors(child);
        return;
      }

      const branchX = parentX + 28;
      const childAnchors = node.children.map((child) => {
        const childSize = this.ensureNodeSize(child);
        const childPosition = draggingIds?.has(child.id) ? dragGhostPositions.get(child.id) ?? child : child;
        return {
          child,
          x: childPosition.x - childSize.width / 2,
          y: childPosition.y
        };
      });

      const topY = childAnchors[0]?.y;
      const bottomY = childAnchors[childAnchors.length - 1]?.y;
      if (topY !== undefined && bottomY !== undefined) {
        const trunkStartY = Math.min(parentPosition.y, topY, bottomY);
        const trunkEndY = Math.max(parentPosition.y, topY, bottomY);
        if (Math.abs(trunkEndY - trunkStartY) > 2) {
          const trunk = document.createElementNS("http://www.w3.org/2000/svg", "path");
          trunk.setAttribute("d", `M ${branchX} ${trunkStartY} V ${trunkEndY}`);
          trunk.classList.add("mindmap-edge");
          if (draggingIds?.has(node.id) || node.children.some((child) => draggingIds?.has(child.id))) {
            trunk.classList.add("is-dragging");
          }
          this.graphLayerEl.appendChild(trunk);
        }
      }

      const parentPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      parentPath.setAttribute("d", `M ${parentX} ${parentPosition.y} H ${branchX}`);
      parentPath.classList.add("mindmap-edge");
      if (draggingIds?.has(node.id) || node.children.some((child) => draggingIds?.has(child.id))) {
        parentPath.classList.add("is-dragging");
      }
      this.graphLayerEl.appendChild(parentPath);

      childAnchors.forEach(({ child, x, y }) => {
        const childPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
        childPath.setAttribute("d", `M ${branchX} ${y} H ${x}`);
        childPath.classList.add("mindmap-edge");
        if (draggingIds?.has(node.id) || draggingIds?.has(child.id)) {
          childPath.classList.add("is-dragging");
        }
        this.graphLayerEl.appendChild(childPath);
        drawOrthogonalConnectors(child);
      });
    };

    drawOrthogonalConnectors(this.doc.root);

    if (draggingIds && dragGhostPositions.size > 0) {
      nodes
        .filter((node) => draggingIds.has(node.id))
        .forEach((node) => {
          const ghostPosition = dragGhostPositions.get(node.id);
          if (!ghostPosition) {
            return;
          }
          const size = this.ensureNodeSize(node);
          const ghostGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
          ghostGroup.classList.add("mindmap-node-group", "is-drag-ghost");
          ghostGroup.setAttribute("transform", `translate(${ghostPosition.x}, ${ghostPosition.y})`);

          const ghostRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          ghostRect.setAttribute("x", String(-size.width / 2));
          ghostRect.setAttribute("y", String(-size.height / 2));
          ghostRect.setAttribute("rx", node.id === this.doc?.root.id ? "16" : "10");
          ghostRect.setAttribute("ry", node.id === this.doc?.root.id ? "16" : "10");
          ghostRect.setAttribute("width", String(size.width));
          ghostRect.setAttribute("height", String(size.height));
          ghostRect.classList.add("mindmap-node", "is-drag-ghost");
          ghostGroup.appendChild(ghostRect);

          const ghostTitle = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
          ghostTitle.setAttribute("x", String(-size.width / 2 + 10));
          ghostTitle.setAttribute("y", String(-size.height / 2 + 6));
          ghostTitle.setAttribute("width", String(size.width - 20));
          ghostTitle.setAttribute("height", String(size.height - 12));
          const ghostText = document.createElement("div");
          ghostText.className = "mindmap-node-title is-drag-ghost";
          ghostText.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
          ghostText.textContent = node.title;
          ghostTitle.appendChild(ghostText);
          ghostGroup.appendChild(ghostTitle);
          this.graphLayerEl.appendChild(ghostGroup);
        });
    }

    const nodesToRender = draggingIds
      ? [
        ...nodes.filter((node) => !draggingIds.has(node.id)),
        ...nodes.filter((node) => draggingIds.has(node.id))
      ]
      : nodes;

    nodesToRender.forEach((node) => {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("mindmap-node-group");
      if (draggingIds?.has(node.id)) {
        group.classList.add("is-dragging");
      }
      group.setAttribute("transform", `translate(${node.x}, ${node.y})`);
      group.dataset.id = node.id;
      const size = this.ensureNodeSize(node);

      const isRootNode = this.doc !== null && node.id === this.doc.root.id;
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(-size.width / 2));
      rect.setAttribute("y", String(-size.height / 2));
      rect.setAttribute("rx", isRootNode ? "16" : "10");
      rect.setAttribute("ry", isRootNode ? "16" : "10");
      rect.setAttribute("width", String(size.width));
      rect.setAttribute("height", String(size.height));
      rect.classList.add("mindmap-node");
      if (isRootNode) {
        rect.classList.add("is-root");
        group.classList.add("is-root");
      }
      if (this.dropTargetNodeId === node.id) {
        rect.classList.add("is-drop-target");
      }
      const isNodeSelected = this.selectedNodeId === node.id || this.selectedNodeIds.has(node.id);
      if (isNodeSelected) {
        rect.classList.add("is-selected");
      }
      group.appendChild(rect);

      const titleHasLink = !!node.linkTarget?.trim();
      const titleBox = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      titleBox.setAttribute("x", String(-size.width / 2 + 10));
      titleBox.setAttribute("y", String(-size.height / 2 + 6));
      titleBox.setAttribute("width", String(size.width - 20));
      titleBox.setAttribute("height", String(size.height - 12));
      titleBox.classList.add("mindmap-title-fo");
      const text = document.createElement("div");
      text.className = "mindmap-node-title";
      if (titleHasLink) {
        text.classList.add("has-link");
      }
      if (isRootNode) {
        text.classList.add("is-root");
      }
      text.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      text.textContent = node.title;
      if (this.editingNodeId === node.id) {
        titleBox.style.display = "none";
      }
      titleBox.appendChild(text);
      group.appendChild(titleBox);

      if (this.editingNodeId === node.id) {
        this.appendInlineTitleEditor(group, node, size.width, size.height);
      }

      if (node.children.length > 0) {
        const foldGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        foldGroup.classList.add("mindmap-collapse-group");
        foldGroup.setAttribute("transform", `translate(${size.width / 2 + 16}, 0)`);

        const foldBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        foldBg.setAttribute("x", "-13");
        foldBg.setAttribute("y", "-13");
        foldBg.setAttribute("width", "26");
        foldBg.setAttribute("height", "26");
        foldBg.setAttribute("rx", "13");
        foldBg.setAttribute("ry", "13");
        foldBg.classList.add("mindmap-collapse-bg");
        foldGroup.appendChild(foldBg);

        const foldButton = document.createElementNS("http://www.w3.org/2000/svg", "text");
        foldButton.textContent = node.collapsed ? "▶" : "◀";
        foldButton.classList.add("mindmap-collapse-text");
        foldButton.setAttribute("x", "0");
        foldButton.setAttribute("y", "1");
        foldButton.setAttribute("text-anchor", "middle");
        foldButton.setAttribute("dominant-baseline", "middle");
        foldGroup.appendChild(foldButton);

        foldGroup.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          event.preventDefault();
        });
        foldGroup.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();
          this.captureHistorySnapshot();
          node.collapsed = !node.collapsed;
          this.normalizeLayout();
          this.requestSave();
          this.renderMindmap();
        });
        foldGroup.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          event.preventDefault();
        });
        group.appendChild(foldGroup);
      }

      if (isNodeSelected) {
        const resizeHandle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        resizeHandle.setAttribute("x", String(size.width / 2 - 9));
        resizeHandle.setAttribute("y", String(size.height / 2 - 9));
        resizeHandle.setAttribute("width", "10");
        resizeHandle.setAttribute("height", "10");
        resizeHandle.setAttribute("rx", "5");
        resizeHandle.setAttribute("ry", "5");
        resizeHandle.classList.add("mindmap-resize-handle");
        resizeHandle.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          event.preventDefault();
          this.startResize(event, node);
        });
        group.appendChild(resizeHandle);
      }

      group.addEventListener("pointerdown", (event) => {
        if (this.isDirectLinkOpenGesture(event) && !!node.linkTarget?.trim()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        this.startDrag(event, node);
      });
      group.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest(".mindmap-collapse-group, .mindmap-jump-group")) {
          return;
        }
        if (this.isDirectLinkOpenGesture(event) && !!node.linkTarget?.trim()) {
          event.preventDefault();
          event.stopPropagation();
          this.setSingleSelectedNode(node.id);
          this.renderMindmap();
          this.unlockMobileZenIfNeeded();
          void this.openLinkedTarget(node.linkTarget);
          return;
        }
        if (this.pendingNodeSelectionTimer) {
          window.clearTimeout(this.pendingNodeSelectionTimer);
          this.pendingNodeSelectionTimer = null;
        }
        if (this.isMobileLayout) {
          return;
        }
        if (event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          this.setSingleSelectedNode(node.id);
          this.startInlineNodeEdit(node.id);
          return;
        }
        this.pendingNodeSelectionTimer = window.setTimeout(() => {
          this.pendingNodeSelectionTimer = null;
          this.setSingleSelectedNode(node.id);
          this.focusContainerWithoutScroll();
          this.renderMindmap();
        }, 220);
      });
      group.addEventListener("dblclick", (event) => {
        if (event.target instanceof Element && event.target.closest(".mindmap-collapse-group, .mindmap-jump-group")) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (this.pendingNodeSelectionTimer) {
          window.clearTimeout(this.pendingNodeSelectionTimer);
          this.pendingNodeSelectionTimer = null;
        }
        event.preventDefault();
        event.stopPropagation();
        this.setSingleSelectedNode(node.id);
        this.startInlineNodeEdit(node.id);
      });
      group.addEventListener("contextmenu", (event) => {
        if (this.isMobileLayout) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.setSingleSelectedNode(node.id);
        this.renderMindmap();
        this.openNodeMenu(event, node.id);
      });
      this.graphLayerEl.appendChild(group);
    });
  }

  private startDrag(event: PointerEvent, node: MindmapNode): void {
    if (event.detail >= 2) {
      return;
    }
    if (this.pendingNodeSelectionTimer) {
      window.clearTimeout(this.pendingNodeSelectionTimer);
      this.pendingNodeSelectionTimer = null;
    }
    if (!this.doc) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const selectedRoots = this.getDragRootNodes(node);
    const snapshotBeforeDrag = this.cloneDocument(this.doc);
    const draggingNodes = this.collectMultipleSubtreeNodes(selectedRoots);
    const draggingNodeIds = new Set(draggingNodes.map((current) => current.id));
    const selectedRootIds = new Set(selectedRoots.map((current) => current.id));
    let startPositions = new Map<string, { x: number; y: number }>();
    draggingNodes.forEach((current) => {
      startPositions.set(current.id, { x: current.x, y: current.y });
    });
    let startAnchor = { x: node.x, y: node.y };
    let siblingSortActive = false;
    const startClient = { x: event.clientX, y: event.clientY };
    const startPoint = this.getDocumentPoint(event.clientX, event.clientY);
    const isTouchDragCandidate = this.isMobileLayout && event.pointerType !== "mouse";
    let dragStarted = false;
    let dragArmed = !isTouchDragCandidate;
    let longPressTimer: number | null = null;
    let longPressHapticFired = false;

    if (isTouchDragCandidate) {
      longPressTimer = window.setTimeout(() => {
        dragArmed = true;
        if (!longPressHapticFired) {
          navigator.vibrate?.(12);
          longPressHapticFired = true;
        }
      }, MindmapView.MOBILE_NODE_DRAG_LONG_PRESS_DELAY);
    }

    const onMove = (moveEvent: PointerEvent): void => {
      const distance = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
      if (!dragStarted) {
        if (isTouchDragCandidate && distance >= 6 && !dragArmed) {
          if (longPressTimer !== null) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
          }
          dragArmed = false;
          return;
        }
        if (distance < 4) {
          return;
        }
        if (!dragArmed) {
          return;
        }
        dragStarted = true;
        if (longPressTimer !== null) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
        this.isDragging = true;
        this.dragGhostPositions = new Map();
        draggingNodes.forEach((current) => {
          this.dragGhostPositions.set(current.id, { x: current.x, y: current.y });
        });
        this.draggingNodeIds = draggingNodeIds;
        this.selectedNodeId = selectedRootIds.has(node.id) ? node.id : selectedRoots[0]?.id ?? node.id;
        this.selectedNodeIds = new Set(selectedRootIds);
        this.dragOffset = { x: startPoint.x - node.x, y: startPoint.y - node.y };
      }
      moveEvent.stopPropagation();
      moveEvent.preventDefault();
      const currentPoint = this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY);
      const nextX = currentPoint.x - this.dragOffset.x;
      const nextY = currentPoint.y - this.dragOffset.y;
      const deltaX = nextX - startAnchor.x;
      const deltaY = nextY - startAnchor.y;
      siblingSortActive = false;
      draggingNodes.forEach((current) => {
        const origin = startPositions.get(current.id);
        if (!origin) {
          return;
        }
        current.x = origin.x + deltaX;
        current.y = origin.y + deltaY;
      });

      if (selectedRoots.length === 1 && this.doc) {
        const siblingLookup = findParentOfNode(this.doc, selectedRoots[0].id);
        if (siblingLookup) {
          const siblings = siblingLookup.parent.children;
          const currentIndex = siblingLookup.index;
          const dragCenterY = selectedRoots[0].y;
          const otherSiblings = siblings.filter((sibling) => sibling.id !== selectedRoots[0].id);
          let targetIndex = otherSiblings.findIndex((sibling) => dragCenterY < sibling.y);
          if (targetIndex === -1) {
            targetIndex = otherSiblings.length;
          }

          if (targetIndex !== currentIndex) {
            const reordered = reorderNodeWithinParent(this.doc, selectedRoots[0].id, targetIndex);
            if (reordered) {
              const preservedPositions = new Map<string, { x: number; y: number }>();
              draggingNodes.forEach((current) => {
                preservedPositions.set(current.id, { x: current.x, y: current.y });
              });
              siblingSortActive = true;
              this.selectedNodeId = selectedRoots[0].id;
              this.selectedNodeIds = new Set([selectedRoots[0].id]);
              this.normalizeLayoutKeepingNodePosition(this.doc.root.id);
              draggingNodes.forEach((current) => {
                const preserved = preservedPositions.get(current.id);
                if (!preserved) {
                  return;
                }
                current.x = preserved.x;
                current.y = preserved.y;
              });
              startAnchor = { x: selectedRoots[0].x, y: selectedRoots[0].y };
              draggingNodes.forEach((current) => {
                startPositions.set(current.id, { x: current.x, y: current.y });
              });
            }
          }
        }
      }

      this.dropTargetNodeId = siblingSortActive ? null : this.findDropTargetForIds(selectedRootIds)?.id ?? null;
      this.renderMindmap();
    };

    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (!dragStarted) {
        if (
          this.isMobileLayout &&
          upEvent.pointerType !== "mouse" &&
          !(upEvent.target instanceof Element && upEvent.target.closest(".mindmap-collapse-group, .mindmap-jump-group"))
        ) {
          const now = Date.now();
          if (this.lastMobileNodeTap && this.lastMobileNodeTap.nodeId === node.id && now - this.lastMobileNodeTap.time <= 320) {
            this.closeMobileNodeTooltip();
            this.lastMobileNodeTap = null;
            this.setSingleSelectedNode(node.id);
            this.startInlineNodeEdit(node.id);
          } else {
            const shouldOpenTooltip = this.shouldOpenMobileNodeTooltip(node.id, now);
            this.lastMobileNodeTap = { nodeId: node.id, time: now };
            this.setSingleSelectedNode(node.id);
            this.focusContainerWithoutScroll();
            if (shouldOpenTooltip) {
              this.openMobileNodeTooltip(node.id);
            }
            this.renderMindmap();
          }
        } else {
          this.lastMobileNodeTap = null;
        }
        return;
      }
      this.isDragging = false;
      this.draggingNodeIds = new Set();
      this.dragGhostPositions = new Map();
      const dropTarget = this.findDropTargetForIds(selectedRootIds);
      this.dropTargetNodeId = null;
      if (dropTarget && this.doc) {
        const moved = this.reparentMultipleNodes(selectedRoots, dropTarget.id);
        if (moved) {
          this.pushHistoryState(snapshotBeforeDrag);
          this.selectedNodeIds = new Set(selectedRoots.map((current) => current.id));
          this.selectedNodeId = selectedRoots[0]?.id ?? null;
          this.normalizeLayout();
          this.requestSave();
          void this.syncOpenDrawerWithSelection();
          this.renderMindmap();
          return;
        }
      }
      this.pushHistoryState(snapshotBeforeDrag);
      this.normalizeLayout();
      this.requestSave();
      void this.syncOpenDrawerWithSelection();
      this.renderMindmap();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private collectSubtreeNodes(node: MindmapNode): MindmapNode[] {
    const nodes: MindmapNode[] = [];
    const walk = (current: MindmapNode): void => {
      nodes.push(current);
      current.children.forEach(walk);
    };
    walk(node);
    return nodes;
  }

  private collectMultipleSubtreeNodes(nodes: MindmapNode[]): MindmapNode[] {
    const collected = new Map<string, MindmapNode>();
    nodes.forEach((node) => {
      this.collectSubtreeNodes(node).forEach((current) => {
        collected.set(current.id, current);
      });
    });
    return Array.from(collected.values());
  }

  private getDragRootNodes(fallbackNode: MindmapNode): MindmapNode[] {
    if (!this.doc || this.selectedNodeIds.size === 0 || !this.selectedNodeIds.has(fallbackNode.id)) {
      return [fallbackNode];
    }
    const selectedNodes = Array.from(this.selectedNodeIds)
      .map((id) => findNodeById(this.doc!, id))
      .filter((node): node is MindmapNode => !!node);
    return selectedNodes.filter((node) => {
      const parentLookup = findParentOfNode(this.doc!, node.id);
      return !parentLookup || !this.selectedNodeIds.has(parentLookup.parent.id);
    });
  }

  private getNodesInMarquee(marquee: { startX: number; startY: number; currentX: number; currentY: number }): Set<string> {
    if (!this.doc) {
      return new Set();
    }
    const left = Math.min(marquee.startX, marquee.currentX);
    const right = Math.max(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    const bottom = Math.max(marquee.startY, marquee.currentY);
    const selectedIds = new Set<string>();
    visibleNodes(this.doc.root).forEach((node) => {
      const size = this.ensureNodeSize(node);
      const nodeLeft = node.x - size.width / 2;
      const nodeRight = node.x + size.width / 2;
      const nodeTop = node.y - size.height / 2;
      const nodeBottom = node.y + size.height / 2;
      const intersects = nodeLeft <= right && nodeRight >= left && nodeTop <= bottom && nodeBottom >= top;
      if (intersects) {
        selectedIds.add(node.id);
      }
    });
    return selectedIds;
  }

  private getMarqueeClientRect(marquee: { startX: number; startY: number; currentX: number; currentY: number }): { left: number; top: number; width: number; height: number } {
    const start = this.getCanvasClientPoint(marquee.startX, marquee.startY);
    const current = this.getCanvasClientPoint(marquee.currentX, marquee.currentY);
    return {
      left: Math.min(start.x, current.x),
      top: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y)
    };
  }

  private findDropTargetForIds(movingRootIds: Set<string>): MindmapNode | null {
    if (!this.doc) {
      return null;
    }
    const subtreeIds = new Set<string>();
    movingRootIds.forEach((id) => {
      const node = findNodeById(this.doc!, id);
      if (!node) {
        return;
      }
      this.collectSubtreeNodes(node).forEach((current) => subtreeIds.add(current.id));
    });
    const anchorNodeId = this.selectedNodeId && movingRootIds.has(this.selectedNodeId)
      ? this.selectedNodeId
      : Array.from(movingRootIds)[0] ?? null;
    const anchorNode = anchorNodeId ? findNodeById(this.doc, anchorNodeId) : null;
    if (!anchorNode) {
      return null;
    }
    const candidates = visibleNodes(this.doc.root).filter((node) => !subtreeIds.has(node.id));
    let bestTarget: MindmapNode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
      const size = this.ensureNodeSize(candidate);
      const anchorX = candidate.x + size.width / 2;
      const anchorY = candidate.y;
      const deltaX = anchorNode.x - anchorX;
      const deltaY = anchorNode.y - anchorY;
      const distance = Math.hypot(deltaX, deltaY);
      const edgeThreshold = Math.max(42, size.height * 0.9);
      if (distance > edgeThreshold || distance >= bestDistance) {
        return;
      }
      bestTarget = candidate;
      bestDistance = distance;
    });

    return bestTarget;
  }

  private findSiblingReorderIndex(movingNode: MindmapNode): number | null {
    if (!this.doc) {
      return null;
    }
    const parentLookup = findParentOfNode(this.doc, movingNode.id);
    if (!parentLookup) {
      return null;
    }
    const siblings = parentLookup.parent.children;
    if (siblings.length <= 1) {
      return null;
    }

    let targetIndex = siblings.length - 1;
    for (let index = 0; index < siblings.length; index += 1) {
      const sibling = siblings[index];
      if (sibling.id === movingNode.id) {
        continue;
      }
      if (movingNode.y < sibling.y) {
        targetIndex = index;
        break;
      }
    }

    return targetIndex === parentLookup.index ? null : targetIndex;
  }

  private reparentMultipleNodes(nodes: MindmapNode[], nextParentId: string): boolean {
    if (!this.doc || nodes.length === 0) {
      return false;
    }
    const movableNodes = [...nodes].filter((node) => node.id !== this.doc!.root.id);
    const nextParent = findNodeById(this.doc, nextParentId);
    if (!nextParent) {
      return false;
    }
    const movedNodes: MindmapNode[] = [];
    movableNodes.forEach((node) => {
      const moved = reparentNode(this.doc!, node.id, nextParentId);
      if (moved) {
        movedNodes.push(moved.moved);
      }
    });
    return movedNodes.length > 0;
  }

  private findDropTarget(movingNode: MindmapNode): MindmapNode | null {
    if (!this.doc) {
      return null;
    }
    const subtreeIds = new Set(this.collectSubtreeNodes(movingNode).map((node) => node.id));
    const candidates = visibleNodes(this.doc.root).filter((node) => node.id !== movingNode.id);
    let bestTarget: MindmapNode | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    candidates.forEach((candidate) => {
      if (subtreeIds.has(candidate.id)) {
        return;
      }
      const size = this.ensureNodeSize(candidate);
      const anchorX = candidate.x + size.width / 2;
      const anchorY = candidate.y;
      const deltaX = movingNode.x - anchorX;
      const deltaY = movingNode.y - anchorY;
      const distance = Math.hypot(deltaX, deltaY);
      const edgeThreshold = Math.max(42, size.height * 0.9);
      if (distance > edgeThreshold || distance >= bestDistance) {
        return;
      }
      bestTarget = candidate;
      bestDistance = distance;
    });

    return bestTarget;
  }

  private unlockMobileZenIfNeeded(): void {
    if (this.isMobileLayout && this.isZenMode) {
      this.setZenMode(false);
    }
  }

  private sanitizeMindmapFileBaseName(title: string): string {
    const sanitized = title
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return sanitized || "未命名导图";
  }

  private isMindmapFile(file: TFile): boolean {
    return file.name.endsWith(`.${PRIMARY_MINDMAP_EXTENSION}`) || file.name.endsWith(`.${LEGACY_MINDMAP_EXTENSION}`);
  }

  private getMindmapObsidianUrl(file: TFile): string {
    return `obsidian://open?file=${encodeURIComponent(file.path)}`;
  }

  private getNormalizedLinkedFilePath(rawLink: string): string | null {
    const input = rawLink.trim();
    if (!input) {
      return null;
    }
    if (input.startsWith("obsidian://")) {
      try {
        const url = new URL(input);
        const fileParam = url.searchParams.get("file");
        return fileParam ? normalizePath(decodeURIComponent(fileParam)) : null;
      } catch {
        return null;
      }
    }
    if (/^https?:\/\//i.test(input)) {
      return null;
    }
    return normalizePath(input);
  }

  private nodeLinksToPath(node: MindmapNode, targetPath: string): boolean {
    const linkedPath = this.getNormalizedLinkedFilePath(node.linkTarget ?? "");
    if (!linkedPath) {
      return false;
    }
    if (linkedPath === targetPath) {
      return true;
    }
    const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkedPath, this.file?.path ?? "")
      ?? this.app.vault.getAbstractFileByPath(linkedPath);
    return linkedFile instanceof TFile && linkedFile.path === targetPath;
  }

  private findNodeLinkedToPath(targetPath: string): MindmapNode | null {
    if (!this.doc) {
      return null;
    }
    let rootMatch: MindmapNode | null = null;
    let nonRootMatch: MindmapNode | null = null;
    walkNodes(this.doc.root, (node) => {
      if (!this.nodeLinksToPath(node, targetPath)) {
        return;
      }
      if (node.id === this.doc?.root.id) {
        rootMatch = rootMatch ?? node;
        return;
      }
      nonRootMatch = nonRootMatch ?? node;
    });
    return nonRootMatch ?? rootMatch;
  }

  private ensureRootSourceLink(sourcePath: string | null): boolean {
    if (!this.doc || !sourcePath) {
      return false;
    }
    const sourceFile = this.app.vault.getAbstractFileByPath(normalizePath(sourcePath));
    if (!(sourceFile instanceof TFile) || !this.isMindmapFile(sourceFile)) {
      return false;
    }
    const nextLink = this.getMindmapObsidianUrl(sourceFile);
    if ((this.doc.root.linkTarget ?? "") === nextLink) {
      return false;
    }
    this.doc.root.linkTarget = nextLink;
    return true;
  }

  private expandNodeAndAncestors(nodeId: string): boolean {
    if (!this.doc) {
      return false;
    }
    let changed = false;
    const node = findNodeById(this.doc, nodeId);
    if (node && node.collapsed) {
      node.collapsed = false;
      changed = true;
    }
    let lookup = findParentOfNode(this.doc, nodeId);
    while (lookup) {
      if (lookup.parent.collapsed) {
        lookup.parent.collapsed = false;
        changed = true;
      }
      lookup = findParentOfNode(this.doc, lookup.parent.id);
    }
    return changed;
  }

  private centerViewportOnNode(node: MindmapNode): void {
    const canvasRect = this.canvasEl.getBoundingClientRect();
    const viewportWidth = Math.max(1, canvasRect.width);
    const viewportHeight = Math.max(1, canvasRect.height);
    this.zoomScale = Math.min(1.15, Math.max(0.85, this.zoomScale || 1));
    this.panOffset.x = viewportWidth / 2 - node.x * this.zoomScale;
    this.panOffset.y = viewportHeight / 2 - node.y * this.zoomScale;
  }

  private centerViewportOnNodeById(nodeId: string): void {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    this.centerViewportOnNode(node);
    this.updateViewportTransform();
  }

  private focusLinkedNodeFromPath(sourcePath: string): boolean {
    if (!this.doc) {
      return false;
    }
    const normalizedSourcePath = normalizePath(sourcePath);
    const rootLinkChanged = this.ensureRootSourceLink(normalizedSourcePath);
    const linkedNode = this.findNodeLinkedToPath(normalizedSourcePath);
    if (!linkedNode) {
      if (rootLinkChanged) {
        this.requestSave();
      }
      return false;
    }
    const linkedNodeId = linkedNode.id;
    const linkedNodeTitle = linkedNode.title;
    const expanded = this.expandNodeAndAncestors(linkedNodeId);
    if (expanded) {
      this.normalizeLayout();
    }
    if (expanded || rootLinkChanged) {
      this.requestSave();
    }
    this.shouldCenterOnNextRender = false;
    this.shouldFocusRootOnNextRender = false;
    this.setSingleSelectedNode(linkedNodeId);
    this.renderMindmap();
    window.requestAnimationFrame(() => {
      this.centerViewportOnNodeById(linkedNodeId);
      window.requestAnimationFrame(() => this.centerViewportOnNodeById(linkedNodeId));
    });
    new Notice(`已定位到关联节点：${linkedNodeTitle}`);
    return true;
  }

  private focusLinkedNodeFromPendingPath(): void {
    const sourcePath = this.pendingFocusLinkedFromPath;
    if (!sourcePath) {
      return;
    }
    this.pendingFocusLinkedFromPath = null;
    if (!this.focusLinkedNodeFromPath(sourcePath)) {
      new Notice("未找到指向来源导图的关联节点");
    }
  }

  private getMindmapLinkCandidates(): MindmapLinkCandidate[] {
    return this.app.vault.getFiles()
      .filter((file) => this.isMindmapFile(file))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))
      .map((file) => ({
        file,
        title: file.basename.replace(/\.mindmap$/i, ""),
        obsidianUrl: this.getMindmapObsidianUrl(file)
      }));
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

  private async createMindmapForAssociation(title: string): Promise<TFile> {
    const folderPath = this.file?.parent?.path ?? "";
    const baseName = this.sanitizeMindmapFileBaseName(title);
    const finalPath = this.getNextMindmapPath(folderPath, baseName);
    const doc = createDefaultMindmap();
    doc.root.title = baseName;
    doc.selfPath = finalPath;
    const newFile = await this.app.vault.create(finalPath, JSON.stringify(doc, null, 2));
    new Notice(`已创建导图：${newFile.path}`);
    return newFile;
  }

  private async assignNodeLinkTarget(nodeId: string, linkTarget: string): Promise<void> {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    const nextTarget = linkTarget.trim();
    if ((node.linkTarget ?? "") !== nextTarget) {
      this.captureHistorySnapshot();
      node.linkTarget = nextTarget;
    }
    if (this.selectedNodeId === nodeId && this.nodeLinkInputEl) {
      this.nodeLinkInputEl.value = nextTarget;
      this.updateNodeLinkActionButton(nextTarget);
    }
    this.requestSave();
    this.updateMobileActionButtons();
    this.renderMindmap();
  }

  private openMindmapAssociationModal(nodeId: string): void {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    const modal = new MindmapAssociationModal(
      this.app,
      this.getMindmapLinkCandidates().filter((candidate) => candidate.file.path !== this.file?.path),
      node.title.trim() || "新建导图",
      (candidate) => {
        void this.assignNodeLinkTarget(nodeId, candidate.obsidianUrl);
        new Notice(`已关联到导图：${candidate.title}`);
      },
      async (title) => {
        const newFile = await this.createMindmapForAssociation(title);
        await this.assignNodeLinkTarget(nodeId, this.getMindmapObsidianUrl(newFile));
        await this.openInternalTarget(newFile.path, true);
      }
    );
    modal.open();
  }

  private async renameMindmapFileToMatchRootTitle(nextTitle: string): Promise<void> {
    if (!this.file) {
      return;
    }
    const parentPath = this.file.parent?.path ?? "";
    const extension = this.file.extension;
    const nextBaseName = this.sanitizeMindmapFileBaseName(nextTitle);
    const buildFileName = (suffix?: number): string => {
      const resolvedBaseName = suffix && suffix > 1 ? `${nextBaseName} ${suffix}` : nextBaseName;
      return extension ? `${resolvedBaseName}.${extension}` : resolvedBaseName;
    };

    let candidatePath = "";
    let candidateFileName = "";
    let suffix = 1;
    while (true) {
      candidateFileName = buildFileName(suffix);
      candidatePath = normalizePath(parentPath ? `${parentPath}/${candidateFileName}` : candidateFileName);
      if (candidatePath === this.file.path) {
        return;
      }
      const existing = this.app.vault.getAbstractFileByPath(candidatePath);
      if (!existing || existing === this.file) {
        break;
      }
      suffix += 1;
    }

    if (this.file.name === candidateFileName) {
      return;
    }

    try {
      await this.app.fileManager.renameFile(this.file, candidatePath);
      const renamed = this.app.vault.getAbstractFileByPath(candidatePath);
      if (renamed instanceof TFile) {
        this.file = renamed;
      }
      if (this.doc) {
        this.doc.selfPath = candidatePath;
      }
      this.refreshTabTitle();
    } catch (error) {
      new Notice(`导图文件重命名失败：${String(error)}`);
    }
  }

  private async syncDrawerToNode(nodeId: string): Promise<void> {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    this.selectedNodeId = node.id;
    this.selectedNodeIds = new Set([node.id]);
    this.drawerTitleEl.setText(`${node.title}`);
    const drawerHeaderPathEl = this.drawerHeaderEl.querySelector<HTMLElement>(".mindmap-drawer-header-path");
    drawerHeaderPathEl?.setText(this.doc?.selfPath ?? this.file?.path ?? "");
    // this.nodeTitleInputEl.value = node.title;
    const isRootNode = node.id === this.doc.root.id;
    this.nodeLinkInputEl.value = node.linkTarget ?? "";
    this.nodeLinkInputEl.disabled = isRootNode;
    this.nodeLinkInputEl.toggleClass("is-readonly", isRootNode);
    this.nodeLinkInputEl.placeholder = isRootNode ? "中心节点链接由跳转来源自动维护" : "输入链接目标：导图或笔记路径";
    this.nodeLinkInputEl.setAttribute("aria-readonly", isRootNode ? "true" : "false");
    this.updateNodeLinkActionButton(node.linkTarget ?? "");
    this.noteInputEl.value = node.note ?? "";
    await this.renderMarkdown(node.note ?? "");
    this.setNoteEditing(false);
  }

  private async syncOpenDrawerWithSelection(): Promise<void> {
    if (this.editingNodeId !== null) {
      if (!this.drawerEl.hasClass("is-hidden")) {
        this.closeDrawer();
      }
      return;
    }
    if (this.drawerEl.hasClass("is-hidden")) {
      return;
    }
    if (!this.selectedNodeId) {
      this.closeDrawer();
      return;
    }
    await this.syncDrawerToNode(this.selectedNodeId);
    this.updateMobileActionButtons();
    this.renderMindmap();
  }

  private async openDrawer(nodeId: string): Promise<void> {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    this.selectedNodeId = node.id;
    this.selectedNodeIds = new Set([node.id]);
    this.editingNodeId = null;
    this.drawerEl.removeClass("is-hidden");
    this.layoutEl.addClass("has-drawer");
    this.updateMobileActionButtons();
    await this.syncDrawerToNode(node.id);
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
  }

  async toggleDrawerForSelection(): Promise<boolean> {
    if (this.editingNodeId !== null) {
      return false;
    }
    if (!this.drawerEl.hasClass("is-hidden")) {
      this.closeDrawer();
      return true;
    }
    const targetNodeId = this.selectedNodeId ?? Array.from(this.selectedNodeIds)[0] ?? null;
    if (!targetNodeId) {
      return false;
    }
    await this.openDrawer(targetNodeId);
    return true;
  }

  private updateNodeLinkActionButton(linkTarget: string): void {
    if (!this.nodeLinkActionButtonEl) {
      return;
    }
    const hasLink = linkTarget.trim().length > 0;
    this.nodeLinkActionButtonEl.disabled = !hasLink;
    this.nodeLinkActionButtonEl.toggleClass("is-disabled", !hasLink);
    this.nodeLinkActionButtonEl.setAttribute("aria-disabled", hasLink ? "false" : "true");
  }

  private updateMobileActionButtons(): void {
    if (!this.isMobileLayout || !this.mobileActionClusterEl) {
      return;
    }
    const selectedNode = this.doc && this.selectedNodeId ? findNodeById(this.doc, this.selectedNodeId) : null;
    const canDelete = !!selectedNode && this.doc?.root.id !== selectedNode.id;
    const hasLink = !!selectedNode?.linkTarget?.trim();
    const canUndo = this.undoStack.length > 0;
    const canRedo = this.redoStack.length > 0;

    this.mobileDeleteButtonEl?.toggleClass("is-hidden", !canDelete);
    this.mobileDeleteButtonEl?.toggleAttribute("hidden", !canDelete);
    this.mobileLinkButtonEl?.toggleClass("is-hidden", !hasLink);
    this.mobileLinkButtonEl?.toggleAttribute("hidden", !hasLink);
    this.mobileUndoButtonEl?.toggleClass("is-disabled", !canUndo);
    this.mobileUndoButtonEl?.setAttribute("aria-disabled", canUndo ? "false" : "true");
    this.mobileUndoButtonEl?.removeAttribute("data-undo-count");
    this.mobileRedoButtonEl?.toggleClass("is-disabled", !canRedo);
    this.mobileRedoButtonEl?.setAttribute("aria-disabled", canRedo ? "false" : "true");
  }

  private async renderMarkdown(markdown: string): Promise<void> {
    this.notePreviewEl.empty();
    const trimmed = markdown.trim();
    if (!trimmed) {
      this.notePreviewEl.createDiv({
        cls: "mindmap-note-empty",
        text: "暂无内容"
      });
      return;
    }
    const prepared = this.prepareMarkdownForPreview(markdown);
    await MarkdownRenderer.renderMarkdown(prepared, this.notePreviewEl, this.file?.path ?? "", this);
    this.notePreviewEl.querySelectorAll("img").forEach((image) => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.addClass("mindmap-note-preview-image");
      image.onclick = () => {
        const overlay = document.body.createDiv({ cls: "mindmap-image-lightbox" });
        const closeButton = overlay.createEl("button", {
          cls: "mindmap-image-lightbox-close",
          text: "关闭"
        });
        closeButton.type = "button";
        const viewport = overlay.createDiv({ cls: "mindmap-image-lightbox-viewport" });
        const stage = viewport.createDiv({ cls: "mindmap-image-lightbox-stage" });
        const preview = stage.createEl("img", {
          cls: "mindmap-image-lightbox-image",
          attr: { src: image.src, alt: image.alt || "preview" }
        });
        const close = (): void => overlay.remove();
        closeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          event.preventDefault();
          close();
        });
        closeButton.addEventListener("touchend", (event) => {
          event.stopPropagation();
          event.preventDefault();
          close();
        }, { passive: false });
        viewport.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        stage.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        preview.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        overlay.addEventListener("click", close);
      };
    });
  }

  private scheduleMarkdownRender(markdown: string): void {
    window.setTimeout(() => {
      void this.renderMarkdown(markdown);
    }, 60);
  }

  private prepareMarkdownForPreview(markdown: string): string {
    return markdown.replace(/!\[\[([^\]]+)\]\]/g, (full, rawTarget: string) => {
      const target = rawTarget.split("|")[0]?.trim();
      if (!target) {
        return full;
      }
      const normalizedTarget = normalizePath(target);
      const resolvedByLink = this.app.metadataCache.getFirstLinkpathDest(target, this.file?.path ?? "");
      const resolvedByExactPath = this.app.vault.getAbstractFileByPath(normalizedTarget);
      const file = resolvedByLink instanceof TFile
        ? resolvedByLink
        : resolvedByExactPath instanceof TFile
          ? resolvedByExactPath
          : null;
      if (!(file instanceof TFile)) {
        return full;
      }
      const extension = file.extension.toLowerCase();
      const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
      if (!imageExtensions.has(extension)) {
        return full;
      }
      const resourceUrl = this.app.vault.getResourcePath(file);
      return `![](${resourceUrl})`;
    });
  }

  private updateDrawerWidth(): void {
    this.layoutEl?.style.setProperty("--mindmap-drawer-width", `${this.drawerWidth}px`);
  }

  private startDrawerResize(event: PointerEvent): void {
    if (this.isMobileLayout) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this.drawerWidth;

    this.drawerResizeHandleEl?.addClass("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent): void => {
      const delta = startX - moveEvent.clientX;
      this.drawerWidth = Math.min(
        MindmapView.MAX_DRAWER_WIDTH,
        Math.max(MindmapView.MIN_DRAWER_WIDTH, startWidth + delta)
      );
      this.updateDrawerWidth();
    };

    const onUp = (): void => {
      this.drawerResizeHandleEl?.removeClass("is-dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private playNodeActionSound(kind: "add" | "delete"): void {
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
    }
    const context = this.audioContext;
    if (context.state === "suspended") {
      void context.resume();
    }

    const now = context.currentTime + 0.01;
    const master = context.createGain();
    master.gain.setValueAtTime(kind === "add" ? 0.12 : 0.14, now);
    master.connect(context.destination);

    const createStrike = (frequency: number, duration: number, type: OscillatorType, detune = 0, gainAmount = 0.55): void => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.setValueAtTime(detune, now);
      gain.gain.setValueAtTime(gainAmount, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration);
    };

    createStrike(kind === "add" ? 960 : 780, kind === "add" ? 0.08 : 0.1, "triangle", kind === "add" ? 10 : -30, 0.42);
    createStrike(kind === "add" ? 1420 : 1120, kind === "add" ? 0.06 : 0.08, "sine", kind === "add" ? 24 : -14, 0.28);

    const noiseBuffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * 0.045)), context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
    }
    const noiseSource = context.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(kind === "add" ? 2400 : 1800, now);
    noiseFilter.Q.setValueAtTime(0.9, now);
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(kind === "add" ? 0.13 : 0.16, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noiseSource.start(now);
    noiseSource.stop(now + 0.05);

    master.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "add" ? 0.14 : 0.16));
  }

  private requestSave(): void {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      void this.flushSave();
    }, 250);
  }

  private async flushSave(): Promise<void> {
    if (!this.file || !this.doc) {
      return;
    }
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.isReloadingFromDisk = true;
    try {
      await this.app.vault.modify(this.file, JSON.stringify(this.doc, null, 2));
    } finally {
      window.setTimeout(() => {
        this.isReloadingFromDisk = false;
      }, 120);
    }
  }

  private async syncNow(): Promise<void> {
    await this.flushSave();
    new Notice("已立即写入文件，等待 iCloud 同步");
  }

  private async reloadFromDisk(showNotice: boolean): Promise<void> {
    if (!this.file) {
      return;
    }
    this.isReloadingFromDisk = true;
    try {
      await this.loadFromFile();
      if (!this.doc) {
        return;
      }
      if (this.selectedNodeId && !findNodeById(this.doc, this.selectedNodeId)) {
        this.selectedNodeId = this.doc.root.id;
      }
      if (this.editingNodeId && !findNodeById(this.doc, this.editingNodeId)) {
        this.editingNodeId = null;
      }
      this.renderMindmap();
      if (showNotice) {
        new Notice("已从磁盘重新加载导图");
      }
    } finally {
      window.setTimeout(() => {
        this.isReloadingFromDisk = false;
      }, 120);
    }
  }

  private async openLinkedTarget(rawPath: string): Promise<void> {
    const input = rawPath.trim();
    if (!input) {
      return;
    }

    if (/^https?:\/\//i.test(input)) {
      window.open(input, "_blank", "noopener,noreferrer");
      return;
    }

    if (input.startsWith("obsidian://")) {
      try {
        const url = new URL(input);
        const fileParam = url.searchParams.get("file");
        if (!fileParam) {
          new Notice(`无法解析链接：${input}`);
          return;
        }
        const decodedPath = normalizePath(decodeURIComponent(fileParam));
        await this.openInternalTarget(decodedPath, true);
        return;
      } catch {
        new Notice(`无法解析链接：${input}`);
        return;
      }
    }

    const normalizedInput = normalizePath(input);
    await this.openInternalTarget(normalizedInput, true);
  }

  private async openByLinkText(linktext: string, inNewTab: boolean): Promise<void> {
    const normalized = normalizePath(linktext);
    const sourcePath = this.file?.path ?? "";
    try {
      await this.app.workspace.openLinkText(normalized, sourcePath, inNewTab);
      const resolved = this.app.metadataCache.getFirstLinkpathDest(normalized, sourcePath);
      if (resolved instanceof TFile) {
        const currentPath = this.file?.path;
        if (currentPath && currentPath !== resolved.path) {
          this.navigationStack.push(currentPath);
        }
      }
    } catch {
      new Notice(`未找到目标文件：${normalized}`);
    }
  }

  private async openInternalTarget(path: string, inNewTab: boolean, focusLinkedFromPath = this.file?.path ?? null): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      await this.openByLinkText(path, inNewTab);
      return;
    }

    const currentPath = this.file?.path;
    if (currentPath && currentPath !== target.path) {
      this.navigationStack.push(currentPath);
    }

    const isMindmap = target.extension === "mindmap" || target.name.endsWith(".mindmap.json");
    if (isMindmap) {
      const existingLeaf = this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE).find((leaf) => {
        const view = leaf.view;
        if (!(view instanceof MindmapView)) {
          return false;
        }
        return view.getState().file === target.path;
      });
      const normalizedFocusLinkedFromPath = focusLinkedFromPath ? normalizePath(focusLinkedFromPath) : null;
      const targetLeaf = existingLeaf ?? (inNewTab ? this.app.workspace.getLeaf(true) : this.leaf);
      if (existingLeaf) {
        const view = existingLeaf.view;
        if (view instanceof MindmapView && normalizedFocusLinkedFromPath) {
          view.focusLinkedNodeFromPath(normalizedFocusLinkedFromPath);
        }
        this.app.workspace.revealLeaf(existingLeaf);
        return;
      }
      await targetLeaf.setViewState({
        type: MINDMAP_VIEW_TYPE,
        active: true,
        state: {
          file: target.path,
          focusLinkedFrom: normalizedFocusLinkedFromPath ?? undefined
        }
      });
      this.app.workspace.revealLeaf(targetLeaf);
      if (targetLeaf === this.leaf) {
        this.file = target;
        this.pendingFocusLinkedFromPath = normalizedFocusLinkedFromPath;
        await this.loadFromFile();
        this.closeDrawer();
        this.focusLinkedNodeFromPendingPath();
        this.renderMindmap();
      }
      return;
    }

    await this.app.workspace.openLinkText(target.path, this.file?.path ?? "", true);
  }

  private async goBackFromLinkedTarget(): Promise<void> {
    const previousPath = this.navigationStack.pop();
    if (!previousPath) {
      new Notice("没有可返回的上一个位置");
      return;
    }

    await this.openInternalTarget(previousPath, false, null);
  }

  private createChildNode(parentId: string): void {
    if (!this.doc) {
      return;
    }
    const parent = findNodeById(this.doc, parentId);
    if (!parent) {
      return;
    }
    const anchorNodeId = parent.id;
    this.closeDrawer();
    this.captureHistorySnapshot();
    const child = addChildNode(this.doc, parentId, {
      x: parent.x + 180,
      y: parent.y + (parent.children.length + 1) * 56
    });
    if (!child) {
      return;
    }
    this.captureHistorySnapshot();
    this.setSingleSelectedNode(child.id);
    this.editingNodeId = child.id;
    this.playNodeActionSound("add");
    this.normalizeLayoutKeepingNodePosition(anchorNodeId);
    this.requestSave();
    this.renderMindmap();
  }

  private createSiblingNode(nodeId: string): void {
    if (!this.doc) {
      return;
    }
    const parentLookup = findParentOfNode(this.doc, nodeId);
    if (!parentLookup) {
      this.createChildNode(nodeId);
      return;
    }
    const anchorNodeId = nodeId;
    const insertIndex = parentLookup.index + 1;
    this.closeDrawer();
    this.captureHistorySnapshot();
    const sibling = {
      id: crypto.randomUUID(),
      title: `新节点 ${parentLookup.parent.children.length + 1}`,
      x: parentLookup.parent.x + 180,
      y: parentLookup.parent.y + insertIndex * 72,
      children: []
    };
    parentLookup.parent.children.splice(insertIndex, 0, sibling);
    parentLookup.parent.collapsed = false;
    this.setSingleSelectedNode(sibling.id);
    this.editingNodeId = sibling.id;
    this.playNodeActionSound("add");
    this.normalizeLayoutKeepingNodePosition(anchorNodeId);
    this.requestSave();
    this.renderMindmap();
  }

  private async deleteNodeById(nodeId: string): Promise<void> {
    if (!this.doc) {
      return;
    }
    if (this.doc.root.id === nodeId) {
      new Notice("根节点不可删除");
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    const parentLookup = findParentOfNode(this.doc, nodeId);
    const anchorNodeId = parentLookup?.parent.id ?? this.doc.root.id;
    const accepted = window.confirm(`确认删除节点「${node.title}」及其子节点吗？`);
    if (!accepted) {
      return;
    }
    this.captureHistorySnapshot();
    const result = removeNode(this.doc, nodeId);
    if (!result) {
      new Notice("删除失败：未找到节点");
      return;
    }
    const shouldCloseDrawer = this.selectedNodeId === nodeId;
    this.selectedNodeId = result.parent.id;
    this.playNodeActionSound("delete");
    if (shouldCloseDrawer) {
      this.closeDrawer();
    }
    this.normalizeLayoutKeepingNodePosition(anchorNodeId);
    this.requestSave();
    this.renderMindmap();
  }

  private openNodeMenu(event: MouseEvent, nodeId: string): void {
    const node = this.doc ? findNodeById(this.doc, nodeId) : null;
    const linkTarget = node?.linkTarget?.trim() ?? "";
    const hasLink = linkTarget.length > 0;
    const canPaste = !!node && this.hasClipboardSubtree();
    const isRootNode = !!node && this.doc?.root.id === node.id;
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("查看").setIcon("file-text").onClick(() => {
        void this.openDrawer(nodeId);
      });
    });
    if (!isRootNode) {
      menu.addItem((item) => {
        item.setTitle("关联").setIcon("link").onClick(() => {
          this.openMindmapAssociationModal(nodeId);
        });
      });
    }
    // menu.addItem((item) => {
    //   item.setTitle("添加子节点").setIcon("plus").onClick(() => {
    //     this.createChildNode(nodeId);
    //   });
    // });
    // menu.addItem((item) => {
    //   item.setTitle("重命名节点").setIcon("pencil").onClick(() => {
    //     this.renameNode(nodeId);
    //   });
    // });
    // if (canPaste) {
    //   menu.addItem((item) => {
    //     item.setTitle("粘贴为子节点").setIcon("clipboard-paste").onClick(() => {
    //       this.pasteClipboardSubtreeToNode(nodeId);
    //     });
    //   });
    // }
    if (hasLink) {
      menu.addItem((item) => {
        item.setTitle("跳转").setIcon("arrow-up-right").onClick(() => {
          void this.openLinkedTarget(linkTarget);
        });
      });
    }
    // menu.addItem((item) => {
    //   item
    //     .setTitle("删除节点")
    //     .setIcon("trash")
    //     .onClick(() => {
    //       void this.deleteNodeById(nodeId);
    //     });
    // });
    menu.showAtMouseEvent(event);
    window.requestAnimationFrame(() => {
      document.body.querySelectorAll(".menu").forEach((menuEl) => {
        menuEl.addClass("mindmap-node-menu");
      });
    });
  }

  private clearNodeLink(nodeId: string): void {
    if (!this.doc) {
      return;
    }
    const node = findNodeById(this.doc, nodeId);
    if (!node) {
      return;
    }
    node.linkTarget = "";
    if (this.selectedNodeId === nodeId) {
      this.nodeLinkInputEl.value = "";
    }
    this.requestSave();
    this.renderMindmap();
  }

  private renameNode(nodeId: string): void {
    this.startInlineNodeEdit(nodeId);
  }

  private getDocumentPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svgEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panOffset.x) / this.zoomScale,
      y: (clientY - rect.top - this.panOffset.y) / this.zoomScale
    };
  }

  private getCanvasClientPoint(docX: number, docY: number): { x: number; y: number } {
    return {
      x: docX * this.zoomScale + this.panOffset.x,
      y: docY * this.zoomScale + this.panOffset.y
    };
  }

  private zoomAt(clientX: number, clientY: number, zoomDelta: number): void {
    const rect = this.svgEl.getBoundingClientRect();
    const beforeX = (clientX - rect.left - this.panOffset.x) / this.zoomScale;
    const beforeY = (clientY - rect.top - this.panOffset.y) / this.zoomScale;
    const nextScale = Math.min(
      MindmapView.MAX_ZOOM_SCALE,
      Math.max(MindmapView.MIN_ZOOM_SCALE, this.zoomScale * (1 + zoomDelta))
    );
    this.applyZoomFromPoint(clientX, clientY, beforeX, beforeY, nextScale);
  }

  private setZoomAt(clientX: number, clientY: number, nextScale: number): void {
    const rect = this.svgEl.getBoundingClientRect();
    const beforeX = (clientX - rect.left - this.panOffset.x) / this.zoomScale;
    const beforeY = (clientY - rect.top - this.panOffset.y) / this.zoomScale;
    this.applyZoomFromPoint(clientX, clientY, beforeX, beforeY, nextScale);
  }

  private applyZoomFromPoint(
    clientX: number,
    clientY: number,
    beforeX: number,
    beforeY: number,
    nextScale: number
  ): void {
    if (Math.abs(nextScale - this.zoomScale) < 0.0001) {
      return;
    }
    const rect = this.svgEl.getBoundingClientRect();
    this.zoomScale = nextScale;
    this.panOffset.x = clientX - rect.left - beforeX * this.zoomScale;
    this.panOffset.y = clientY - rect.top - beforeY * this.zoomScale;
    this.updateViewportTransform();
    this.updateMarqueeOverlay();
  }

  private getTouchDistance(first: Touch, second: Touch): number {
    const deltaX = first.clientX - second.clientX;
    const deltaY = first.clientY - second.clientY;
    return Math.hypot(deltaX, deltaY);
  }

  private countVisibleLeaves(node: MindmapNode): number {
    if (node.collapsed || node.children.length === 0) {
      return 1;
    }
    return node.children.reduce((sum, child) => sum + this.countVisibleLeaves(child), 0);
  }

  private normalizeLayout(): void {
    if (!this.doc) {
      return;
    }
    this.autoLayoutTree();
  }

  private normalizeLayoutKeepingNodePosition(anchorNodeId: string): void {
    if (!this.doc) {
      return;
    }
    const anchorNode = findNodeById(this.doc, anchorNodeId);
    if (!anchorNode) {
      this.autoLayoutTree();
      return;
    }
    const previousPosition = { x: anchorNode.x, y: anchorNode.y };
    this.autoLayoutTree();
    const nextAnchorNode = findNodeById(this.doc, anchorNodeId);
    if (!nextAnchorNode) {
      return;
    }
    const deltaX = previousPosition.x - nextAnchorNode.x;
    const deltaY = previousPosition.y - nextAnchorNode.y;
    if (Math.abs(deltaX) < 0.01 && Math.abs(deltaY) < 0.01) {
      return;
    }
    visibleNodes(this.doc.root).forEach((node) => {
      node.x += deltaX;
      node.y += deltaY;
    });
  }

  private centerViewportOnRoot(root: MindmapNode, nodes: MindmapNode[]): void {
    if (!nodes.length) {
      this.panOffset = { x: 0, y: 0 };
      this.zoomScale = 1;
      return;
    }

    const canvasRect = this.canvasEl.getBoundingClientRect();
    const viewportWidth = Math.max(1, canvasRect.width);
    const viewportHeight = Math.max(1, canvasRect.height);
    const rootSize = this.ensureNodeSize(root);

    let maxVisibleWidth = rootSize.width;
    nodes.forEach((node) => {
      const size = this.ensureNodeSize(node);
      maxVisibleWidth = Math.max(maxVisibleWidth, size.width);
    });

    const horizontalPadding = this.isMobileLayout ? 32 : 80;
    const targetVisibleWidth = Math.max(rootSize.width * 2.8, maxVisibleWidth * 1.35);
    const fitScale = Math.min(1.15, Math.max(0.55, (viewportWidth - horizontalPadding * 2) / targetVisibleWidth));

    this.zoomScale = fitScale;
    this.panOffset.x = viewportWidth / 2 - root.x * this.zoomScale;
    this.panOffset.y = viewportHeight / 2 - root.y * this.zoomScale;
  }

  private centerViewportOnNodes(nodes: MindmapNode[]): void {
    if (!nodes.length) {
      this.panOffset = { x: 0, y: 0 };
      this.zoomScale = 1;
      return;
    }

    const canvasRect = this.canvasEl.getBoundingClientRect();
    const viewportWidth = Math.max(1, canvasRect.width);
    const viewportHeight = Math.max(1, canvasRect.height);

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    nodes.forEach((node) => {
      const size = this.ensureNodeSize(node);
      minX = Math.min(minX, node.x - size.width / 2);
      maxX = Math.max(maxX, node.x + size.width / 2);
      minY = Math.min(minY, node.y - size.height / 2);
      maxY = Math.max(maxY, node.y + size.height / 2);
    });

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = this.isMobileLayout ? 28 : 56;
    const availableWidth = Math.max(1, viewportWidth - padding * 2);
    const availableHeight = Math.max(1, viewportHeight - padding * 2);
    const fitScale = Math.min(
      MindmapView.MAX_ZOOM_SCALE,
      Math.max(MindmapView.MIN_ZOOM_SCALE, Math.min(availableWidth / contentWidth, availableHeight / contentHeight))
    );

    this.zoomScale = fitScale;
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    this.panOffset.x = viewportWidth / 2 - contentCenterX * this.zoomScale;
    this.panOffset.y = viewportHeight / 2 - contentCenterY * this.zoomScale;
  }

  private autoLayoutTree(): void {
    if (!this.doc) {
      return;
    }
    const horizontalGap = 60;
    const verticalGap = 34;
    const root = this.doc.root;
    const anchoredRootY = root.y;

    const measureSubtreeHeight = (node: MindmapNode): number => {
      const nodeHeight = this.ensureNodeSize(node).height;
      if (node.collapsed || node.children.length === 0) {
        return nodeHeight;
      }
      const childrenHeight = node.children.reduce((sum, child, index) => {
        const childHeight = measureSubtreeHeight(child);
        return sum + childHeight + (index > 0 ? verticalGap : 0);
      }, 0);
      return Math.max(nodeHeight, childrenHeight);
    };

    const place = (
      node: MindmapNode,
      topY: number,
      parent: MindmapNode | null
    ): number => {
      const size = this.ensureNodeSize(node);
      const subtreeHeight = measureSubtreeHeight(node);

      if (parent) {
        const parentSize = this.ensureNodeSize(parent);
        node.x = parent.x + parentSize.width / 2 + horizontalGap + size.width / 2;
      } else {
        node.x = root.x;
      }

      if (node.collapsed || node.children.length === 0) {
        node.y = topY + subtreeHeight / 2;
        return subtreeHeight;
      }

      let childTop = topY;
      const childCenters: number[] = [];
      node.children.forEach((child, index) => {
        const childHeight = measureSubtreeHeight(child);
        place(child, childTop, node);
        childCenters.push(child.y);
        childTop += childHeight;
        if (index < node.children.length - 1) {
          childTop += verticalGap;
        }
      });

      const childrenMidY = childCenters.length > 0
        ? (childCenters[0] + childCenters[childCenters.length - 1]) / 2
        : topY + subtreeHeight / 2;
      node.y = childrenMidY;

      if (size.height > subtreeHeight) {
        node.y = topY + size.height / 2;
        return size.height;
      }

      return subtreeHeight;
    };

    const totalHeight = Math.max(this.ensureNodeSize(root).height, measureSubtreeHeight(root));
    place(root, anchoredRootY - totalHeight / 2, null);
    const rootShiftY = anchoredRootY - root.y;
    if (Math.abs(rootShiftY) > 0.001) {
      visibleNodes(root).forEach((node) => {
        node.y += rootShiftY;
      });
    }
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    if (!event.clipboardData) {
      return;
    }

    const imageItems = Array.from(event.clipboardData.items).filter((item) =>
      item.type.startsWith("image/")
    );
    if (imageItems.length === 0) {
      return;
    }

    event.preventDefault();

    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      const markdownLink = await this.savePastedImage(file);
      if (!markdownLink) {
        continue;
      }
      this.insertTextAtCursor(`\n${markdownLink}\n`);
    }
    this.noteInputEl.dispatchEvent(new Event("input"));
    const latestMarkdown = this.noteInputEl.value;
    window.setTimeout(() => {
      if (this.noteInputEl?.value === latestMarkdown) {
        void this.renderMarkdown(latestMarkdown);
      }
    }, 180);
    window.setTimeout(() => {
      if (this.noteInputEl?.value === latestMarkdown) {
        void this.renderMarkdown(latestMarkdown);
      }
    }, 600);
  }

  private insertTextAtCursor(text: string): void {
    const input = this.noteInputEl;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, "end");
  }

  private indentNoteSelection(outdent: boolean): void {
    const input = this.noteInputEl;
    const value = input.value;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextLineBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    const selectedBlock = value.slice(lineStart, lineEnd);
    const lines = selectedBlock.split("\n");

    if (!outdent) {
      const indentedLines = lines.map((line) => `\t${line}`);
      const replacement = indentedLines.join("\n");
      input.setRangeText(replacement, lineStart, lineEnd, "preserve");
      const isSingleCursor = selectionStart === selectionEnd;
      if (isSingleCursor) {
        const nextPosition = selectionStart + 1;
        input.setSelectionRange(nextPosition, nextPosition);
      } else {
        input.setSelectionRange(selectionStart + 1, selectionEnd + lines.length);
      }
    } else {
      let removedBeforeStart = 0;
      let removedWithinSelection = 0;
      const outdentedLines = lines.map((line, index) => {
        if (line.startsWith("\t")) {
          if (index === 0) {
            removedBeforeStart = 1;
          }
          removedWithinSelection += 1;
          return line.slice(1);
        }
        if (line.startsWith("  ")) {
          if (index === 0) {
            removedBeforeStart = 2;
          }
          removedWithinSelection += 2;
          return line.slice(2);
        }
        return line;
      });
      const replacement = outdentedLines.join("\n");
      input.setRangeText(replacement, lineStart, lineEnd, "preserve");
      const isSingleCursor = selectionStart === selectionEnd;
      if (isSingleCursor) {
        const nextPosition = Math.max(lineStart, selectionStart - removedBeforeStart);
        input.setSelectionRange(nextPosition, nextPosition);
      } else {
        input.setSelectionRange(
          Math.max(lineStart, selectionStart - removedBeforeStart),
          Math.max(lineStart, selectionEnd - removedWithinSelection)
        );
      }
    }

    input.dispatchEvent(new Event("input"));
  }

  private async savePastedImage(file: File): Promise<string | null> {
    if (!this.file) {
      new Notice("请先保存导图文件后再粘贴图片");
      return null;
    }

    const extFromType = file.type.split("/")[1] || "png";
    const normalizedExt = extFromType === "jpeg" ? "jpg" : extFromType;
    const baseName = `粘贴图片-${Date.now()}.${normalizedExt}`;
    const parentPath = this.file.parent?.path ?? "";
    const targetPath = await this.app.fileManager.getAvailablePathForAttachment(baseName, parentPath);
    const buffer = await file.arrayBuffer();
    await this.app.vault.createBinary(targetPath, buffer);
    return `![[${targetPath}]]`;
  }

  private setNoteEditing(editing: boolean): void {
    if (editing === this.noteSurfaceEl.hasClass("is-editing")) {
      return;
    }
    this.noteSurfaceEl.toggleClass("is-editing", editing);
    this.noteModeToggleEl.setText(editing ? "预览" : "编辑");
    this.updateMobileActionClusterVisibility();
    if (editing) {
      this.notePreviewEl.addClass("is-live-hidden");
      window.setTimeout(() => this.noteInputEl.focus({ preventScroll: true }), 0);
      return;
    }
    this.noteInputEl.blur();
    this.notePreviewEl.removeClass("is-live-hidden");
    this.focusContainerWithoutScroll();
  }

  private closeDrawer(): void {
    this.drawerEl.addClass("is-hidden");
    this.layoutEl.removeClass("has-drawer");
    this.noteHistoryCapturedForSession = false;
    this.linkHistoryCapturedForSession = false;
    this.setNoteEditing(false);
    this.updateMobileActionClusterVisibility();
  }

  private clearCanvasSelection(): void {
    if (this.selectedNodeId === null && this.editingNodeId === null && this.selectedNodeIds.size === 0) {
      return;
    }
    this.selectedNodeId = null;
    this.selectedNodeIds.clear();
    this.editingNodeId = null;
    this.closeMobileNodeTooltip();
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
  }

  private updateMobileActionClusterVisibility(): void {
    if (!this.isMobileLayout || !this.mobileActionClusterEl) {
      return;
    }
    const noteInputFocused = document.activeElement === this.noteInputEl;
    const noteDrawerEditing = !this.drawerEl?.hasClass("is-hidden") && this.noteSurfaceEl?.hasClass("is-editing");
    const hidden = this.editingNodeId !== null || noteInputFocused || noteDrawerEditing;
    this.mobileActionClusterEl.toggleClass("is-editing-hidden", hidden);
    this.mobileNodeTooltipEl?.toggleClass("is-editing-hidden", hidden);
    this.mobileGlobalActionClusterEl?.toggleClass("is-editing-hidden", hidden);
  }

  private setMobileActionClusterEditingHidden(hidden: boolean): void {
    if (!this.isMobileLayout || !this.mobileActionClusterEl) {
      return;
    }
    this.mobileActionClusterEl.toggleClass("is-editing-hidden", hidden);
    this.mobileGlobalActionClusterEl?.toggleClass("is-editing-hidden", hidden);
  }

  private setSingleSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.selectedNodeIds = nodeId ? new Set([nodeId]) : new Set();
    if (nodeId !== this.editingNodeId) {
      this.editingNodeId = null;
    }
    if (nodeId !== this.mobileTooltipNodeId) {
      this.closeMobileNodeTooltip();
    }
    this.updateMobileActionClusterVisibility();
    void this.syncOpenDrawerWithSelection();
  }

  private startInlineNodeEdit(nodeId: string): void {
    if (this.pendingNodeSelectionTimer) {
      window.clearTimeout(this.pendingNodeSelectionTimer);
      this.pendingNodeSelectionTimer = null;
    }
    this.closeDrawer();
    this.selectedNodeId = nodeId;
    this.selectedNodeIds = new Set([nodeId]);
    this.editingNodeId = nodeId;
    this.updateMobileActionClusterVisibility();
    this.renderMindmap();
  }

  private appendInlineTitleEditor(
    group: SVGGElement,
    node: MindmapNode,
    width: number,
    height: number
  ): void {
    const isMobileInlineEdit = this.isMobileLayout;
    const horizontalInset = isMobileInlineEdit ? 6 : 8;
    const verticalInset = isMobileInlineEdit ? 5 : 7;
    const editorHeight = isMobileInlineEdit ? height - 10 : height - 14;
    const foreignObject = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    foreignObject.setAttribute("x", String(-width / 2 + horizontalInset));
    foreignObject.setAttribute("y", String(-height / 2 + verticalInset));
    foreignObject.setAttribute("width", String(width - horizontalInset * 2));
    foreignObject.setAttribute("height", String(editorHeight));

    const input = document.createElement("input");
    input.className = "mindmap-node-inline-input";
    input.value = node.title;
    input.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());

    const restoreMindmapKeyboardFocus = (): void => {
      this.activateMindmapLeaf();
      this.focusContainerWithoutScroll();
      window.setTimeout(() => this.focusContainerWithoutScroll(), 0);
    };

    const commit = (): void => {
      void (async () => {
        if (!this.doc) {
          this.editingNodeId = null;
          this.updateMobileActionClusterVisibility();
          this.renderMindmap();
          restoreMindmapKeyboardFocus();
          return;
        }
        const nextValue = input.value.trim();
        if (nextValue && nextValue !== node.title) {
          this.captureHistorySnapshot();
          node.title = nextValue;
          if (node.id === this.doc.root.id) {
            await this.renameMindmapFileToMatchRootTitle(nextValue);
          }
        }
        if (node.id === this.doc.root.id) {
          this.refreshTabTitle();
        }
        this.editingNodeId = null;
        this.setSingleSelectedNode(node.id);
        this.normalizeLayoutKeepingNodePosition(node.id);
        this.requestSave();
        this.renderMindmap();
        restoreMindmapKeyboardFocus();
      })();
    };

    const cancel = (): void => {
      this.editingNodeId = null;
      this.setSingleSelectedNode(node.id);
      this.renderMindmap();
      restoreMindmapKeyboardFocus();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => {
      commit();
    });

    foreignObject.appendChild(input);
    group.appendChild(foreignObject);

    window.setTimeout(() => {
      input.focus({ preventScroll: true });
      const caretPosition = input.value.length;
      input.setSelectionRange(caretPosition, caretPosition);
    }, 0);
  }

  private startResize(event: PointerEvent, node: MindmapNode): void {
    if (!this.doc) {
      return;
    }
    const size = this.ensureNodeSize(node);
    const startPoint = this.getDocumentPoint(event.clientX, event.clientY);
    const startSize = { width: size.width, height: size.height };
    const snapshotBeforeResize = this.cloneDocument(this.doc);
    let didResize = false;

    const onMove = (moveEvent: PointerEvent): void => {
      const point = this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY);
      const deltaX = point.x - startPoint.x;
      const deltaY = point.y - startPoint.y;
      node.width = Math.max(MindmapView.MIN_NODE_WIDTH, startSize.width + deltaX);
      node.height = Math.max(MindmapView.MIN_NODE_HEIGHT, startSize.height + deltaY);
      node.manualSize = true;
      didResize = didResize || node.width !== startSize.width || node.height !== startSize.height;
      this.normalizeLayoutKeepingNodePosition(node.id);
      this.renderMindmap();
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (didResize) {
        this.pushHistoryState(snapshotBeforeResize);
      }
      this.requestSave();
      this.renderMindmap();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private ensureNodeSize(node: MindmapNode): { width: number; height: number } {
    const autoWidth = MindmapView.DEFAULT_NODE_WIDTH;
    const autoHeight = this.measureAutoHeight(node.title, autoWidth);

    const width = node.manualSize && typeof node.width === "number"
      ? Math.max(MindmapView.MIN_NODE_WIDTH, node.width)
      : autoWidth;
    const height = node.manualSize && typeof node.height === "number"
      ? Math.max(MindmapView.MIN_NODE_HEIGHT, node.height)
      : Math.max(MindmapView.MIN_NODE_HEIGHT, autoHeight);

    if (node.width !== width || node.height !== height || node.manualSize !== !!node.manualSize) {
      node.width = width;
      node.height = height;
      node.manualSize = !!node.manualSize;
    }

    return { width, height };
  }

  private measureAutoHeight(title: string, width: number): number {
    const content = title.trim() || " ";
    const ctx = this.textMeasureCanvas.getContext("2d");
    if (!ctx) {
      return MindmapView.DEFAULT_NODE_HEIGHT;
    }
    ctx.font = '600 15px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    const maxLineWidth = Math.max(64, width - 28);
    const paragraphs = content.split("\n");
    let totalLines = 0;

    paragraphs.forEach((paragraph) => {
      const text = paragraph.length === 0 ? " " : paragraph;
      let current = "";
      for (const ch of text) {
        const test = current + ch;
        if (ctx.measureText(test).width <= maxLineWidth || current.length === 0) {
          current = test;
          continue;
        }
        totalLines += 1;
        current = ch;
      }
      totalLines += 1;
    });

    const lineHeight = 15 * 1.45;
    const verticalPadding = 20;
    return Math.max(MindmapView.DEFAULT_NODE_HEIGHT, Math.ceil(totalLines * lineHeight + verticalPadding));
  }
}
