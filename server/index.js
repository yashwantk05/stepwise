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
const assignmentsByUser = new Map();
const scenesByAssignment = new Map();

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

const requireAuth = async (request, response, next) => {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      response.status(401).json({ message: "Not authenticated." });
      return;
    }
    request.user = user;
    next();
  } catch {
    response.status(500).json({ message: "Unable to validate authentication state." });
  }
};

const listUserAssignments = (userId) => {
  const records = assignmentsByUser.get(userId) || [];
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt);
};

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "stepwise-api" });
});

app.use(express.json({ limit: "2mb" }));

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

app.delete("/api/account", requireAuth, (request, response) => {
  assignmentsByUser.delete(request.user.id);
  response.status(202).json({ message: "Account deletion request accepted." });
});

app.get("/api/assignments", requireAuth, (request, response) => {
  response.json(listUserAssignments(request.user.id));
});

app.post("/api/assignments", requireAuth, (request, response) => {
  const title = String(request.body?.title || "").trim();
  if (!title) {
    response.status(400).json({ message: "Title is required." });
    return;
  }

  const now = Date.now();
  const assignment = {
    id: `assignment-${now}-${Math.random().toString(36).slice(2, 8)}`,
    userId: request.user.id,
    title,
    createdAt: now,
    updatedAt: now,
  };

  const existing = assignmentsByUser.get(request.user.id) || [];
  assignmentsByUser.set(request.user.id, [assignment, ...existing]);
  response.status(201).json(assignment);
});

app.get("/api/assignments/:id", requireAuth, (request, response) => {
  const assignment = listUserAssignments(request.user.id).find(
    (entry) => entry.id === request.params.id,
  );
  if (!assignment) {
    response.status(404).json({ message: "Assignment not found." });
    return;
  }
  response.json(assignment);
});

app.delete("/api/assignments/:id", requireAuth, (request, response) => {
  const existing = listUserAssignments(request.user.id);
  const next = existing.filter((entry) => entry.id !== request.params.id);
  assignmentsByUser.set(request.user.id, next);
  response.status(204).send();
});

app.get("/api/assignments/:id/pdf", requireAuth, (_request, response) => {
  response.json(null);
});

app.post("/api/assignments/:id/pdf", requireAuth, (_request, response) => {
  response.status(501).json({ message: "PDF upload is not wired yet." });
});

app.delete("/api/assignments/:id/pdf", requireAuth, (_request, response) => {
  response.status(204).send();
});

app.get("/api/assignments/:id/pdf/download", requireAuth, (_request, response) => {
  response.status(404).json({ message: "No PDF uploaded yet." });
});

app.get("/api/assignments/:id/problems/:problemIndex/scene", requireAuth, (request, response) => {
  const key = `${request.user.id}:${request.params.id}:${request.params.problemIndex}`;
  response.json(scenesByAssignment.get(key) || null);
});

app.put("/api/assignments/:id/problems/:problemIndex/scene", requireAuth, (request, response) => {
  const key = `${request.user.id}:${request.params.id}:${request.params.problemIndex}`;
  const record = {
    id: key,
    userId: request.user.id,
    assignmentId: request.params.id,
    problemIndex: Number(request.params.problemIndex),
    scene: request.body?.scene || null,
    updatedAt: Date.now(),
  };
  scenesByAssignment.set(key, record);
  response.json(record);
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
