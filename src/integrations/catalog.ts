/**
 * Built-in integration catalog.
 *
 * Integrations bundle:
 * - additional system guidance
 * - one or more tools
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";

import { createMcpTool } from "../tools/mcp.js";

export const INTEGRATION_IDS = ["mcp_tools"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export interface IntegrationPromptEntry {
  id: IntegrationId;
  title: string;
  instructions: string;
  agentSkillName?: string;
  warning?: string;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  title: string;
  description: string;
  /** Standards-based Agent Skill identity (agentskills.io). */
  agentSkillName?: string;
  warning?: string;
  /** When true the integration is active for new sessions/workbooks that have
   *  not been explicitly configured yet. */
  enabledByDefault?: boolean;
  toolNames: readonly string[];
  instructions: string;
  createTools: () => AgentTool[];
}

const INTEGRATION_DEFINITIONS: Record<IntegrationId, IntegrationDefinition> = {
  mcp_tools: {
    id: "mcp_tools",
    title: "MCP Gateway (Alpha)",
    description: "Call tools from user-configured MCP servers. Alpha: currently limited to HTTP MCP servers only.",
    agentSkillName: "mcp-gateway",
    warning: "External tools: MCP servers may execute arbitrary remote actions.",
    toolNames: ["mcp"],
    instructions:
      "Use the mcp tool only when a configured external capability is needed. "
      + "Prefer listing/describing tools before invoking them, and clearly state which server/tool was used.",
    createTools: () => [createMcpTool()],
  },
};

export function listIntegrationDefinitions(): IntegrationDefinition[] {
  return INTEGRATION_IDS.map((integrationId) => INTEGRATION_DEFINITIONS[integrationId]);
}

export function getIntegrationDefinition(integrationId: string): IntegrationDefinition | null {
  if (!Object.hasOwn(INTEGRATION_DEFINITIONS, integrationId)) return null;

  if (integrationId === "mcp_tools") return INTEGRATION_DEFINITIONS.mcp_tools;
  return null;
}

export function createToolsForIntegrations(integrationIds: readonly string[]): AgentTool[] {
  const tools: AgentTool[] = [];

  for (const integrationId of integrationIds) {
    const definition = getIntegrationDefinition(integrationId);
    if (!definition) continue;
    tools.push(...definition.createTools());
  }

  return tools;
}

export function buildIntegrationPromptEntries(integrationIds: readonly string[]): IntegrationPromptEntry[] {
  const entries: IntegrationPromptEntry[] = [];

  for (const integrationId of integrationIds) {
    const definition = getIntegrationDefinition(integrationId);
    if (!definition) continue;

    const entry: IntegrationPromptEntry = {
      id: definition.id,
      title: definition.title,
      instructions: definition.instructions,
    };
    if (definition.agentSkillName !== undefined) entry.agentSkillName = definition.agentSkillName;
    if (definition.warning !== undefined) entry.warning = definition.warning;
    entries.push(entry);
  }

  return entries;
}

/** Integration IDs that are active for scopes that have never been configured. */
export function getDefaultEnabledIntegrationIds(): string[] {
  return INTEGRATION_IDS.filter((id) => INTEGRATION_DEFINITIONS[id].enabledByDefault === true);
}

export function getIntegrationToolNames(): string[] {
  const names = new Set<string>();

  for (const definition of listIntegrationDefinitions()) {
    for (const toolName of definition.toolNames) {
      names.add(toolName);
    }
  }

  return Array.from(names.values());
}
