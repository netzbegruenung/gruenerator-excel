/**
 * Zugangsseite — die einzige Provider-Einstellung dieses Forks.
 *
 * Ersetzt die Upstream-Seiten „providers" (OAuth-Logins), „gateway"
 * (frei konfigurierbarer Endpoint) und „proxy" (lokaler CORS-Helfer).
 * Endpoint, Modell und Kontextfenster stehen fest; einzugeben ist der Schlüssel.
 */

import { t } from "../../../language/index.js";
import { getAppStorage } from "../../../storage/local/app-storage.js";
import { createSettingsGroup } from "../../../ui/settings-rows.js";
import type { SettingsShellPage } from "../../../ui/settings-shell.js";
import { showToast } from "../../../ui/toast.js";
import { GRUENERATOR_MODEL_ID } from "../../../gruenerator/config.js";
import { findGruenratorGateway, setGruenratorApiKey } from "../../../gruenerator/gateway.js";

export function createGruenratorPage(): SettingsShellPage {
  return {
    id: "gruenerator",
    parentId: "root",
    title: () => t("gruenerator.access.title"),
    subtitle: () => t("gruenerator.access.hint"),
    render: async (ctx) => {
      const storage = getAppStorage();
      const group = createSettingsGroup(t("gruenerator.access.group"));

      const row = document.createElement("div");
      row.className = "settings-row settings-row--stacked";

      const label = document.createElement("label");
      label.className = "settings-row__label";
      label.textContent = t("gruenerator.access.key_label");
      label.htmlFor = "gruenerator-api-key";

      const input = document.createElement("input");
      input.id = "gruenerator-api-key";
      input.type = "password";
      input.className = "settings-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.placeholder = t("gruenerator.access.key_placeholder");

      const hint = document.createElement("p");
      hint.className = "settings-row__sublabel";
      hint.textContent = t("gruenerator.access.model_hint", { model: GRUENERATOR_MODEL_ID });

      const save = document.createElement("button");
      save.type = "button";
      save.className = "settings-button settings-button--primary";
      save.textContent = t("gruenerator.access.save");

      save.addEventListener("click", () => {
        const value = input.value.trim();
        if (value.length === 0) {
          showToast(t("gruenerator.access.key_required"));
          return;
        }

        void setGruenratorApiKey(storage.customProviders, value)
          .then(() => {
            input.value = "";
            input.placeholder = t("gruenerator.access.key_saved");
            showToast(t("gruenerator.access.saved"));
          })
          .catch((error: DynamicValue) => {
            console.warn("[gruenerator] Schlüssel konnte nicht gespeichert werden:", error);
            showToast(t("gruenerator.access.save_failed"));
          });
      });

      row.append(label, input, hint, save);
      group.list.append(row);
      ctx.body.appendChild(group.root);

      // Vorhandenen Schlüssel nie anzeigen, nur signalisieren, dass einer liegt.
      try {
        const gateway = await findGruenratorGateway(storage.customProviders);
        if ((gateway?.apiKey ?? "").length > 0) {
          input.placeholder = t("gruenerator.access.key_saved");
        }
      } catch {
        // Anzeige ist Beiwerk; ein Lesefehler darf die Seite nicht blockieren.
      }
    },
  };
}
