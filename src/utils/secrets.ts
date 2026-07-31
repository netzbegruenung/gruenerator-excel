/**
 * Anzeige von Geheimnissen in der Oberfläche.
 *
 * Lag ursprünglich in `tools/web-search-config.ts`; mit dem Wegfall der
 * Websuche hierher verschoben, weil die MCP-Serverkarte weiterhin Bearer-Token
 * maskiert anzeigt.
 */

/** Kürzt ein Geheimnis auf eine anzeigbare Form: `abcd******yz`. */
export function maskSecret(secret: string): string {
  const length = secret.length;
  if (length <= 4) {
    return "*".repeat(length);
  }

  if (length <= 8) {
    return `${secret.slice(0, 2)}${"*".repeat(length - 2)}`;
  }

  return `${secret.slice(0, 4)}${"*".repeat(length - 6)}${secret.slice(-2)}`;
}
