import assert from "node:assert/strict";
import { test } from "node:test";

import { createMcpTool } from "../src/tools/mcp.ts";

void test("error-path matrix: mcp connect surfaces expired-token auth failures", async () => {
  const tool = createMcpTool({
    getRuntimeConfig: () => Promise.resolve({
      servers: [{
        id: "srv.local",
        name: "local",
        url: "https://localhost:4010/mcp",
        enabled: true,
      }],
      proxyBaseUrl: undefined,
    }),
    callJsonRpc: () => {
      return Promise.reject(new Error("401 Unauthorized: token expired"));
    },
  });

  const result = await tool.execute("call-4", { connect: "local" });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";

  assert.match(text, /^Error: /);
  assert.match(text, /401/i);
  assert.match(text, /token expired/i);

  const details = result.details as { ok?: boolean; operation?: string; server?: string; error?: string };
  assert.equal(details.ok, false);
  assert.equal(details.operation, "connect");
  assert.equal(details.server, "local");
  assert.match(details.error ?? "", /token expired/i);
});

void test("error-path matrix: mcp tool call handles mid-call network disconnect", async () => {
  const server = {
    id: "srv.local",
    name: "local",
    url: "https://localhost:4010/mcp",
    enabled: true,
  } as const;

  const tool = createMcpTool({
    getRuntimeConfig: () => Promise.resolve({
      servers: [server],
      proxyBaseUrl: undefined,
    }),
    callJsonRpc: ({ method }) => {
      if (method === "initialize") {
        return Promise.resolve({
          result: { result: { protocolVersion: "2025-03-26" } },
          proxied: false,
        });
      }

      if (method === "notifications/initialized") {
        return Promise.resolve({
          result: null,
          proxied: false,
        });
      }

      if (method === "tools/list") {
        return Promise.resolve({
          result: {
            result: {
              tools: [{
                name: "echo",
                description: "Echo input",
                inputSchema: { type: "object" },
              }],
            },
          },
          proxied: false,
        });
      }

      if (method === "tools/call") {
        return Promise.reject(new TypeError("NetworkError when attempting to fetch resource."));
      }

      return Promise.reject(new Error(`Unexpected method: ${method}`));
    },
  });

  const result = await tool.execute("call-5", {
    tool: "echo",
    args: JSON.stringify({ text: "hello" }),
  });

  const text = result.content[0]?.type === "text" ? result.content[0].text : "";
  assert.match(text, /^Error: /);
  assert.match(text, /networkerror/i);

  const details = result.details as { ok?: boolean; operation?: string; tool?: string; error?: string };
  assert.equal(details.ok, false);
  assert.equal(details.operation, "tool");
  assert.equal(details.tool, "echo");
  assert.match(details.error ?? "", /networkerror/i);
});
