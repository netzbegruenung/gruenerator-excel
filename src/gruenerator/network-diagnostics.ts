/**
 * Merkt sich den letzten fehlgeschlagenen `fetch`, damit die Oberfläche sagen
 * kann, *was* scheiterte.
 *
 * Hintergrund: bricht ein `fetch` ab, wirft er einen `TypeError`, dessen
 * Meldung je nach Umgebung „Load failed", „Failed to fetch" oder Ähnliches
 * lautet — und pi-ai reicht davon nichts weiter. Beim Agenten kommt nur noch
 * ein String an („Connection error."), ohne Adresse und ohne Grund. Genau
 * dieser Verlust hat uns eine ganze Fehlersuche gekostet: Endpoint, Schlüssel,
 * Modell und Datenstrom waren einzeln geprüft und in Ordnung, und die einzige
 * Meldung, die das Produkt hatte, sagte zu nichts davon etwas.
 *
 * Deshalb wird hier am einzigen Engpass mitgeschrieben, durch den jede Anfrage
 * läuft (`installFetchInterceptor`), und die Fehleranzeige hängt es an.
 */

export interface FetchFailure {
  url: string;
  method: string;
  message: string;
  at: number;
}

let lastFailure: FetchFailure | null = null;

export function recordFetchFailure(
  url: string,
  method: string,
  error: DynamicValue,
  at: number = Date.now(),
): void {
  lastFailure = {
    url,
    method: method.toUpperCase(),
    message: error instanceof Error ? error.message : String(error),
    at,
  };
}

/**
 * Liefert den letzten Fehlschlag, sofern seine Adresse `urlFragment` enthält
 * und er frisch genug ist — und verwirft ihn dabei.
 *
 * Das Fragment ist nicht optional, und das ist der Kern: im Hintergrund laufen
 * dauernd Anfragen, die scheitern dürfen (Bridge-Healthchecks auf :3340/:3341
 * etwa antworten nie). Ohne Filter hängte sich der jüngste davon an jede
 * Fehlermeldung und erklärte etwas, das mit dem Fehler nichts zu tun hat —
 * beim ersten Versuch stand hier prompt „GET https://localhost:3341/health"
 * unter einer 401 der Modellstrecke.
 *
 * Auch das Verwerfen ist Absicht: ein alter Eintrag darf nicht an einen
 * späteren, unabhängigen Fehler geheftet werden, und derselbe Eintrag darf
 * nicht zweimal erklären. Lieber keine Zusatzinfo als eine falsche.
 */
export function takeRecentFetchFailure(
  urlFragment: string,
  maxAgeMs = 30_000,
  now: number = Date.now(),
): FetchFailure | null {
  const failure = lastFailure;
  if (!failure) return null;

  lastFailure = null;
  if (!failure.url.includes(urlFragment)) return null;
  return now - failure.at <= maxAgeMs ? failure : null;
}

/** Nur für Tests: den Speicher leeren. */
export function resetFetchFailures(): void {
  lastFailure = null;
}
