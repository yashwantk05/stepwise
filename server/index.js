import express from "express";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(globalThis.process?.env?.PORT) || 8080;
const distDir = path.resolve(__dirname, "..", "dist");
const indexFile = path.join(distDir, "index.html");

const getOrigin = (request) => {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol || "https";
  return `${protocol}://${request.get("host")}`;
};

const getSafeReturnUrl = (request, requestedUrl, fallbackPath = "/") => {
  const origin = getOrigin(request);
  const fallback = new URL(fallbackPath, origin);
  if (!requestedUrl) return fallback.toString();

  try {
    const parsed = new URL(requestedUrl, origin);
    if (parsed.origin !== origin) return fallback.toString();
    return parsed.toString();
  } catch {
    return fallback.toString();
  }
};

const parsePrincipalHeader = (headerValue) => {
  if (!headerValue) return null;
  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
    const principal = JSON.parse(decoded);
    return principal;
  } catch {
    return null;
  }
};

const readClaim = (claims = [], ...types) =>
  claims.find((claim) => types.includes(claim.typ))?.val || "";

const principalToUser = (principal) => {
  if (!principal?.userId) return null;
  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  return {
    id: principal.userId,
    name:
      readClaim(claims, "name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
      principal.userDetails ||
      "User",
    email:
      readClaim(
        claims,
        "email",
        "emails",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      ) || "",
    provider: principal.identityProvider || "",
  };
};

const getAuthenticatedUser = async (request) => {
  const headerPrincipal = parsePrincipalHeader(request.headers["x-ms-client-principal"]);
  const userFromHeader = principalToUser(headerPrincipal);
  if (userFromHeader) return userFromHeader;

  const origin = getOrigin(request);
  const response = await fetch(`${origin}/.auth/me`, {
    headers: {
      cookie: request.headers.cookie || "",
    },
  });

  if (!response.ok) return null;
  const data = await response.json();
  const first = Array.isArray(data) ? data[0] : null;
  return principalToUser(first?.clientPrincipal || first);
};

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "stepwise-api" });
});

app.get("/api/auth/google/login", (request, response) => {
  const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/assignments");
  const loginUrl = `/.auth/login/google?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
  response.redirect(loginUrl);
});

app.get("/api/auth/me", async (request, response) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ message: "Not authenticated." });
      return;
    }
    response.json(user);
  } catch {
    response.status(500).json({ message: "Unable to read authentication state." });
  }
});

app.post("/api/auth/logout", (request, response) => {
  const returnTo = getSafeReturnUrl(request, request.query.returnTo, "/login");
  const logoutUrl = `/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
  response.json({ logoutUrl });
});

if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir));
  app.get(/.*/, (request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ message: "API route not found." });
      return;
    }
    response.sendFile(indexFile);
  });
} else {
  app.get(/.*/, (_request, response) => {
    response.status(503).send("Frontend bundle not found. Run `npm run build` first.");
  });
}

app.listen(port, () => {
  console.log(`StepWise server listening on port ${port}`);
});
