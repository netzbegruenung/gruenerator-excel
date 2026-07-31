/**
 * Startseite des Anmeldedialogs.
 *
 * Existiert nur, weil Office verlangt, dass die erste Adresse eines Dialogs
 * auf der Herkunft des Add-ins liegt. Diese Seite liegt dort und leitet sofort
 * zum Autorisierungsserver weiter.
 *
 * Die Prüfung vor der Weiterleitung ist der ganze Punkt: eine Seite, die eine
 * beliebige Adresse aus dem Aufrufparameter öffnet, ist eine offene
 * Weiterleitung — und diese hier ist öffentlich erreichbar. Die Regel lebt in
 * `oauth-dialog.ts` und wird dort geprüft, damit es keine zweite Fassung gibt.
 */

import { isAllowedAuthorizationTarget } from "./gruenerator/oauth-dialog.js";

function showError(message: string): void {
  const target = document.getElementById("message");
  if (target) target.textContent = message;
}

function start(): void {
  const target = new URLSearchParams(window.location.search).get("target");

  if (!target) {
    showError("Kein Anmeldeziel übergeben. Bitte den Dialog schließen und erneut anmelden.");
    return;
  }

  if (!isAllowedAuthorizationTarget(target)) {
    showError("Das Anmeldeziel gehört nicht zum Grünerator. Die Weiterleitung wurde abgebrochen.");
    return;
  }

  window.location.replace(target);
}

start();
