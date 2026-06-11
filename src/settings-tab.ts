import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MindmapPlugin from "../main";
import { fetchOllamaModels } from "./llm";
import { DEFAULT_SETTINGS, LLM_PROVIDER_LABELS, llmProviderRequiresApiKey, type LlmProvider } from "./settings";

export class MindmapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MindmapPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI 生成子节点" });

    new Setting(containerEl)
      .setName("大模型提供商")
      .setDesc("选择用于生成子节点的大模型服务")
      .addDropdown((dropdown) => {
        (Object.keys(LLM_PROVIDER_LABELS) as LlmProvider[]).forEach((provider) => {
          dropdown.addOption(provider, LLM_PROVIDER_LABELS[provider]);
        });
        dropdown.setValue(this.plugin.settings.llmProvider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.llmProvider = value as LlmProvider;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (llmProviderRequiresApiKey(this.plugin.settings.llmProvider)) {
      new Setting(containerEl)
        .setName("API Key")
        .setDesc("用于调用大模型 API 的密钥")
        .addText((text) => {
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.apiKey)
            .onChange(async (value) => {
              this.plugin.settings.apiKey = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
        });
    }

    if (this.plugin.settings.llmProvider === "deepseek") {
      new Setting(containerEl)
        .setName("DeepSeek 模型")
        .setDesc("默认 deepseek-chat")
        .addText((text) => {
          text
            .setPlaceholder(DEFAULT_SETTINGS.deepseekModel)
            .setValue(this.plugin.settings.deepseekModel)
            .onChange(async (value) => {
              this.plugin.settings.deepseekModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    if (this.plugin.settings.llmProvider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI 模型")
        .setDesc("默认 gpt-4o-mini")
        .addText((text) => {
          text
            .setPlaceholder(DEFAULT_SETTINGS.openaiModel)
            .setValue(this.plugin.settings.openaiModel)
            .onChange(async (value) => {
              this.plugin.settings.openaiModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    if (this.plugin.settings.llmProvider === "ollama") {
      new Setting(containerEl)
        .setName("Ollama 地址")
        .setDesc("本地 Ollama 服务地址，默认 http://127.0.0.1:11434")
        .addText((text) => {
          text
            .setPlaceholder(DEFAULT_SETTINGS.ollamaBaseUrl)
            .setValue(this.plugin.settings.ollamaBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaBaseUrl = value;
              await this.plugin.saveSettings();
            });
        });

      void this.renderOllamaModelSetting(containerEl);
    }

    if (this.plugin.settings.llmProvider === "custom") {
      new Setting(containerEl)
        .setName("自定义 API 地址")
        .setDesc("OpenAI 兼容接口地址，例如 https://api.deepseek.com")
        .addText((text) => {
          text
            .setPlaceholder("https://api.example.com/v1")
            .setValue(this.plugin.settings.customBaseUrl)
            .onChange(async (value) => {
              this.plugin.settings.customBaseUrl = value;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("自定义模型名称")
        .addText((text) => {
          text
            .setPlaceholder("model-name")
            .setValue(this.plugin.settings.customModel)
            .onChange(async (value) => {
              this.plugin.settings.customModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    containerEl.createEl("h3", { text: "生成数量" });

    new Setting(containerEl)
      .setName("最少生成节点数")
      .setDesc("AI 至少生成的子节点数量")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.minChildCount))
          .setValue(String(this.plugin.settings.minChildCount))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 1) {
              return;
            }
            this.plugin.settings.minChildCount = parsed;
            if (this.plugin.settings.maxChildCount < parsed) {
              this.plugin.settings.maxChildCount = parsed;
            }
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("最多生成节点数")
      .setDesc("AI 最多生成的子节点数量，默认 3")
      .addText((text) => {
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.maxChildCount))
          .setValue(String(this.plugin.settings.maxChildCount))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 1) {
              return;
            }
            this.plugin.settings.maxChildCount = parsed;
            if (this.plugin.settings.minChildCount > parsed) {
              this.plugin.settings.minChildCount = parsed;
            }
            await this.plugin.saveSettings();
          });
      });
  }

  private async renderOllamaModelSetting(containerEl: HTMLElement): Promise<void> {
    const setting = new Setting(containerEl)
      .setName("Ollama 模型")
      .setDesc("从本地 Ollama 已安装的模型中选择");

    let models: string[] = [];
    try {
      models = await fetchOllamaModels(this.plugin.settings.ollamaBaseUrl);
    } catch (error) {
      setting.setDesc(`无法获取模型列表：${String(error)}`);
    }

    setting.addDropdown((dropdown) => {
      if (models.length === 0) {
        dropdown.addOption("", "暂无可用模型");
        dropdown.setValue("");
        dropdown.setDisabled(true);
        return;
      }

      models.forEach((model) => {
        dropdown.addOption(model, model);
      });

      const current = this.plugin.settings.ollamaModel;
      if (current && models.includes(current)) {
        dropdown.setValue(current);
      } else {
        dropdown.setValue(models[0]);
        this.plugin.settings.ollamaModel = models[0];
        void this.plugin.saveSettings();
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings.ollamaModel = value;
        await this.plugin.saveSettings();
      });
    });

    setting.addButton((button) => {
      button.setButtonText("刷新模型列表").onClick(() => {
        void this.refreshOllamaModels();
      });
    });
  }

  private async refreshOllamaModels(): Promise<void> {
    try {
      const models = await fetchOllamaModels(this.plugin.settings.ollamaBaseUrl);
      if (!this.plugin.settings.ollamaModel || !models.includes(this.plugin.settings.ollamaModel)) {
        this.plugin.settings.ollamaModel = models[0] ?? "";
        await this.plugin.saveSettings();
      }
      new Notice(`已加载 ${models.length} 个 Ollama 模型`);
      this.display();
    } catch (error) {
      new Notice(`刷新失败：${String(error)}`);
    }
  }
}
