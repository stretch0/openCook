import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { type McpContext, createMcpServer } from './server.js';

/**
 * Answers one MCP request over Streamable HTTP. Stateless: every request
 * builds its own server for the token's user, so nothing is kept between
 * requests and any number of clients can connect.
 */
export async function handleMcpRequest(
  request: Request,
  ctx: McpContext,
): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // The JSON response has been fully built by now.
    void server.close();
  }
}
