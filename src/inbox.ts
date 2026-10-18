import { App, TFile, normalizePath, requestUrl } from "obsidian";

export interface InboxItem {
  id: string;
  title: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  status: "pending" | "imported" | "deleted";
  links?: Array<{ id: string; label: string; target: string }>;
  importedPath?: string;
}

export const INBOX_PATH = "思维导图/全局收集箱.json";

export class InboxStore {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  syncStatus = "本地收集箱";
  private items: InboxItem[] = [];
  private importing = new Set<string>();
  private syncing = false;

  constructor(private app: App) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  list(): InboxItem[] {
    return this.items.filter((item) => item.status === "pending").map((item) => ({ ...item }));
  }

  get(id: string): InboxItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  claim(id: string): boolean {
    if (this.importing.has(id)) return false;
    this.importing.add(id);
    return true;
  }

  release(id: string): void { this.importing.delete(id); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private emit(): void { this.listeners.forEach((listener) => listener()); }

  private async read(): Promise<InboxItem[]> {
    const file = this.app.vault.getAbstractFileByPath(INBOX_PATH);
    if (!file) return [];
    if (!(file instanceof TFile)) throw new Error("收集箱路径被文件夹占用");
    const data = JSON.parse(await this.app.vault.read(file));
    if (!data || data.version !== 1 || !Array.isArray(data.items) || data.items.some((item: InboxItem) =>
      !item || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.note !== "string"
      || !Number.isFinite(item.updatedAt) || !["pending", "imported", "deleted"].includes(item.status))) {
      throw new Error("全局收集箱文件格式无效，已停止写入以保留原始内容");
    }
    return data.items;
  }

  async refresh(): Promise<void> {
    await this.enqueue(async () => { this.items = await this.read(); this.emit(); });
  }

  async initialize(): Promise<void> {
    await this.enqueue(async () => {
      const folder = normalizePath("思维导图");
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      if (!this.app.vault.getAbstractFileByPath(INBOX_PATH)) {
        await this.app.vault.create(INBOX_PATH, JSON.stringify({ version: 1, items: [] }, null, 2));
      }
      this.items = await this.read();
      this.emit();
    });
  }

  async put(item: InboxItem): Promise<void> {
    await this.enqueue(async () => {
      const items = await this.read();
      const index = items.findIndex((candidate) => candidate.id === item.id);
      if (index < 0) items.unshift(item);
      else items[index] = item;
      const file = this.app.vault.getAbstractFileByPath(INBOX_PATH);
      if (!(file instanceof TFile)) throw new Error("收集箱文件不存在");
      await this.app.vault.modify(file, JSON.stringify({ version: 1, items }, null, 2));
      this.items = items;
      this.emit();
    });
  }

  async setStatus(id: string, status: InboxItem["status"], importedPath?: string): Promise<void> {
    const item = this.get(id);
    if (item) await this.put({ ...item, status, importedPath, updatedAt: Date.now() });
  }

  async sync(url: string, token: string): Promise<void> {
    if (this.syncing || !url.trim()) return;
    if (!/^https:\/\//i.test(url)) throw new Error("收集箱服务器必须使用 HTTPS");
    this.syncing = true;
    this.syncStatus = "同步中…";
    this.emit();
    try {
      await this.refresh();
      const response = await requestUrl({
        url: `${url.replace(/\/+$/, "")}/api/inbox/sync`, method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ items: this.items })
      });
      const remote = response.json.items as InboxItem[];
      if (!Array.isArray(remote)) throw new Error("服务器返回格式错误");
      for (const item of remote) {
        if (!item || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.note !== "string"
          || !Number.isFinite(item.updatedAt) || !["pending", "imported", "deleted"].includes(item.status)) {
          throw new Error("服务器条目格式错误");
        }
        const local = this.get(item.id);
        if (!local || local.updatedAt < item.updatedAt) await this.put(item);
      }
      this.syncStatus = `已同步 ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      this.syncStatus = "同步失败，可在设置中重试";
      throw error;
    } finally { this.syncing = false; this.emit(); }
  }
}
