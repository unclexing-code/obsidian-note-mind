import { App, Modal, Notice } from "obsidian";
import { InboxStore, type InboxItem } from "./inbox";

class InboxEditor extends Modal {
  constructor(app: App, private store: InboxStore, private item?: InboxItem, private onSaved?: (item: InboxItem) => void) { super(app); }
  onOpen(): void {
    this.modalEl.addClass("mindmap-inbox-editor-modal-container");
    this.containerEl.setAttribute("data-mindmap-interactive-modal", "true");
    this.contentEl.addClass("mindmap-inbox-editor-modal");
    const header = this.contentEl.createDiv({ cls: "mindmap-inbox-editor-header" });
    header.createEl("h2", { text: this.item ? "编辑收集节点标题" : "新增收集节点" });
    const close = header.createEl("button", { text: "关闭", cls: "mindmap-inbox-editor-close" });
    close.type = "button";
    close.addEventListener("click", () => this.close());
    const title = this.contentEl.createEl("input", { type: "text", value: this.item?.title ?? "", attr: { placeholder: "节点标题", "aria-label": "节点标题" } });
    title.addClass("mindmap-inbox-editor-title");
    const footer = this.contentEl.createDiv({ cls: "mindmap-inbox-editor-footer" });
    const save = footer.createEl("button", { text: "保存", cls: "mod-cta" });
    save.type = "button";
    save.onclick = async () => {
      if (!title.value.trim()) { new Notice("请填写节点标题"); return; }
      save.disabled = true;
      try {
        const now = Date.now();
        const nextItem: InboxItem = { ...this.item, id: this.item?.id ?? crypto.randomUUID(), title: title.value.trim(), note: this.item?.note ?? "", createdAt: this.item?.createdAt ?? now, updatedAt: now, status: "pending" };
        await this.store.put(nextItem);
        this.onSaved?.(nextItem);
        this.close();
      } catch (error) { new Notice(`保存失败：${error}`); }
      finally { save.disabled = false; }
    };
  }
}

export const openInboxEditor = (app: App, store: InboxStore): void => {
  new InboxEditor(app, store).open();
};

export const INBOX_DRAG_TYPE = "application/x-mindmap-inbox";

export function mountInboxPanel(app: App, container: HTMLElement, store: InboxStore, onImport: (id: string) => Promise<void>, onOpen: (item: InboxItem) => void, onCreate: () => void): () => void {
  const host = container.createDiv({ cls: "mindmap-inbox" });
  const toggle = host.createEl("button", { text: "全局收集箱", cls: "mindmap-inbox-toggle" });
  const panel = host.createDiv({ cls: "mindmap-inbox-panel" });
  panel.hidden = true;
  toggle.onclick = () => { panel.hidden = !panel.hidden; };
  const header = panel.createDiv({ cls: "mindmap-inbox-header" });
  header.createEl("strong", { text: "全局收集箱" });
  const add = header.createEl("button", { text: "+ 新增" });
  add.onclick = onCreate;
  panel.createEl("small", { text: "拖动标题到导图节点；点击标题编辑正文。" });
  const status = panel.createDiv({ cls: "mindmap-inbox-status" });
  const list = panel.createDiv({ cls: "mindmap-inbox-list" });
  const render = (): void => {
    const items = store.list();
    status.setText(store.syncStatus);
    toggle.setText(`全局收集箱 (${items.length})`);
    list.empty();
    if (!items.length) list.createDiv({ text: "暂无节点，点击新增收集灵感。", cls: "mindmap-inbox-empty" });
    items.forEach((item) => {
      const card = list.createDiv({ cls: "mindmap-inbox-card" });
      card.draggable = true;
      card.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData(INBOX_DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = "move";
      });
      const title = card.createEl("strong", { text: item.title, cls: "mindmap-inbox-card-title" });
      title.addEventListener("click", () => onOpen(item));
      title.setAttribute("role", "button");
      title.tabIndex = 0;
      title.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      });
      const actions = card.createDiv({ cls: "mindmap-inbox-actions" });
      // const insert = actions.createEl("button", { text: "添加到选中节点" });
      // insert.onclick = () => { void onImport(item.id).catch((error) => new Notice(`导入失败：${error}`)); };
      // const edit = actions.createEl("button", { text: "标题" });
      // edit.onclick = () => new InboxEditor(app, store, item, onOpen).open();
      const remove = actions.createEl("button", { text: "删除" });
      remove.onclick = () => { void store.setStatus(item.id, "deleted").catch((error) => new Notice(`删除失败：${error}`)); };
    });
  };
  const unsubscribe = store.subscribe(render);
  render();
  // Keep canvas keyboard shortcuts from handling editing and card actions.
  host.addEventListener("keydown", (event) => event.stopPropagation());
  host.addEventListener("pointerdown", (event) => event.stopPropagation());
  return () => { unsubscribe(); host.remove(); };
}
