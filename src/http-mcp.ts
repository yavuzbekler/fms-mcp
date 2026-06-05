import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer as createMcpServer } from "./server.js";
import { loadConfig, type Config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import {
  createAuthorizationServerMetadata,
  createAuthorizeRedirectUrl,
  createRegistrationResponse,
  getProtectedResourceMetadata,
  getPublicBasePath,
  getWwwAuthenticate,
  jsonResponse,
  proxyTokenRequest,
  verifyBearerToken,
} from "./lib/oauth-auth.js";

const MAX_BODY_BYTES = 5_000_000;

type TransportEntry = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
};

const transports = new Map<string, TransportEntry>();
let httpServer: http.Server | undefined;

function getSessionId(req: IncomingMessage): string | undefined {
  const raw = req.headers["mcp-session-id"];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function parseJsonBody(rawBody: string): unknown {
  if (!rawBody.trim()) return undefined;
  return JSON.parse(rawBody);
}

function applyCors(req: IncomingMessage, res: ServerResponse, config: Config): void {
  const origin = req.headers.origin;
  if (!origin) return;

  const allowedOrigins = new Set([
    "https://claude.ai",
    "https://claude.com",
    ...config.CORS_EXTRA_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean),
  ]);

  const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (isLocalhost || allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function writeJson(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  applyCors(req, res, config);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function writeMcpError(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  writeJson(
    req,
    res,
    config,
    status,
    {
      jsonrpc: "2.0",
      error: { code: -32000, message },
      id: null,
    },
    headers,
  );
}

function writeUnauthorized(req: IncomingMessage, res: ServerResponse, config: Config): void {
  writeJson(
    req,
    res,
    config,
    401,
    { error: "unauthorized", message: "Authentication required" },
    { "WWW-Authenticate": getWwwAuthenticate(config) },
  );
}

function writeOptions(req: IncomingMessage, res: ServerResponse, config: Config): void {
  applyCors(req, res, config);
  res.writeHead(204, {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Session-Id, mcp-session-id",
  });
  res.end();
}

async function writeWebResponse(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  response: Response,
): Promise<void> {
  applyCors(req, res, config);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.writeHead(response.status, response.statusText);
  if (!response.body) {
    res.end();
    return;
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

async function authenticateMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<boolean> {
  if (!config.OAUTH_ENABLED) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    writeUnauthorized(req, res, config);
    return false;
  }

  const user = await verifyBearerToken(authHeader.slice(7), config);
  if (!user) {
    writeUnauthorized(req, res, config);
    return false;
  }

  req.headers["x-auth-user"] = user.sub;
  return true;
}

async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
): Promise<void> {
  if (req.method === "OPTIONS") {
    writeOptions(req, res, config);
    return;
  }

  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    writeMcpError(req, res, config, 405, "Method not allowed");
    return;
  }

  if (!(await authenticateMcpRequest(req, res, config))) {
    return;
  }

  let body: unknown;
  if (req.method === "POST") {
    try {
      body = parseJsonBody(await readRawBody(req));
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "invalid MCP request body");
      writeMcpError(req, res, config, 400, "Invalid JSON request body");
      return;
    }
  }

  const sessionId = getSessionId(req);
  let entry = sessionId ? transports.get(sessionId) : undefined;

  if (!entry && sessionId) {
    writeMcpError(req, res, config, 404, "MCP session not found");
    return;
  }

  if (!entry && req.method === "POST" && isInitializeRequest(body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (initializedSessionId) => {
        transports.set(initializedSessionId, { transport, server });
      },
      onsessionclosed: (closedSessionId) => {
        transports.delete(closedSessionId);
      },
    });

    const server = createMcpServer();
    transport.onclose = () => {
      const initializedSessionId = transport.sessionId;
      if (initializedSessionId) transports.delete(initializedSessionId);
    };

    await server.connect(transport);
    entry = { transport, server };
  }

  if (!entry) {
    writeMcpError(req, res, config, 400, "No valid MCP session. Initialize with POST /mcp first.");
    return;
  }

  applyCors(req, res, config);
  await entry.transport.handleRequest(req, res, body);
}

async function handleOAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  pathname: string,
): Promise<boolean> {
  if (!config.OAUTH_ENABLED) return false;

  const basePath = getPublicBasePath(config);
  const relativePath = basePath && pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length)
    : pathname;

  if (req.method === "OPTIONS") {
    writeOptions(req, res, config);
    return true;
  }

  if (
    relativePath === "/.well-known/oauth-protected-resource" ||
    pathname === `/.well-known/oauth-protected-resource${basePath}`
  ) {
    writeJson(req, res, config, 200, getProtectedResourceMetadata(config), {
      "Cache-Control": "public, max-age=3600",
    });
    return true;
  }

  if (relativePath === "/.well-known/oauth-authorization-server") {
    writeJson(req, res, config, 200, createAuthorizationServerMetadata(config), {
      "Cache-Control": "public, max-age=3600",
    });
    return true;
  }

  if (relativePath === "/authorize" && req.method === "GET") {
    res.writeHead(302, { Location: createAuthorizeRedirectUrl(req.url ?? "/", config) });
    res.end();
    return true;
  }

  if (relativePath === "/token" && req.method === "POST") {
    await writeWebResponse(
      req,
      res,
      config,
      await proxyTokenRequest(await readRawBody(req), config, req.headers.authorization),
    );
    return true;
  }

  if (relativePath === "/register" && req.method === "POST") {
    await writeWebResponse(req, res, config, await createRegistrationResponse(await readRawBody(req), config));
    return true;
  }

  return false;
}

function isMcpPath(pathname: string, config: Config): boolean {
  const basePath = config.OAUTH_ENABLED ? getPublicBasePath(config) : "";
  return pathname === "/mcp" || (basePath ? pathname === `${basePath}/mcp` : false);
}

export function startMcpHttpServer(port: number): http.Server {
  const config = loadConfig();

  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    handleOAuthRequest(req, res, config, url.pathname).then((handled) => {
      if (handled) return;

      if (!isMcpPath(url.pathname, config)) {
        res.writeHead(404);
        res.end();
        return;
      }

      return handleMcpRequest(req, res, config);
    }).catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "MCP HTTP request failed",
      );
      if (!res.headersSent) {
        writeMcpError(req, res, config, 500, "Internal server error");
      }
    });
  });

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info({ port, path: "/mcp", oauthEnabled: config.OAUTH_ENABLED }, "MCP HTTP server started");
  });

  return httpServer;
}

export async function stopMcpHttpServer(): Promise<void> {
  for (const [sessionId, entry] of transports) {
    try {
      await entry.server.close();
      await entry.transport.close();
    } catch (error) {
      logger.warn(
        { sessionId, error: error instanceof Error ? error.message : String(error) },
        "failed to close MCP transport",
      );
    }
  }
  transports.clear();

  await new Promise<void>((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => resolve());
    httpServer = undefined;
  });
}
