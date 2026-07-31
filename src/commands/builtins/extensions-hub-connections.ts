/**
 * Extensions hub — Connections tab.
 *
 * External tools master toggle, web search config, MCP server management,
 * and bridge URLs.
 */

import { maskSecret } from "../../utils/secrets.js";
import type { IntegrationSettingsStore } from "../../integrations/store.js";
import type { McpConfigStore, McpServerConfig } from "../../tools/mcp-config.js";
import {
  getExternalToolsEnabled,
  setExternalToolsEnabled,
} from "../../integrations/store.js";
import {
  createMcpServerConfig,
  loadMcpServers,
  saveMcpServers,
} from "../../tools/mcp-config.js";
import { validateOfficeProxyUrl } from "../../auth/proxy-validation.js";
import { dispatchExperimentalToolConfigChanged } from "../../experiments/events.js";
import {
  DEFAULT_PYTHON_BRIDGE_URL,
  DEFAULT_TMUX_BRIDGE_URL,
  PYTHON_BRIDGE_URL_SETTING_KEY,
  TMUX_BRIDGE_URL_SETTING_KEY,
} from "../../tools/experimental-tool-gates.js";
import { probeMcpServer } from "./extensions-hub-mcp-probe.js";
import { showToast } from "../../ui/toast.js";
import {
  createToggleRow,
  createSectionHeader,
  createItemCard,
  createConfigRow,
  createConfigInput,
  createConfigValue,
  createAddForm,
  createAddFormRow,
  createAddFormInput,
  createEmptyInline,
  createActionsRow,
  type IconContent,
  createButton,
  createToggle,
} from "../../ui/extensions-hub-components.js";
import { lucide, Terminal, Zap } from "../../ui/lucide-icons.js";
import { t } from "../../language/index.js";
import type { ExtensionsHubDependencies } from "./settings-pages/dependencies.js";
import { renderExtensionConnectionsSection } from "./extensions-hub-extension-connections.js";

type SettingsStore = IntegrationSettingsStore & McpConfigStore & {
  delete?: (key: string) => Promise<void>;
};

// ── Helpers ─────────────────────────────────────────


function getStatusBadge(ok: boolean, label: string): { text: string; tone: "ok" | "warn" | "muted" } {
  return ok ? { text: label, tone: "ok" } : { text: label, tone: "muted" };
}


// Resolved lazily — t() must not run at module scope (language set at boot).
function bridgeSetupHint(): string {
  return t("ext-hub-connections.setupHint");
}

function selectElementText(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createBridgeSetupCommand(command: string): HTMLDivElement {
  const setup = document.createElement("div");
  setup.className = "pi-hub-bridge-setup";

  const commandRow = document.createElement("div");
  commandRow.className = "pi-hub-bridge-setup__command";

  const code = document.createElement("code");
  code.className = "pi-hub-bridge-setup__code";
  code.textContent = command;

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "pi-hub-bridge-setup__copy";
  copyButton.textContent = "📋";
  copyButton.title = t("bridge-setup.copyCommandTitle");
  copyButton.addEventListener("click", () => {
    if (!navigator.clipboard?.writeText) {
      selectElementText(code);
      return;
    }

    void navigator.clipboard.writeText(command).then(
      () => {
        copyButton.textContent = "✓";
        setTimeout(() => {
          copyButton.textContent = "📋";
        }, 1400);
      },
      () => {
        selectElementText(code);
      },
    );
  });

  const hint = document.createElement("p");
  hint.className = "pi-hub-bridge-setup__hint";
  hint.textContent = bridgeSetupHint();

  commandRow.append(code, copyButton);
  setup.append(commandRow, hint);

  return setup;
}

// ── Main render ─────────────────────────────────────

export async function renderConnectionsTab(args: {
  container: HTMLElement;
  settings: SettingsStore;
  deps: ExtensionsHubDependencies;
  isBusy: () => boolean;
  runMutation: (action: () => Promise<void>, reason: "toggle" | "scope" | "external-toggle" | "config", msg?: string) => Promise<void>;
}): Promise<void> {
  const { container, settings, deps, isBusy, runMutation } = args;

  // Load state
  const [
    externalEnabled,
    mcpServers,
    pythonUrlRaw,
    tmuxUrlRaw,
  ] = await Promise.all([
    getExternalToolsEnabled(settings),
    loadMcpServers(settings),
    settings.get(PYTHON_BRIDGE_URL_SETTING_KEY),
    settings.get(TMUX_BRIDGE_URL_SETTING_KEY),
  ]);

  const pythonUrl = typeof pythonUrlRaw === "string" ? pythonUrlRaw.trim() : "";
  const tmuxUrl = typeof tmuxUrlRaw === "string" ? tmuxUrlRaw.trim() : "";
  const effectivePythonUrl = pythonUrl.length > 0 ? pythonUrl : DEFAULT_PYTHON_BRIDGE_URL;
  const effectiveTmuxUrl = tmuxUrl.length > 0 ? tmuxUrl : DEFAULT_TMUX_BRIDGE_URL;

  container.replaceChildren();

  // ── Master toggle ─────────────────────────────
  const surface = document.createElement("div");
  surface.className = "pi-overlay-surface";

  const masterToggle = createToggleRow({
    label: t("extensions-hub-connections.externalTools"),
    sublabel: t("ext-hub-connections.allowExternal"),
    checked: externalEnabled,
    onChange: (checked) => {
      void runMutation(
        () => setExternalToolsEnabled(settings, checked),
        "external-toggle",
        `External tools ${checked ? "enabled" : "disabled"}`,
      );
    },
  });
  surface.appendChild(masterToggle.root);
  container.appendChild(surface);

  // ── Extension connections section ─────────────
  await renderExtensionConnectionsSection({
    container,
    connectionManager: deps.connectionManager,
    extensionManager: deps.extensionManager,
  });

  // ── MCP servers section ───────────────────────
  const mcpAddForm = createAddForm();
  const mcpAddVisible = { value: false };

  const mcpHeader = createSectionHeader({
    label: t("extensions-hub-connections.mcpSection"),
    actionLabel: t("extensions-hub-connections.addServer"),
    onAction: () => {
      mcpAddVisible.value = !mcpAddVisible.value;
      mcpAddForm.hidden = !mcpAddVisible.value;
    },
  });
  container.appendChild(mcpHeader);

  const mcpList = document.createElement("div");
  mcpList.className = "pi-hub-stack";

  if (mcpServers.length === 0) {
    mcpList.appendChild(createEmptyInline(lucide(Zap), t("ext-hub-connections.noMcpServers")));
  } else {
    for (const server of mcpServers) {
      mcpList.appendChild(renderMcpServerCard(server, settings, isBusy, runMutation));
    }
  }
  container.appendChild(mcpList);

  // MCP add form (hidden by default)
  const nameInput = createAddFormInput(t("ext-hub-connections.serverNamePlaceholder"));
  const urlInput = createAddFormInput(t("ext-hub-connections.serverUrlPlaceholder"));
  const tokenInput = createAddFormInput(t("ext-hub-connections.bearerTokenPlaceholder"));
  tokenInput.type = "password";

  const addRow = createAddFormRow();
  addRow.append(nameInput, urlInput);

  const tokenRow = createAddFormRow();
  tokenRow.append(tokenInput, createButton(t("ext-hub-connections.addButton"), {
    primary: true,
    compact: true,
    onClick: () => {
      void runMutation(async () => {
        const servers = await loadMcpServers(settings);
        const next = createMcpServerConfig({
          name: nameInput.value,
          url: urlInput.value,
          token: tokenInput.value,
          enabled: true,
        });
        await saveMcpServers(settings, [...servers, next]);
        nameInput.value = "";
        urlInput.value = "";
        tokenInput.value = "";
      }, "config", "Added MCP server");
    },
  }));

  mcpAddForm.append(addRow, tokenRow);
  mcpAddForm.hidden = true;
  container.appendChild(mcpAddForm);

  // ── Bridges section ───────────────────────────
  const showPython = true;
  const showTmux = true;

  if (showPython || showTmux) {
    container.appendChild(createSectionHeader({ label: t("extensions-hub-connections.bridgesSection") }));

    const bridgeList = document.createElement("div");
    bridgeList.className = "pi-hub-stack";

    if (showPython) {
      bridgeList.appendChild(renderBridgeCard({
        icon: lucide(Terminal),
        name: t("ext-hub-connections.pythonName"),
        description: t("ext-hub-connections.pythonDesc"),
        settingKey: PYTHON_BRIDGE_URL_SETTING_KEY,
        setupCommand: "npx pi-for-excel-python-bridge",
        defaultUrl: DEFAULT_PYTHON_BRIDGE_URL,
        placeholder: DEFAULT_PYTHON_BRIDGE_URL,
        currentUrl: effectivePythonUrl,
        hasCustomUrl: pythonUrl.length > 0,
        settings,
        runMutation,
      }));
    }

    if (showTmux) {
      bridgeList.appendChild(renderBridgeCard({
        icon: lucide(Terminal),
        name: t("ext-hub-connections.tmuxName"),
        description: t("ext-hub-connections.tmuxDesc"),
        settingKey: TMUX_BRIDGE_URL_SETTING_KEY,
        setupCommand: "npx pi-for-excel-tmux-bridge",
        defaultUrl: DEFAULT_TMUX_BRIDGE_URL,
        placeholder: DEFAULT_TMUX_BRIDGE_URL,
        currentUrl: effectiveTmuxUrl,
        hasCustomUrl: tmuxUrl.length > 0,
        settings,
        runMutation,
      }));
    }

    container.appendChild(bridgeList);
  }
}

// ── MCP server card ─────────────────────────────────

function renderMcpServerCard(
  server: McpServerConfig,
  settings: SettingsStore,
  isBusy: () => boolean,
  runMutation: (action: () => Promise<void>, reason: "toggle" | "scope" | "external-toggle" | "config", msg?: string) => Promise<void>,
): HTMLElement {
  const toolLabel = server.enabled ? t("ext-hub-connections.badgeEnabled") : t("ext-hub-connections.badgeDisabled");
  const card = createItemCard({
    icon: lucide(Zap),
    iconColor: "blue",
    name: server.name,
    meta: server.url,
    expandable: true,
    badges: [getStatusBadge(server.enabled, toolLabel)],
  });

  // URL
  card.body.appendChild(createConfigRow(t("extensions-hub-connections.url"), createConfigValue(server.url)));

  // Token
  const tokenValue = server.token ? maskSecret(server.token) : t("ext-hub-connections.badgeNoToken");
  card.body.appendChild(createConfigRow(t("extensions-hub-connections.token"), createConfigValue(tokenValue)));

  // Enabled toggle
  const enabledRow = document.createElement("div");
  enabledRow.className = "pi-item-card__config-row";
  const enabledLabel = document.createElement("span");
  enabledLabel.className = "pi-item-card__config-label";
  enabledLabel.textContent = t("extensions-hub-connections.enabled");
  const enabledToggle = createToggle({
    checked: server.enabled,
    onChange: (checked) => {
      void runMutation(async () => {
        const servers = await loadMcpServers(settings);
        const updated = servers.map((s) =>
          s.id === server.id ? { ...s, enabled: checked } : s,
        );
        await saveMcpServers(settings, updated);
      }, "config", `${server.name}: ${checked ? "enabled" : "disabled"}`);
    },
  });
  enabledRow.append(enabledLabel, enabledToggle.root);
  card.body.appendChild(enabledRow);

  // Actions
  const testBtn = createButton(t("ext-hub-connections.testButton"), {
    compact: true,
    onClick: () => {
      if (isBusy()) return;
      void (async () => {
        try {
          const result = await probeMcpServer(server, settings);
          const transport = result.proxied
            ? t("extensions-hub-connections.transport.proxy")
            : t("extensions-hub-connections.transport.direct");
          showToast(t("extensions-hub-connections.toast.serverReachable", { name: server.name, count: result.toolCount, plural: result.toolCount === 1 ? "" : "s", transport }));
        } catch (err) {
          showToast(t("extensions-hub-connections.toast.serverError", { name: server.name, error: err instanceof Error ? err.message : String(err) }));
        }
      })();
    },
  });

  const removeBtn = createButton(t("ext-hub-connections.removeButton"), {
    danger: true,
    compact: true,
    onClick: () => {
      void runMutation(async () => {
        const servers = await loadMcpServers(settings);
        await saveMcpServers(settings, servers.filter((s) => s.id !== server.id));
      }, "config", `Removed MCP server: ${server.name}`);
    },
  });

  card.body.appendChild(createActionsRow(testBtn, removeBtn));

  return card.root;
}

// ── Bridge card ─────────────────────────────────────

function renderBridgeCard(args: {
  icon: IconContent;
  name: string;
  description: string;
  settingKey: string;
  setupCommand: string;
  defaultUrl: string;
  placeholder: string;
  currentUrl: string;
  hasCustomUrl: boolean;
  settings: SettingsStore;
  runMutation: (action: () => Promise<void>, reason: "toggle" | "scope" | "external-toggle" | "config", msg?: string) => Promise<void>;
}): HTMLElement {
  const card = createItemCard({
    icon: args.icon,
    iconColor: "amber",
    name: args.name,
    description: args.description,
    expandable: true,
    expanded: !args.hasCustomUrl,
    badges: [args.hasCustomUrl
      ? { text: t("ext-hub-connections.configured"), tone: "ok" as const }
      : { text: t("ext-hub-connections.defaultUrl"), tone: "muted" as const },
    ],
  });

  const setupLabel = document.createElement("p");
  setupLabel.className = "pi-hub-bridge-setup__label";
  setupLabel.textContent = t("extensions-hub-connections.quick-setup");
  card.body.append(setupLabel, createBridgeSetupCommand(args.setupCommand));

  const urlInput = createConfigInput({
    value: args.currentUrl,
    placeholder: args.placeholder,
  });
  card.body.appendChild(createConfigRow(t("ext-hub-connections.bridgeUrl"), urlInput));

  const saveBridgeUrl = (clear: boolean): void => {
    const candidateUrl = clear ? "" : urlInput.value.trim();
    let normalizedCandidateUrl = "";

    if (candidateUrl.length > 0) {
      try {
        normalizedCandidateUrl = validateOfficeProxyUrl(candidateUrl);
      } catch (err) {
        showToast(t("ext-hub-connections.toast.invalidUrl", { error: err instanceof Error ? err.message : String(err) }));
        return;
      }
    }

    const useDefaultUrl = normalizedCandidateUrl.length === 0 || normalizedCandidateUrl === args.defaultUrl;

    void args.runMutation(async () => {
      if (useDefaultUrl) {
        if (typeof args.settings.delete === "function") {
          await args.settings.delete(args.settingKey);
        } else {
          await args.settings.set(args.settingKey, "");
        }
      } else {
        await args.settings.set(args.settingKey, normalizedCandidateUrl);
      }
      dispatchExperimentalToolConfigChanged({ configKey: args.settingKey });
    }, "config", useDefaultUrl ? `${args.name} URL set to default` : `${args.name} URL saved`);
  };

  const saveBtn = createButton(t("ext-hub-connections.saveButton"), { compact: true, onClick: () => saveBridgeUrl(false) });
  const clearBtn = createButton(t("ext-hub-connections.clearButton"), { compact: true, onClick: () => saveBridgeUrl(true) });
  card.body.appendChild(createActionsRow(saveBtn, clearBtn));

  return card.root;
}
