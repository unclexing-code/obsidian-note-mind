import { ItemView, MarkdownRenderer, Menu, Notice, Platform, TFile, normalizePath } from "obsidian";
import { addChildNode, findNodeById, findParentOfNode, normalizeMindmapDocument, removeNode, reorderNodeWithinParent, reparentNode, visibleNodes } from "./store";
export const MINDMAP_VIEW_TYPE = "mindmap-view";
export class MindmapView extends ItemView {
    constructor() {
        super(...arguments);
        this.file = null;
        this.doc = null;
        this.selectedNodeId = null;
        this.selectedNodeIds = new Set();
        this.editingNodeId = null;
        this.saveTimer = null;
        this.pendingRenderFrame = null;
        this.pendingNodeSelectionTimer = null;
        this.isDragging = false;
        this.dropTargetNodeId = null;
        this.draggingNodeIds = new Set();
        this.dragOffset = { x: 0, y: 0 };
        this.panOffset = { x: 0, y: 0 };
        this.zoomScale = 1;
        this.drawerWidth = MindmapView.DEFAULT_DRAWER_WIDTH;
        this.isMobileLayout = Platform.isMobile;
        this.pinchStartDistance = null;
        this.pinchStartScale = 1;
        this.touchPanStart = null;
        this.zenTapCandidate = null;
        this.lastZenNodeTap = null;
        this.audioContext = null;
        this.isReloadingFromDisk = false;
        this.blockEdgeSidebarGesture = false;
        this.isZenMode = false;
        this.navigationStack = [];
        this.shouldCenterOnNextRender = false;
        this.shouldFocusRootOnNextRender = false;
        this.textMeasureCanvas = document.createElement("canvas");
        this.marqueeSelection = null;
        this.mobileCanvasLongPressTimer = null;
        this.pendingCanvasPanStart = null;
        this.mobileLongPressMarqueeActive = false;
        this.onKeydown = (event) => {
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
            if (!this.doc || !this.selectedNodeId) {
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
            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                void this.deleteNodeById(this.selectedNodeId);
            }
        };
        this.onContainerZenTouchStart = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element &&
                target.closest(".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onContainerZenTouchMove = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element &&
                target.closest(".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onContainerZenTouchEnd = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element &&
                target.closest(".mindmap-canvas, .mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onWindowTouchStart = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element && target.closest(".mindmap-canvas")) {
                event.stopPropagation();
                event.preventDefault();
                this.handleZenCanvasTouchStart(event);
                return;
            }
            if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onWindowTouchMove = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element && target.closest(".mindmap-canvas")) {
                event.stopPropagation();
                event.preventDefault();
                this.handleZenCanvasTouchMove(event);
                return;
            }
            if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onWindowTouchEnd = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            const target = event.target;
            if (target instanceof Element && target.closest(".mindmap-canvas")) {
                event.stopPropagation();
                event.preventDefault();
                this.handleZenCanvasTouchEnd(event);
                return;
            }
            if (target instanceof Element && target.closest(".mindmap-mobile-action-cluster, .mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input, .mindmap-image-lightbox")) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onWindowWheel = (event) => {
            if (!this.isZenMode || !this.isMobileLayout) {
                return;
            }
            if (this.shouldAllowZenGestureTarget(event.target)) {
                return;
            }
            event.stopPropagation();
            event.preventDefault();
        };
        this.onWheelPan = (event) => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                this.zoomAt(event.clientX, event.clientY, -event.deltaY * 0.0015);
                return;
            }
            this.panOffset.x -= event.deltaX;
            this.panOffset.y -= event.deltaY;
            this.renderMindmap();
        };
        this.onTouchStart = (event) => {
            if (this.isZenMode && this.isMobileLayout) {
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
            if (target instanceof Element) {
                const isInteractiveControl = !!target.closest(".mindmap-collapse-group, .mindmap-jump-group, .mindmap-mobile-action-cluster, .mindmap-drawer");
                if (isInteractiveControl) {
                    this.clearMobileCanvasLongPressTimer();
                    this.touchPanStart = null;
                    this.pendingCanvasPanStart = null;
                    return;
                }
                if (target.closest(".mindmap-node-group, .mindmap-resize-handle")) {
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
                panY: this.panOffset.y
            };
            const startPoint = this.getDocumentPoint(first.clientX, first.clientY);
            this.clearMobileCanvasLongPressTimer();
            this.mobileCanvasLongPressTimer = window.setTimeout(() => {
                this.mobileCanvasLongPressTimer = null;
                this.beginSelectionMarquee(startPoint.x, startPoint.y);
            }, 360);
        };
        this.onTouchMove = (event) => {
            if (this.isZenMode && this.isMobileLayout) {
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
                const nextScale = Math.min(2.8, Math.max(0.4, this.pinchStartScale * (nextDistance / this.pinchStartDistance)));
                this.setZoomAt(centerX, centerY, nextScale);
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
                }
            }
            if (!this.touchPanStart) {
                return;
            }
            event.preventDefault();
            this.panOffset.x = this.touchPanStart.panX + (first.clientX - this.touchPanStart.x);
            this.panOffset.y = this.touchPanStart.panY + (first.clientY - this.touchPanStart.y);
            this.renderMindmap();
        };
        this.onTouchEnd = () => {
            if (this.isZenMode && this.isMobileLayout) {
                return;
            }
            this.clearMobileCanvasLongPressTimer();
            if (this.mobileLongPressMarqueeActive) {
                this.finishSelectionMarquee();
            }
            this.pinchStartDistance = null;
            this.touchPanStart = null;
            this.pendingCanvasPanStart = null;
            this.blockEdgeSidebarGesture = this.isZenMode;
        };
        this.onCanvasPointerDown = (event) => {
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
            const clearSelection = () => {
                if (this.selectedNodeId !== null || this.editingNodeId !== null || this.selectedNodeIds.size > 0) {
                    this.selectedNodeId = null;
                    this.selectedNodeIds.clear();
                    this.editingNodeId = null;
                    this.renderMindmap();
                }
            };
            const finishMarquee = () => {
                if (!this.doc || !this.marqueeSelection) {
                    return;
                }
                const selectedIds = this.getNodesInMarquee(this.marqueeSelection);
                this.selectedNodeIds = selectedIds;
                this.selectedNodeId = selectedIds.size === 1 ? Array.from(selectedIds)[0] ?? null : null;
                this.editingNodeId = null;
                this.renderMindmap();
            };
            const onMove = (moveEvent) => {
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
            const onUp = () => {
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
        this.onCanvasDoubleClick = (event) => {
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
    }
    shouldIgnoreMindmapShortcuts(event) {
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
    activateMindmapLeaf() {
        this.app.workspace.revealLeaf(this.leaf);
        void this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
        this.focusContainerWithoutScroll();
    }
    focusContainerWithoutScroll() {
        this.containerEl.focus({ preventScroll: true });
    }
    clearMobileCanvasLongPressTimer() {
        if (this.mobileCanvasLongPressTimer !== null) {
            window.clearTimeout(this.mobileCanvasLongPressTimer);
            this.mobileCanvasLongPressTimer = null;
        }
    }
    beginSelectionMarquee(startX, startY) {
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
    finishSelectionMarquee() {
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
    setZenMode(enabled) {
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
    unlockMobileZenWhenViewportChanges() {
        if (!this.isMobileLayout || !this.isZenMode) {
            return;
        }
        const activeView = this.app.workspace.getActiveViewOfType(ItemView);
        if (activeView !== this) {
            this.setZenMode(false);
        }
    }
    handleZenCanvasTouchStart(event) {
        const first = event.touches.item(0);
        const second = event.touches.item(1);
        if (first && second) {
            this.touchPanStart = null;
            this.blockEdgeSidebarGesture = false;
            this.zenTapCandidate = null;
            this.pinchStartDistance = this.getTouchDistance(first, second);
            this.pinchStartScale = this.zoomScale;
            return;
        }
        if (!first) {
            this.pinchStartDistance = null;
            this.zenTapCandidate = null;
            return;
        }
        const target = event.target;
        if (target instanceof Element) {
            const isInteractiveControl = !!target.closest(".mindmap-jump-group, .mindmap-mobile-action-cluster, .mindmap-drawer");
            if (isInteractiveControl) {
                this.touchPanStart = null;
                this.zenTapCandidate = null;
                return;
            }
            const collapseGroup = target.closest(".mindmap-collapse-group");
            if (collapseGroup) {
                const nodeGroup = collapseGroup.closest(".mindmap-node-group");
                const nodeId = nodeGroup?.dataset.id ?? null;
                this.touchPanStart = null;
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
            const nodeGroup = target.closest(".mindmap-node-group");
            if (nodeGroup) {
                const nodeId = nodeGroup.dataset.id ?? null;
                this.touchPanStart = null;
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
        this.touchPanStart = {
            x: first.clientX,
            y: first.clientY,
            panX: this.panOffset.x,
            panY: this.panOffset.y
        };
    }
    handleZenCanvasTouchMove(event) {
        const first = event.touches.item(0);
        const second = event.touches.item(1);
        if (first && second && this.pinchStartDistance !== null) {
            this.zenTapCandidate = null;
            const nextDistance = this.getTouchDistance(first, second);
            if (nextDistance <= 0) {
                return;
            }
            const centerX = (first.clientX + second.clientX) / 2;
            const centerY = (first.clientY + second.clientY) / 2;
            const nextScale = Math.min(2.8, Math.max(0.4, this.pinchStartScale * (nextDistance / this.pinchStartDistance)));
            this.setZoomAt(centerX, centerY, nextScale);
            return;
        }
        if (first && this.zenTapCandidate) {
            const moveDistance = Math.hypot(first.clientX - this.zenTapCandidate.x, first.clientY - this.zenTapCandidate.y);
            if (moveDistance > 10) {
                this.zenTapCandidate = null;
            }
        }
        if (!first || !this.touchPanStart) {
            return;
        }
        this.panOffset.x = this.touchPanStart.panX + (first.clientX - this.touchPanStart.x);
        this.panOffset.y = this.touchPanStart.panY + (first.clientY - this.touchPanStart.y);
        this.renderMindmap();
    }
    handleZenCanvasTouchEnd(event) {
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
        const tapCandidate = this.zenTapCandidate;
        this.zenTapCandidate = null;
        this.pinchStartDistance = null;
        this.touchPanStart = null;
        this.blockEdgeSidebarGesture = true;
        if (!tapCandidate || !tapCandidate.nodeId || !this.doc) {
            return;
        }
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
    }
    shouldAllowZenGestureTarget(target) {
        if (!(target instanceof Element)) {
            return false;
        }
        return !!target.closest(".mindmap-drawer, .mindmap-note-preview, .mindmap-note-input, .mindmap-node-title-input, .mindmap-node-link-input");
    }
    getViewType() {
        return MINDMAP_VIEW_TYPE;
    }
    getDisplayText() {
        const mindmapTitle = this.doc?.root.title.trim();
        return mindmapTitle && mindmapTitle.length > 0
            ? mindmapTitle
            : this.file?.basename ?? "Mindmap";
    }
    refreshTabTitle() {
        const leaf = this.leaf;
        leaf.updateHeader?.();
    }
    getIcon() {
        return "network";
    }
    async onOpen() {
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
        //     void this.syncNow();
        // });
        // this.desktopRefreshButtonEl = this.desktopActionClusterEl.createEl("button", { cls: "mindmap-desktop-refresh-button", text: "刷新" });
        // this.desktopRefreshButtonEl.type = "button";
        // this.desktopRefreshButtonEl.addEventListener("click", () => {
        //     void this.reloadFromDisk(true);
        // });
        this.mobileActionClusterEl = this.containerEl.createDiv({ cls: "mindmap-mobile-action-cluster" });
        const mobileActionClusterEl = this.mobileActionClusterEl;
        // 增加“新增节点”按钮
        this.mobileAddButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-add-button", text: "+" });
        this.mobileAddButtonEl.type = "button";
        this.mobileAddButtonEl.addEventListener("click", () => {
            const targetId = this.selectedNodeId ?? this.doc?.root.id;
            if (targetId) {
                this.createChildNode(targetId);
            }
        });
        // 增加“删除节点”按钮
        this.mobileDeleteButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-delete-button", text: "-" });
        this.mobileDeleteButtonEl.type = "button";
        this.mobileDeleteButtonEl.addEventListener("click", () => {
            if (this.selectedNodeId && this.doc && this.selectedNodeId !== this.doc.root.id) {
                void this.deleteNodeById(this.selectedNodeId);
            }
        });
        this.mobileLinkButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-link-button", text: "跳转" });
        this.mobileLinkButtonEl.type = "button";
        this.mobileLinkButtonEl.addEventListener("click", () => {
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
        this.mobileSyncButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-sync-button", text: "同步" });
        this.mobileSyncButtonEl.type = "button";
        this.mobileSyncButtonEl.addEventListener("click", () => {
            void this.syncNow();
        });
        this.mobileRefreshButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-refresh-button", text: "刷新" });
        this.mobileRefreshButtonEl.type = "button";
        this.mobileRefreshButtonEl.addEventListener("click", () => {
            void this.reloadFromDisk(true);
        });
        this.mobileNoteButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-note-button", text: "📋" });
        this.mobileNoteButtonEl.type = "button";
        this.mobileNoteButtonEl.addEventListener("click", () => {
            if (this.selectedNodeId) {
                void this.openDrawer(this.selectedNodeId);
            }
        });
        this.mobileCenterButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-center-button", text: "⦿" });
        this.mobileCenterButtonEl.type = "button";
        this.mobileCenterButtonEl.addEventListener("click", () => {
            if (!this.doc) {
                return;
            }
            this.centerViewportOnRoot(this.doc.root, visibleNodes(this.doc.root));
            this.renderMindmap();
        });
        this.mobileZenButtonEl = mobileActionClusterEl.createEl("button", { cls: "mindmap-mobile-zen-button", text: "锁住" });
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
        this.nodeTitleInputEl = this.drawerEl.createEl("input", {
            cls: "mindmap-node-title-input",
            type: "text"
        });
        this.nodeTitleInputEl.placeholder = "节点标题";
        this.nodeTitleInputEl.addEventListener("input", () => {
            if (!this.doc || !this.selectedNodeId) {
                return;
            }
            const node = findNodeById(this.doc, this.selectedNodeId);
            if (!node) {
                return;
            }
            const nextTitle = this.nodeTitleInputEl.value.trim();
            node.title = nextTitle.length > 0 ? nextTitle : "未命名节点";
            this.drawerTitleEl.setText(`${node.title}`);
            if (node.id === this.doc.root.id) {
                this.refreshTabTitle();
            }
            this.normalizeLayout();
            this.requestSave();
            this.renderMindmap();
        });
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
            if (!this.doc || !this.selectedNodeId) {
                return;
            }
            const node = findNodeById(this.doc, this.selectedNodeId);
            if (!node) {
                return;
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
        this.noteInputEl.addEventListener("input", () => {
            if (!this.doc || !this.selectedNodeId) {
                return;
            }
            const node = findNodeById(this.doc, this.selectedNodeId);
            if (!node) {
                return;
            }
            node.note = this.noteInputEl.value;
            this.scheduleMarkdownRender(node.note ?? "");
            this.requestSave();
        });
        this.noteInputEl.addEventListener("paste", (event) => {
            void this.handlePaste(event);
        });
        this.noteInputEl.addEventListener("keydown", (event) => {
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
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
            this.unlockMobileZenWhenViewportChanges();
        }));
        await this.loadFromFile();
        this.renderMindmap();
    }
    async onClose() {
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
    async setState(state, result) {
        await super.setState(state, result);
        const nextState = (state ?? {});
        const path = nextState.file;
        if (!path) {
            return;
        }
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
        this.renderMindmap();
    }
    getState() {
        return {
            file: this.file?.path
        };
    }
    setFile(file) {
        this.file = file;
    }
    async loadFromFile() {
        if (!this.file) {
            this.doc = null;
            return;
        }
        try {
            const raw = await this.app.vault.cachedRead(this.file);
            this.doc = normalizeMindmapDocument(JSON.parse(raw));
            this.normalizeLayout();
            this.refreshTabTitle();
            if (!this.doc.selfPath && this.file) {
                this.doc.selfPath = this.file.path;
                this.requestSave();
            }
            this.shouldCenterOnNextRender = true;
            this.shouldFocusRootOnNextRender = true;
        }
        catch (error) {
            new Notice(`导图读取失败：${String(error)}`);
            this.doc = null;
        }
    }
    renderMindmap() {
        if (this.pendingRenderFrame !== null) {
            window.cancelAnimationFrame(this.pendingRenderFrame);
        }
        this.pendingRenderFrame = window.requestAnimationFrame(() => {
            this.pendingRenderFrame = null;
            this.renderMindmapNow();
        });
    }
    renderMindmapNow() {
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
            }
            else {
                this.centerViewportOnNodes(nodes);
            }
            this.shouldCenterOnNextRender = false;
        }
        this.graphLayerEl.setAttribute("transform", `translate(${this.panOffset.x}, ${this.panOffset.y}) scale(${this.zoomScale})`);
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
        if (this.marqueeSelection) {
            const rect = this.getMarqueeClientRect(this.marqueeSelection);
            this.marqueeEl.removeClass("is-hidden");
            this.marqueeEl.style.left = `${rect.left}px`;
            this.marqueeEl.style.top = `${rect.top}px`;
            this.marqueeEl.style.width = `${rect.width}px`;
            this.marqueeEl.style.height = `${rect.height}px`;
        }
        else {
            this.marqueeEl.addClass("is-hidden");
        }
        const drawOrthogonalConnectors = (node) => {
            if (node.collapsed || node.children.length === 0) {
                return;
            }
            const fromSize = this.ensureNodeSize(node);
            const parentX = node.x + fromSize.width / 2;
            if (node.children.length === 1) {
                const child = node.children[0];
                const childSize = this.ensureNodeSize(child);
                const childX = child.x - childSize.width / 2;
                const directPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                directPath.setAttribute("d", `M ${parentX} ${node.y} H ${childX}`);
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
                return {
                    child,
                    x: child.x - childSize.width / 2,
                    y: child.y
                };
            });
            const topY = childAnchors[0]?.y;
            const bottomY = childAnchors[childAnchors.length - 1]?.y;
            if (topY !== undefined && bottomY !== undefined) {
                const trunkStartY = Math.min(node.y, topY, bottomY);
                const trunkEndY = Math.max(node.y, topY, bottomY);
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
            parentPath.setAttribute("d", `M ${parentX} ${node.y} H ${branchX}`);
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
            if (this.selectedNodeId === node.id || this.selectedNodeIds.has(node.id)) {
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
            // const resizeHandle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            // resizeHandle.setAttribute("x", String(size.width / 2 - 9));
            // resizeHandle.setAttribute("y", String(size.height / 2 - 9));
            // resizeHandle.setAttribute("width", "10");
            // resizeHandle.setAttribute("height", "10");
            // resizeHandle.setAttribute("rx", "5");
            // resizeHandle.setAttribute("ry", "5");
            // resizeHandle.classList.add("mindmap-resize-handle");
            // resizeHandle.addEventListener("pointerdown", (event) => {
            //   event.stopPropagation();
            //   event.preventDefault();
            //   this.startResize(event, node);
            // });
            // group.appendChild(resizeHandle);
            group.addEventListener("pointerdown", (event) => {
                this.startDrag(event, node);
            });
            group.addEventListener("click", (event) => {
                if (event.target instanceof Element && event.target.closest(".mindmap-collapse-group, .mindmap-jump-group")) {
                    return;
                }
                if (this.pendingNodeSelectionTimer) {
                    window.clearTimeout(this.pendingNodeSelectionTimer);
                    this.pendingNodeSelectionTimer = null;
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
    startDrag(event, node) {
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
        const draggingNodes = this.collectMultipleSubtreeNodes(selectedRoots);
        const draggingNodeIds = new Set(draggingNodes.map((current) => current.id));
        const selectedRootIds = new Set(selectedRoots.map((current) => current.id));
        let startPositions = new Map();
        draggingNodes.forEach((current) => {
            startPositions.set(current.id, { x: current.x, y: current.y });
        });
        let startAnchor = { x: node.x, y: node.y };
        let siblingSortActive = false;
        const startClient = { x: event.clientX, y: event.clientY };
        const startPoint = this.getDocumentPoint(event.clientX, event.clientY);
        let dragStarted = false;
        const onMove = (moveEvent) => {
            const distance = Math.hypot(moveEvent.clientX - startClient.x, moveEvent.clientY - startClient.y);
            if (!dragStarted) {
                if (distance < 4) {
                    return;
                }
                dragStarted = true;
                this.isDragging = true;
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
                            const preservedPositions = new Map();
                            draggingNodes.forEach((current) => {
                                preservedPositions.set(current.id, { x: current.x, y: current.y });
                            });
                            siblingSortActive = true;
                            this.selectedNodeId = selectedRoots[0].id;
                            this.selectedNodeIds = new Set([selectedRoots[0].id]);
                            this.normalizeLayout();
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
        const onUp = (upEvent) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (!dragStarted) {
                if (this.isMobileLayout &&
                    upEvent.pointerType !== "mouse" &&
                    !(upEvent.target instanceof Element && upEvent.target.closest(".mindmap-collapse-group, .mindmap-jump-group"))) {
                    this.setSingleSelectedNode(node.id);
                    this.focusContainerWithoutScroll();
                    this.renderMindmap();
                }
                return;
            }
            this.isDragging = false;
            this.draggingNodeIds = new Set();
            const dropTarget = this.findDropTargetForIds(selectedRootIds);
            this.dropTargetNodeId = null;
            if (dropTarget && this.doc) {
                const moved = this.reparentMultipleNodes(selectedRoots, dropTarget.id);
                if (moved) {
                    this.selectedNodeIds = new Set(selectedRoots.map((current) => current.id));
                    this.selectedNodeId = selectedRoots[0]?.id ?? null;
                    this.normalizeLayout();
                    this.requestSave();
                    void this.syncOpenDrawerWithSelection();
                    this.renderMindmap();
                    return;
                }
            }
            this.normalizeLayout();
            this.requestSave();
            void this.syncOpenDrawerWithSelection();
            this.renderMindmap();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
    collectSubtreeNodes(node) {
        const nodes = [];
        const walk = (current) => {
            nodes.push(current);
            current.children.forEach(walk);
        };
        walk(node);
        return nodes;
    }
    collectMultipleSubtreeNodes(nodes) {
        const collected = new Map();
        nodes.forEach((node) => {
            this.collectSubtreeNodes(node).forEach((current) => {
                collected.set(current.id, current);
            });
        });
        return Array.from(collected.values());
    }
    getDragRootNodes(fallbackNode) {
        if (!this.doc || this.selectedNodeIds.size === 0 || !this.selectedNodeIds.has(fallbackNode.id)) {
            return [fallbackNode];
        }
        const selectedNodes = Array.from(this.selectedNodeIds)
            .map((id) => findNodeById(this.doc, id))
            .filter((node) => !!node);
        return selectedNodes.filter((node) => {
            const parentLookup = findParentOfNode(this.doc, node.id);
            return !parentLookup || !this.selectedNodeIds.has(parentLookup.parent.id);
        });
    }
    getNodesInMarquee(marquee) {
        if (!this.doc) {
            return new Set();
        }
        const left = Math.min(marquee.startX, marquee.currentX);
        const right = Math.max(marquee.startX, marquee.currentX);
        const top = Math.min(marquee.startY, marquee.currentY);
        const bottom = Math.max(marquee.startY, marquee.currentY);
        const selectedIds = new Set();
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
    getMarqueeClientRect(marquee) {
        const start = this.getCanvasClientPoint(marquee.startX, marquee.startY);
        const current = this.getCanvasClientPoint(marquee.currentX, marquee.currentY);
        return {
            left: Math.min(start.x, current.x),
            top: Math.min(start.y, current.y),
            width: Math.abs(current.x - start.x),
            height: Math.abs(current.y - start.y)
        };
    }
    findDropTargetForIds(movingRootIds) {
        if (!this.doc) {
            return null;
        }
        const subtreeIds = new Set();
        movingRootIds.forEach((id) => {
            const node = findNodeById(this.doc, id);
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
        let bestTarget = null;
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
    findSiblingReorderIndex(movingNode) {
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
    reparentMultipleNodes(nodes, nextParentId) {
        if (!this.doc || nodes.length === 0) {
            return false;
        }
        const movableNodes = [...nodes].filter((node) => node.id !== this.doc.root.id);
        const nextParent = findNodeById(this.doc, nextParentId);
        if (!nextParent) {
            return false;
        }
        const movedNodes = [];
        movableNodes.forEach((node) => {
            const moved = reparentNode(this.doc, node.id, nextParentId);
            if (moved) {
                movedNodes.push(moved.moved);
            }
        });
        return movedNodes.length > 0;
    }
    findDropTarget(movingNode) {
        if (!this.doc) {
            return null;
        }
        const subtreeIds = new Set(this.collectSubtreeNodes(movingNode).map((node) => node.id));
        const candidates = visibleNodes(this.doc.root).filter((node) => node.id !== movingNode.id);
        let bestTarget = null;
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
    unlockMobileZenIfNeeded() {
        if (this.isMobileLayout && this.isZenMode) {
            this.setZenMode(false);
        }
    }
    async syncDrawerToNode(nodeId) {
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
        const drawerHeaderPathEl = this.drawerHeaderEl.querySelector(".mindmap-drawer-header-path");
        drawerHeaderPathEl?.setText(this.doc?.selfPath ?? this.file?.path ?? "");
        this.nodeTitleInputEl.value = node.title;
        this.nodeLinkInputEl.value = node.linkTarget ?? "";
        this.updateNodeLinkActionButton(node.linkTarget ?? "");
        this.noteInputEl.value = node.note ?? "";
        await this.renderMarkdown(node.note ?? "");
        this.setNoteEditing(false);
    }
    async syncOpenDrawerWithSelection() {
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
    async openDrawer(nodeId) {
        if (!this.doc) {
            return;
        }
        const node = findNodeById(this.doc, nodeId);
        if (!node) {
            return;
        }
        this.selectedNodeId = node.id;
        this.selectedNodeIds = new Set([node.id]);
        this.drawerEl.removeClass("is-hidden");
        this.layoutEl.addClass("has-drawer");
        this.updateMobileActionButtons();
        await this.syncDrawerToNode(node.id);
        this.renderMindmap();
    }
    updateNodeLinkActionButton(linkTarget) {
        if (!this.nodeLinkActionButtonEl) {
            return;
        }
        const hasLink = linkTarget.trim().length > 0;
        this.nodeLinkActionButtonEl.disabled = !hasLink;
        this.nodeLinkActionButtonEl.toggleClass("is-disabled", !hasLink);
        this.nodeLinkActionButtonEl.setAttribute("aria-disabled", hasLink ? "false" : "true");
    }
    updateMobileActionButtons() {
        if (!this.isMobileLayout || !this.mobileActionClusterEl) {
            return;
        }
        const selectedNode = this.doc && this.selectedNodeId ? findNodeById(this.doc, this.selectedNodeId) : null;
        const canDelete = !!selectedNode && this.doc?.root.id !== selectedNode.id;
        const hasLink = !!selectedNode?.linkTarget?.trim();
        this.mobileDeleteButtonEl?.toggleClass("is-hidden", !canDelete);
        this.mobileDeleteButtonEl?.toggleAttribute("hidden", !canDelete);
        this.mobileLinkButtonEl?.toggleClass("is-hidden", !hasLink);
        this.mobileLinkButtonEl?.toggleAttribute("hidden", !hasLink);
    }
    async renderMarkdown(markdown) {
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
                const close = () => overlay.remove();
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
    scheduleMarkdownRender(markdown) {
        window.setTimeout(() => {
            void this.renderMarkdown(markdown);
        }, 60);
    }
    prepareMarkdownForPreview(markdown) {
        return markdown.replace(/!\[\[([^\]]+)\]\]/g, (full, rawTarget) => {
            const target = rawTarget.split("|")[0]?.trim();
            if (!target) {
                return full;
            }
            const file = this.app.metadataCache.getFirstLinkpathDest(target, this.file?.path ?? "");
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
    updateDrawerWidth() {
        this.layoutEl?.style.setProperty("--mindmap-drawer-width", `${this.drawerWidth}px`);
    }
    startDrawerResize(event) {
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
        const onMove = (moveEvent) => {
            const delta = startX - moveEvent.clientX;
            this.drawerWidth = Math.min(MindmapView.MAX_DRAWER_WIDTH, Math.max(MindmapView.MIN_DRAWER_WIDTH, startWidth + delta));
            this.updateDrawerWidth();
        };
        const onUp = () => {
            this.drawerResizeHandleEl?.removeClass("is-dragging");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
    playNodeActionSound(kind) {
        const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
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
        const createStrike = (frequency, duration, type, detune = 0, gainAmount = 0.55) => {
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
    requestSave() {
        if (this.saveTimer) {
            window.clearTimeout(this.saveTimer);
        }
        this.saveTimer = window.setTimeout(() => {
            void this.flushSave();
        }, 250);
    }
    async flushSave() {
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
        }
        finally {
            window.setTimeout(() => {
                this.isReloadingFromDisk = false;
            }, 120);
        }
    }
    async syncNow() {
        await this.flushSave();
        new Notice("已立即写入文件，等待 iCloud 同步");
    }
    async reloadFromDisk(showNotice) {
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
        }
        finally {
            window.setTimeout(() => {
                this.isReloadingFromDisk = false;
            }, 120);
        }
    }
    async openLinkedTarget(rawPath) {
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
                await this.openByLinkText(decodedPath, true);
                return;
            }
            catch {
                new Notice(`无法解析链接：${input}`);
                return;
            }
        }
        const normalizedInput = normalizePath(input);
        await this.openInternalTarget(normalizedInput, true);
    }
    async openByLinkText(linktext, inNewTab) {
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
        }
        catch {
            new Notice(`未找到目标文件：${normalized}`);
        }
    }
    async openInternalTarget(path, inNewTab) {
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
            const targetLeaf = existingLeaf ?? (inNewTab ? this.app.workspace.getLeaf(true) : this.leaf);
            await targetLeaf.setViewState({
                type: MINDMAP_VIEW_TYPE,
                active: true,
                state: { file: target.path }
            });
            this.app.workspace.revealLeaf(targetLeaf);
            if (targetLeaf === this.leaf) {
                this.file = target;
                await this.loadFromFile();
                this.closeDrawer();
                this.renderMindmap();
            }
            return;
        }
        await this.app.workspace.openLinkText(target.path, this.file?.path ?? "", true);
    }
    async goBackFromLinkedTarget() {
        const previousPath = this.navigationStack.pop();
        if (!previousPath) {
            new Notice("没有可返回的上一个位置");
            return;
        }
        await this.openInternalTarget(previousPath, false);
    }
    createChildNode(parentId) {
        if (!this.doc) {
            return;
        }
        const parent = findNodeById(this.doc, parentId);
        if (!parent) {
            return;
        }
        const child = addChildNode(this.doc, parentId, {
            x: parent.x + 180,
            y: parent.y + (parent.children.length + 1) * 56
        });
        if (!child) {
            return;
        }
        this.setSingleSelectedNode(child.id);
        this.editingNodeId = child.id;
        this.playNodeActionSound("add");
        this.normalizeLayout();
        this.requestSave();
        this.renderMindmap();
    }
    createSiblingNode(nodeId) {
        if (!this.doc) {
            return;
        }
        const parentLookup = findParentOfNode(this.doc, nodeId);
        if (!parentLookup) {
            this.createChildNode(nodeId);
            return;
        }
        const sibling = addChildNode(this.doc, parentLookup.parent.id);
        if (!sibling) {
            return;
        }
        this.setSingleSelectedNode(sibling.id);
        this.editingNodeId = sibling.id;
        this.playNodeActionSound("add");
        this.normalizeLayout();
        this.requestSave();
        this.renderMindmap();
    }
    async deleteNodeById(nodeId) {
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
        const accepted = window.confirm(`确认删除节点「${node.title}」及其子节点吗？`);
        if (!accepted) {
            return;
        }
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
        this.normalizeLayout();
        this.requestSave();
        this.renderMindmap();
    }
    openNodeMenu(event, nodeId) {
        const node = this.doc ? findNodeById(this.doc, nodeId) : null;
        const linkTarget = node?.linkTarget?.trim() ?? "";
        const hasLink = linkTarget.length > 0;
        const menu = new Menu();
        menu.addItem((item) => {
            item.setTitle("查看").setIcon("file-text").onClick(() => {
                void this.openDrawer(nodeId);
            });
        });
        if (hasLink) {
            menu.addItem((item) => {
                item.setTitle("跳转").setIcon("arrow-up-right").onClick(() => {
                    void this.openLinkedTarget(linkTarget);
                });
            });
        }
        // menu.addItem((item) => {
        //   item.setTitle(hasLink ? "添加/替换链接" : "添加链接").setIcon("link").onClick(() => {
        //     void this.openDrawer(nodeId).then(() => {
        //       if (!hasLink) {
        //         this.nodeLinkInputEl.value = "";
        //         const currentNode = this.doc ? findNodeById(this.doc, nodeId) : null;
        //         if (currentNode) {
        //           currentNode.linkTarget = "";
        //           this.requestSave();
        //           this.renderMindmap();
        //         }
        //       }
        //       window.setTimeout(() => this.nodeLinkInputEl.focus(), 0);
        //     });
        //   });
        // });
        // if (hasLink) {
        //   menu.addItem((item) => {
        //     item.setTitle("编辑链接").setIcon("pencil").onClick(() => {
        //       void this.openDrawer(nodeId).then(() => {
        //         window.setTimeout(() => {
        //           this.nodeLinkInputEl.focus();
        //           this.nodeLinkInputEl.select();
        //         }, 0);
        //       });
        //     });
        //   });
        //   menu.addItem((item) => {
        //     item.setTitle("清除链接").setIcon("unlink").onClick(() => {
        //       this.clearNodeLink(nodeId);
        //     });
        //   });
        // }
        // menu.addItem((item) => {
        //   item.setTitle("重命名节点").setIcon("pencil").onClick(() => {
        //     this.renameNode(nodeId);
        //   });
        // });
        // menu.addItem((item) => {
        //   item.setTitle("添加子节点").setIcon("plus").onClick(() => {
        //     this.createChildNode(nodeId);
        //   });
        // });
        // menu.addItem((item) => {
        //   item
        //     .setTitle("删除节点")
        //     .setIcon("trash")
        //     .onClick(() => {
        //       void this.deleteNodeById(nodeId);
        //     });
        // });
        menu.showAtMouseEvent(event);
    }
    clearNodeLink(nodeId) {
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
    renameNode(nodeId) {
        this.startInlineNodeEdit(nodeId);
    }
    getDocumentPoint(clientX, clientY) {
        const rect = this.svgEl.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.panOffset.x) / this.zoomScale,
            y: (clientY - rect.top - this.panOffset.y) / this.zoomScale
        };
    }
    getCanvasClientPoint(docX, docY) {
        return {
            x: docX * this.zoomScale + this.panOffset.x,
            y: docY * this.zoomScale + this.panOffset.y
        };
    }
    zoomAt(clientX, clientY, zoomDelta) {
        const rect = this.svgEl.getBoundingClientRect();
        const beforeX = (clientX - rect.left - this.panOffset.x) / this.zoomScale;
        const beforeY = (clientY - rect.top - this.panOffset.y) / this.zoomScale;
        const nextScale = Math.min(2.8, Math.max(0.4, this.zoomScale * (1 + zoomDelta)));
        this.applyZoomFromPoint(clientX, clientY, beforeX, beforeY, nextScale);
    }
    setZoomAt(clientX, clientY, nextScale) {
        const rect = this.svgEl.getBoundingClientRect();
        const beforeX = (clientX - rect.left - this.panOffset.x) / this.zoomScale;
        const beforeY = (clientY - rect.top - this.panOffset.y) / this.zoomScale;
        this.applyZoomFromPoint(clientX, clientY, beforeX, beforeY, nextScale);
    }
    applyZoomFromPoint(clientX, clientY, beforeX, beforeY, nextScale) {
        if (Math.abs(nextScale - this.zoomScale) < 0.0001) {
            return;
        }
        const rect = this.svgEl.getBoundingClientRect();
        this.zoomScale = nextScale;
        this.panOffset.x = clientX - rect.left - beforeX * this.zoomScale;
        this.panOffset.y = clientY - rect.top - beforeY * this.zoomScale;
        this.renderMindmap();
    }
    getTouchDistance(first, second) {
        const deltaX = first.clientX - second.clientX;
        const deltaY = first.clientY - second.clientY;
        return Math.hypot(deltaX, deltaY);
    }
    countVisibleLeaves(node) {
        if (node.collapsed || node.children.length === 0) {
            return 1;
        }
        return node.children.reduce((sum, child) => sum + this.countVisibleLeaves(child), 0);
    }
    normalizeLayout() {
        if (!this.doc) {
            return;
        }
        this.autoLayoutTree();
    }
    centerViewportOnRoot(root, nodes) {
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
    centerViewportOnNodes(nodes) {
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
        const fitScale = Math.min(1.2, Math.max(0.45, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)));
        this.zoomScale = fitScale;
        const contentCenterX = (minX + maxX) / 2;
        const contentCenterY = (minY + maxY) / 2;
        this.panOffset.x = viewportWidth / 2 - contentCenterX * this.zoomScale;
        this.panOffset.y = viewportHeight / 2 - contentCenterY * this.zoomScale;
    }
    autoLayoutTree() {
        if (!this.doc) {
            return;
        }
        const levelGap = 220;
        const verticalGap = 34;
        const root = this.doc.root;
        const anchoredRootY = root.y;
        const measureSubtreeHeight = (node) => {
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
        const place = (node, depth, topY) => {
            const size = this.ensureNodeSize(node);
            const subtreeHeight = measureSubtreeHeight(node);
            node.x = root.x + depth * levelGap;
            if (node.collapsed || node.children.length === 0) {
                node.y = topY + subtreeHeight / 2;
                return subtreeHeight;
            }
            let childTop = topY;
            const childCenters = [];
            node.children.forEach((child, index) => {
                const childHeight = measureSubtreeHeight(child);
                place(child, depth + 1, childTop);
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
        place(root, 0, anchoredRootY - totalHeight / 2);
        const rootShiftY = anchoredRootY - root.y;
        if (Math.abs(rootShiftY) > 0.001) {
            visibleNodes(root).forEach((node) => {
                node.y += rootShiftY;
            });
        }
    }
    async handlePaste(event) {
        if (!event.clipboardData) {
            return;
        }
        const imageItems = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/"));
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
    }
    insertTextAtCursor(text) {
        const input = this.noteInputEl;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? input.value.length;
        input.setRangeText(text, start, end, "end");
    }
    async savePastedImage(file) {
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
    setNoteEditing(editing) {
        if (editing === this.noteSurfaceEl.hasClass("is-editing")) {
            return;
        }
        this.noteSurfaceEl.toggleClass("is-editing", editing);
        this.noteModeToggleEl.setText(editing ? "预览" : "编辑");
        if (editing) {
            this.notePreviewEl.addClass("is-live-hidden");
            window.setTimeout(() => this.noteInputEl.focus({ preventScroll: true }), 0);
            return;
        }
        this.noteInputEl.blur();
        this.notePreviewEl.removeClass("is-live-hidden");
        this.focusContainerWithoutScroll();
    }
    closeDrawer() {
        this.drawerEl.addClass("is-hidden");
        this.layoutEl.removeClass("has-drawer");
        this.setNoteEditing(false);
    }
    setSingleSelectedNode(nodeId) {
        this.selectedNodeId = nodeId;
        this.selectedNodeIds = nodeId ? new Set([nodeId]) : new Set();
        if (nodeId !== this.editingNodeId) {
            this.editingNodeId = null;
        }
        void this.syncOpenDrawerWithSelection();
    }
    startInlineNodeEdit(nodeId) {
        if (this.pendingNodeSelectionTimer) {
            window.clearTimeout(this.pendingNodeSelectionTimer);
            this.pendingNodeSelectionTimer = null;
        }
        this.selectedNodeId = nodeId;
        this.selectedNodeIds = new Set([nodeId]);
        this.editingNodeId = nodeId;
        this.renderMindmap();
    }
    appendInlineTitleEditor(group, node, width, height) {
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
        const commit = (createNextSibling) => {
            if (!this.doc) {
                this.editingNodeId = null;
                this.renderMindmap();
                return;
            }
            const nextValue = input.value.trim();
            if (nextValue) {
                node.title = nextValue;
            }
            if (node.id === this.doc.root.id) {
                this.refreshTabTitle();
            }
            this.editingNodeId = null;
            this.setSingleSelectedNode(node.id);
            this.normalizeLayout();
            this.requestSave();
            this.renderMindmap();
            if (createNextSibling) {
                window.setTimeout(() => {
                    if (this.selectedNodeId === node.id) {
                        this.createSiblingNode(node.id);
                    }
                }, 0);
            }
        };
        const cancel = () => {
            this.editingNodeId = null;
            this.setSingleSelectedNode(node.id);
            this.renderMindmap();
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commit(true);
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                cancel();
            }
        });
        input.addEventListener("blur", () => {
            commit(false);
        });
        foreignObject.appendChild(input);
        group.appendChild(foreignObject);
        window.setTimeout(() => {
            input.focus({ preventScroll: true });
            const caretPosition = input.value.length;
            input.setSelectionRange(caretPosition, caretPosition);
        }, 0);
    }
    startResize(event, node) {
        const size = this.ensureNodeSize(node);
        const startPoint = this.getDocumentPoint(event.clientX, event.clientY);
        const startSize = { width: size.width, height: size.height };
        const onMove = (moveEvent) => {
            const point = this.getDocumentPoint(moveEvent.clientX, moveEvent.clientY);
            const deltaX = point.x - startPoint.x;
            const deltaY = point.y - startPoint.y;
            node.width = Math.max(MindmapView.MIN_NODE_WIDTH, startSize.width + deltaX);
            node.height = Math.max(MindmapView.MIN_NODE_HEIGHT, startSize.height + deltaY);
            node.manualSize = true;
            this.renderMindmap();
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            this.requestSave();
            this.renderMindmap();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }
    ensureNodeSize(node) {
        const width = MindmapView.DEFAULT_NODE_WIDTH;
        const autoHeight = this.measureAutoHeight(node.title, width);
        const height = Math.max(MindmapView.MIN_NODE_HEIGHT, autoHeight);
        if (node.width !== width || node.height !== height) {
            node.width = width;
            node.height = height;
            node.manualSize = false;
        }
        return { width, height };
    }
    measureAutoHeight(title, width) {
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
MindmapView.DEFAULT_NODE_WIDTH = 160;
MindmapView.DEFAULT_NODE_HEIGHT = 44;
MindmapView.MIN_NODE_WIDTH = 120;
MindmapView.MIN_NODE_HEIGHT = 44;
MindmapView.DEFAULT_DRAWER_WIDTH = 380;
MindmapView.MIN_DRAWER_WIDTH = 300;
MindmapView.MAX_DRAWER_WIDTH = 860;
//# sourceMappingURL=view.js.map