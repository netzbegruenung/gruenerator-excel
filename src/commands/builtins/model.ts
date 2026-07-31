/**
 * Builtin model-related commands.
 */

import type { ActiveAgentProvider, SlashCommand } from "../types.js";
import { showToast } from "../../ui/toast.js";
import { t } from "../../language/index.js";

export interface ModelCommandActions {
  getActiveAgent: ActiveAgentProvider;
  openModelSelector: () => void;
}

export function createModelCommands(actions: ModelCommandActions): SlashCommand[] {
  const runModelSelector = (): void => {
    const agent = actions.getActiveAgent();
    if (!agent) {
      showToast(t("command.model.no_session"));
      return;
    }

    actions.openModelSelector();
  };

  return [
    {
      name: "model",
      description: t("command.model.desc"),
      source: "builtin",
      execute: runModelSelector,
    },
  ];
}
