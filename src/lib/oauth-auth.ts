import { randomUUID } from "node:crypto";
import * as jose from "jose";
import type { Config } from "./config.js";
import { logger } from "./logger.js";

interface OpaqueTokenEntry {
  jwt: string;
  expiresAt: number;
}

export interface AuthContext {
  sub: string;
  scopes: string[];
  claims: jose.JWTPayload;
}

const opaqueTokens = new Map<string, OpaqueTokenEntry>();
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

setInterval(() => cleanExpiredOpaqueTokens(), 10 * 60 * 1000).unref();

export function cleanExpiredOpaqueTokens(now = Date.now()): void {
  for (const [token, entry] of opaqueTokens) {
    if (entry.expiresAt < now) opaqueTokens.delete(token);
  }
}

export function getPublicBase(config: Config): string {
  if (!config.PUBLIC_BASE_URL) {
    throw new Error("PUBLIC_BASE_URL is required when OAuth is enabled");
  }
  return config.PUBLIC_BASE_URL.replace(/\/+$/, "");
}

export function getPublicBasePath(config: Config): string {
  const pathname = new URL(getPublicBase(config)).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

export function getProtectedResourceMetadata(config: Config): Record<string, unknown> {
  const publicBase = getPublicBase(config);
  return {
    resource: publicBase,
    authorization_servers: [publicBase],
    scopes_supported: ["mcp:read", "mcp:write"],
    bearer_methods_supported: ["header"],
  };
}

export function getWwwAuthenticate(config: Config): string {
  const publicBase = getPublicBase(config);
  return `Bearer realm="fms-mcp", resource_metadata="${publicBase}/.well-known/oauth-protected-resource"`;
}

export async function verifyBearerToken(token: string, config: Config): Promise<AuthContext | null> {
  const jwt = resolveToken(token);
  if (!jwt) return null;

  try {
    const result = await jose.jwtVerify(jwt, getJwks(config), {
      issuer: config.OAUTH_ISSUER,
      audience: config.OAUTH_AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });

    const sub = result.payload.sub;
    if (!sub) return null;

    const scopeStr = typeof result.payload["scope"] === "string"
      ? result.payload["scope"]
      : "";

    return {
      sub,
      scopes: scopeStr.split(" ").filter(Boolean),
      claims: result.payload,
    };
  } catch (error) {
    logger.warn(
      { reason: categorizeJoseError(error) },
      "OAuth token verification failed",
    );
    return null;
  }
}

export function createAuthorizationServerMetadata(config: Config): Record<string, unknown> {
  const publicBase = getPublicBase(config);
  return {
    issuer: publicBase,
    authorization_endpoint: `${publicBase}/authorize`,
    token_endpoint: `${publicBase}/token`,
    registration_endpoint: `${publicBase}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile", "mcp:read", "mcp:write"],
  };
}

export function createAuthorizeRedirectUrl(requestUrl: string, config: Config): string {
  const authorizeUrl = new URL("../authorize/", config.OAUTH_ISSUER!).toString();
  const incoming = new URL(requestUrl, getPublicBase(config));
  const target = new URL(authorizeUrl);

  incoming.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const scopes = new Set((target.searchParams.get("scope") ?? "").split(" ").filter(Boolean));
  scopes.add("offline_access");
  target.searchParams.set("scope", Array.from(scopes).join(" "));

  return target.toString();
}

export async function proxyTokenRequest(
  body: string,
  config: Config,
  authorizationHeader?: string,
): Promise<Response> {
  const tokenUrl = new URL("../token/", config.OAUTH_ISSUER!).toString();
  const params = new URLSearchParams(body);
  const basicCredentials = parseBasicAuth(authorizationHeader);

  if (basicCredentials) {
    if (!params.has("client_id")) params.set("client_id", basicCredentials.clientId);
    if (!params.has("client_secret")) params.set("client_secret", basicCredentials.clientSecret);
  }

  logger.info(
    {
      grant_type: params.get("grant_type"),
      client_id: params.get("client_id"),
      hasCode: params.has("code"),
      hasRefreshToken: params.has("refresh_token"),
      scope: params.get("scope"),
    },
    "[oauth-debug] /token request received",
  );

  if (config.OAUTH_CLIENT_SECRET && !params.has("client_secret")) {
    params.set("client_secret", config.OAUTH_CLIENT_SECRET);
  }

  const scopes = new Set((params.get("scope") ?? "").split(" ").filter(Boolean));
  scopes.add("offline_access");
  params.set("scope", Array.from(scopes).join(" "));

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.text();
  logger.info(
    { status: response.status, bodyLen: data.length },
    "[oauth-debug] Authentik token response received",
  );

  if (response.status === 200) {
    try {
        const tokenData = JSON.parse(data) as {
          access_token?: string;
          expires_in?: number;
          id_token?: string;
          refresh_token?: string;
          scope?: string;
        };
        logger.info(
          {
            keys: Object.keys(tokenData),
            hasAccessToken: !!tokenData.access_token,
            hasRefreshToken: !!tokenData.refresh_token,
            hasIdToken: !!tokenData.id_token,
            expiresIn: tokenData.expires_in,
            scope: tokenData.scope,
          },
          "[oauth-debug] Authentik token response parsed",
        );

        if (tokenData.access_token) {
        const opaque = randomUUID();
        const expiresIn = tokenData.expires_in ?? 3600;
        opaqueTokens.set(opaque, {
          jwt: tokenData.access_token,
          expiresAt: Date.now() + expiresIn * 1000,
        });

        return jsonResponse(
          {
            access_token: opaque,
            token_type: "Bearer",
            expires_in: expiresIn,
            scope: tokenData.scope || params.get("scope") || "mcp:read mcp:write",
            ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
          },
          200,
          { "Cache-Control": "no-store" },
        );
      }
    } catch {
      // Fall through and return Authentik's response.
    }
  }

  return new Response(data, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function createRegistrationResponse(requestBody: string, config: Config): Promise<Response> {
  let body: Record<string, unknown> = {};
  if (requestBody.trim()) {
    try {
      body = JSON.parse(requestBody) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  return jsonResponse(
    {
      client_id: config.OAUTH_CLIENT_ID,
      client_name: typeof body["client_name"] === "string" ? body["client_name"] : "MCP Client",
      redirect_uris: Array.isArray(body["redirect_uris"]) ? body["redirect_uris"] : [],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function resolveToken(token: string): string | null {
  if (token.startsWith("eyJ")) return token;
  const entry = opaqueTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    opaqueTokens.delete(token);
    return null;
  }
  return entry.jwt;
}

function parseBasicAuth(authorizationHeader?: string): { clientId: string; clientSecret: string } | null {
  if (!authorizationHeader?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorizationHeader.slice(6), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function getJwks(config: Config): ReturnType<typeof jose.createRemoteJWKSet> {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(config.OAUTH_JWKS_URI!));
  }
  return jwks;
}

function categorizeJoseError(error: unknown): string {
  if (error instanceof jose.errors.JWTExpired) return "expired";
  if (error instanceof jose.errors.JWSSignatureVerificationFailed) return "invalid_signature";
  if (error instanceof jose.errors.JWTClaimValidationFailed) {
    const message = error.message.toLowerCase();
    if (message.includes("iss")) return "issuer_mismatch";
    if (message.includes("aud")) return "audience_mismatch";
    return "claim_validation_failed";
  }
  if (error instanceof TypeError && error.message.includes("fetch")) return "jwks_fetch_failed";
  return "unknown";
}
