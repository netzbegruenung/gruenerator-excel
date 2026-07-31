/**
 * Verbindet den Anmeldeablauf mit der Modellquelle.
 *
 * Bewusst dünn: alles Prüfbare liegt in `oauth-client.ts`, `oauth-dialog.ts`
 * und `oauth-session.ts` und wird dort gegen Attrappen durchlaufen. Hier steht
 * nur, was sich ohne Office und ohne Browser nicht prüfen lässt — die Herkünfte
 * aus der laufenden Umgebung, der echte Office-Dialog, der Schreibzugriff auf
 * den Gateway.
 *
 * Das Zugriffstoken landet im selben Feld wie bisher der Zugangsschlüssel.
 * Nicht schön, aber richtig: die Modellquelle schickt genau dieses Feld als
 * `Authorization: Bearer …`, und das Backend nimmt seit `addinAuth.ts` beides
 * an. Ein zweiter Weg daneben hiesse, dieselbe Sache an zwei Stellen zu
 * pflegen.
 */

import { GRUENERATOR_ENDPOINT_URL } from "./config.js";
import { setGruenratorApiKey, clearGruenratorApiKey } from "./gateway.js";
import { rewriteToLocalProxy, type OAuthResult } from "./oauth-client.js";
import { DIALOG_MESSAGE_RECEIVED, type DialogHost } from "./oauth-dialog.js";
import {
  clearSession,
  getValidAccessToken,
  isSignedIn,
  login,
  type OAuthSessionDeps,
  type SettingsLike,
} from "./oauth-session.js";

import type { CustomProvidersStoreLike } from "../auth/custom-gateways.js";

/**
 * Herkunft des Autorisierungsservers.
 *
 * Aus dem konfigurierten Endpoint abgeleitet, nicht daneben gestellt: Endpoint
 * und Anmeldung müssen zwingend auf dieselbe Instanz zeigen, sonst passt das
 * ausgestellte Token nicht zum angesprochenen Server.
 */
export function resolveAuthOrigin(endpointUrl: string = GRUENERATOR_ENDPOINT_URL): string {
  try {
    return new URL(endpointUrl).origin;
  } catch {
    return "https://gruenerator.eu";
  }
}

/**
 * Ordnet unsere Ereignisnamen dem Office-Enum zu.
 *
 * Nachgeschlagen statt umgedeutet: eine Umdeutung von `string` auf das Enum
 * verlangt den Umweg über `unknown`, und der ist hier zu Recht untersagt.
 */
function toOfficeEventType(eventType: string): Office.EventType {
  return eventType === DIALOG_MESSAGE_RECEIVED
    ? Office.EventType.DialogMessageReceived
    : Office.EventType.DialogEventReceived;
}

/**
 * Übersetzt Office' Dialog-API in die schmale Form, gegen die geprüft wird.
 *
 * Ein Durchreichen von `Office.context.ui` genügt nicht: dessen
 * `addEventHandler` nimmt ein Office-Enum, unsere Schnittstelle eine
 * Zeichenkette — das ist der einzige Punkt, an dem eine Umdeutung nötig ist,
 * und sie steht hier statt verstreut im Ablauf.
 */
function officeDialogHost(): DialogHost | null {
  const ui = globalThis.Office?.context?.ui;
  if (!ui || typeof ui.displayDialogAsync !== "function") return null;

  return {
    displayDialogAsync: (url, options, callback) => {
      ui.displayDialogAsync(url, options, (result) => {
        const succeeded = result.status === Office.AsyncResultStatus.Succeeded;
        const dialog = result.value;

        callback({
          status: succeeded ? "succeeded" : "failed",
          ...(succeeded && dialog
            ? {
                value: {
                  addEventHandler: (eventType, handler) => {
                    dialog.addEventHandler(toOfficeEventType(eventType), handler);
                  },
                  close: () => {
                    dialog.close();
                  },
                },
              }
            : {}),
          ...(result.error ? { error: { message: result.error.message } } : {}),
        });
      });
    },
  };
}

/**
 * Baut die Abhängigkeiten aus der laufenden Umgebung.
 *
 * Im Entwicklungslauf wird zusätzlich das Umbiegen auf den Vite-Proxy gesetzt:
 * dort ist die Herkunft des Taskpanes `localhost:3141`, und die kennt die
 * CORS-Liste eines produktiv laufenden Backends nicht.
 */
export function buildSessionDeps(settings: SettingsLike): OAuthSessionDeps {
  const addinOrigin = window.location.origin;
  const dialogHost = officeDialogHost();

  return {
    settings,
    addinOrigin,
    authOrigin: import.meta.env.DEV ? addinOrigin : resolveAuthOrigin(),
    ...(dialogHost ? { dialogHost } : {}),
    ...(import.meta.env.DEV
      ? { rewriteFetchEndpoint: (endpoint: string) => rewriteToLocalProxy(endpoint, addinOrigin) }
      : {}),
  };
}

/** Meldet an und legt das Zugriffstoken als Zugangsdatum der Modellquelle ab. */
export async function signInWithGruenerator(
  store: CustomProvidersStoreLike,
  settings: SettingsLike,
): Promise<OAuthResult<void>> {
  const result = await login(buildSessionDeps(settings));
  if (!result.ok) return result;

  await setGruenratorApiKey(store, result.value.access);
  return { ok: true, value: undefined };
}

/**
 * Erneuert das Token, wenn nötig, und schreibt es in die Modellquelle.
 *
 * Wird beim Start aufgerufen. Rückgabe `false` heisst: nicht angemeldet oder
 * Erneuerung gescheitert — in beiden Fällen bleibt ein etwaiger
 * Zugangsschlüssel unangetastet, denn er ist der zweite gültige Weg.
 */
export async function refreshGatewayToken(
  store: CustomProvidersStoreLike,
  settings: SettingsLike,
): Promise<boolean> {
  if (!(await isSignedIn(settings))) return false;

  const token = await getValidAccessToken(buildSessionDeps(settings));
  if (!token.ok) {
    console.warn(`[gruenerator] Token-Erneuerung fehlgeschlagen (${token.stage}): ${token.detail}`);
    return false;
  }

  await setGruenratorApiKey(store, token.value);
  return true;
}

/** Meldet ab: Zugangsdaten löschen **und** die Modellquelle leeren. */
export async function signOutFromGruenerator(
  store: CustomProvidersStoreLike,
  settings: SettingsLike,
): Promise<void> {
  await clearSession(settings);
  // Ohne diesen zweiten Schritt bliebe das Token in der Modellquelle stehen
  // und würde bis zum Ablauf weiterbenutzt — eine Abmeldung, die nichts abmeldet.
  await clearGruenratorApiKey(store);
}

export { isSignedIn };
