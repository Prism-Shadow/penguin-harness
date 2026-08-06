// Minimal real MCP server (stdio) for the penguin-core MCP adapter e2e test.
// Exposes one tool `echo` that returns its input text. Uses the real @modelcontextprotocol/sdk.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "echo-mcp-server", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo back the provided text.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", description: "Text to echo" } },
          required: ["text"],
        },
      },
    ],
  }),
);

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const text = (request.params?.arguments?.text ?? "").toString();
    return {
      content: [{ type: "text", text: `echo: ${text}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
