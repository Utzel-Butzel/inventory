import { randomUUID } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { getRequestIdentity, type RequestIdentity } from "@/lib/api-auth";
import { enforceMcpRateLimit, McpAccessError } from "@/lib/mcp-access";
import {
  isMcpEnabled,
  isMcpHostAllowed,
  isMcpOriginAllowed,
  MCP_MAX_REQUEST_BYTES,
} from "@/lib/mcp-contract";
import { createInventoryMcpServer } from "@/lib/mcp-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} satisfies Record<string, string>;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !isMcpOriginAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
    "Access-Control-Expose-Headers": "MCP-Protocol-Version, MCP-Session-Id, X-Request-Id",
    Vary: "Origin",
  };
}

function jsonRpcError(
  request: Request,
  status: number,
  code: number,
  message: string,
  requestId: string = randomUUID(),
  additionalHeaders: Record<string, string> = {},
) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    {
      status,
      headers: {
        ...securityHeaders,
        ...corsHeaders(request),
        "X-Request-Id": requestId,
        ...(status === 401
          ? { "WWW-Authenticate": 'Bearer realm="Open Inventory MCP"' }
          : {}),
        ...additionalHeaders,
      },
    },
  );
}

function unavailable(request: Request) {
  return jsonRpcError(request, 404, -32_001, "MCP endpoint is disabled.");
}

async function requireMcpIdentity(
  request: Request,
  requestId: string,
): Promise<
  | { identity: RequestIdentity; response: null }
  | { identity: null; response: Response }
> {
  if (!isMcpHostAllowed(request.headers.get("host"))) {
    return {
      identity: null,
      response: jsonRpcError(
        request,
        403,
        -32_003,
        "Host is not allowed.",
        requestId,
      ),
    };
  }
  if (!isMcpOriginAllowed(request.headers.get("origin"))) {
    return {
      identity: null,
      response: jsonRpcError(
        request,
        403,
        -32_003,
        "Origin is not allowed.",
        requestId,
      ),
    };
  }
  if (request.headers.has("x-organization-id")) {
    return {
      identity: null,
      response: jsonRpcError(
        request,
        400,
        -32_602,
        "MCP credentials are pinned to the organization that issued them.",
        requestId,
      ),
    };
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+inv_[^\s]+$/i.test(authorization)) {
    return {
      identity: null,
      response: jsonRpcError(
        request,
        401,
        -32_001,
        "A valid Inventory bearer token is required.",
        requestId,
      ),
    };
  }
  const identity = await getRequestIdentity(request);
  if (!identity || identity.kind !== "token") {
    return {
      identity: null,
      response: jsonRpcError(
        request,
        401,
        -32_001,
        "A valid Inventory bearer token is required.",
        requestId,
      ),
    };
  }
  try {
    await enforceMcpRateLimit(identity, "request");
  } catch (error) {
    if (error instanceof McpAccessError) {
      return {
        identity: null,
        response: jsonRpcError(
          request,
          429,
          -32_029,
          error.message,
          requestId,
          {
            "Retry-After": String(
              Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000)),
            ),
          },
        ),
      };
    }
    console.error("MCP request rate limit failed", { requestId, error });
    return {
      identity: null,
      response: jsonRpcError(
        request,
        500,
        -32_603,
        "The MCP request could not be completed.",
        requestId,
      ),
    };
  }
  return { identity, response: null };
}

export async function OPTIONS(request: Request) {
  if (!isMcpEnabled()) return unavailable(request);
  if (!isMcpHostAllowed(request.headers.get("host"))) {
    return jsonRpcError(request, 403, -32_003, "Host is not allowed.");
  }
  if (!isMcpOriginAllowed(request.headers.get("origin"))) {
    return jsonRpcError(request, 403, -32_003, "Origin is not allowed.");
  }
  return new Response(null, {
    status: 204,
    headers: { ...securityHeaders, ...corsHeaders(request) },
  });
}

export async function GET(request: Request) {
  if (!isMcpEnabled()) return unavailable(request);
  const requestId = randomUUID();
  const authorization = await requireMcpIdentity(request, requestId);
  if (authorization.response) return authorization.response;
  return jsonRpcError(
    request,
    405,
    -32_000,
    "This stateless MCP endpoint accepts POST requests only.",
    requestId,
    { Allow: "POST, OPTIONS" },
  );
}

export async function DELETE(request: Request) {
  if (!isMcpEnabled()) return unavailable(request);
  const requestId = randomUUID();
  const authorization = await requireMcpIdentity(request, requestId);
  if (authorization.response) return authorization.response;
  return jsonRpcError(
    request,
    405,
    -32_000,
    "This stateless MCP endpoint does not create server sessions.",
    requestId,
    { Allow: "POST, OPTIONS" },
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!isMcpEnabled()) return unavailable(request);
  const authorization = await requireMcpIdentity(request, requestId);
  if (authorization.response) return authorization.response;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return jsonRpcError(
      request,
      415,
      -32_600,
      "Content-Type must be application/json.",
      requestId,
    );
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_REQUEST_BYTES) {
    return jsonRpcError(request, 413, -32_600, "MCP request is too large.", requestId);
  }

  let parsedBody: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MCP_MAX_REQUEST_BYTES) {
      return jsonRpcError(request, 413, -32_600, "MCP request is too large.", requestId);
    }
    parsedBody = JSON.parse(body);
  } catch {
    return jsonRpcError(request, 400, -32_700, "Invalid JSON-RPC request.", requestId);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createInventoryMcpServer({
    identity: authorization.identity,
    requestId,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries({
      ...securityHeaders,
      ...corsHeaders(request),
      "X-Request-Id": requestId,
    })) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("MCP request failed", { requestId, error });
    return jsonRpcError(
      request,
      500,
      -32_603,
      "The MCP request could not be completed.",
      requestId,
    );
  } finally {
    await server.close().catch(() => undefined);
  }
}
