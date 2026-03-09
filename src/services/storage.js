const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
let cachedUser = null;

const toUrl = (path) => `${API_BASE}${path}`;
const normalizeFlag = (value) => String(value || "").trim().toLowerCase();
const isLocalHost = () =>
  ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  if (bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes") return true;
  if (bypassFlag === "false" || bypassFlag === "0" || bypassFlag === "no") return false;
  return import.meta.env.DEV && isLocalHost();
};

const buildDevUser = () => ({
  id: String(import.meta.env.VITE_DEV_USER_ID || "local-dev-user"),
  name: String(import.meta.env.VITE_DEV_USER_NAME || "Local Developer"),
  email: String(import.meta.env.VITE_DEV_USER_EMAIL || "local-dev@stepwise.local"),
  provider: "local-dev",
});

const buildError = async (response) => {
  let message = `Request failed (${response.status}).`;
  try {
    const data = await response.json();
    if (data?.message) message = data.message;
  } catch {
    // Ignore invalid JSON responses.
  }
  const error = new Error(message);
  error.status = response.status;
  return error;
};

const buildUserHeaders = () =>
  cachedUser?.id
    ? {
        "x-stepwise-user-id": cachedUser.id,
        "x-stepwise-user-name": cachedUser.name || "",
        "x-stepwise-user-email": cachedUser.email || "",
        "x-stepwise-user-provider": cachedUser.provider || "",
      }
    : {};

const request = async (path, options = {}) => {
  const response = await fetch(toUrl(path), {
    credentials: "include",
    headers: {
      ...buildUserHeaders(),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  if (response.status === 204) return null;
  return response.json();
};

const mapEasyAuthUser = (payload) => {
  const first = Array.isArray(payload) ? payload[0] : null;
  const principal = first?.clientPrincipal || first;
  if (!principal?.userId) return null;

  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  const readClaim = (...types) =>
    claims.find((claim) => types.includes(claim.typ))?.val || "";

  return {
    id: principal.userId,
    name:
      readClaim("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ||
      principal.userDetails ||
      "User",
    email:
      readClaim(
        "email",
        "emails",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      ) || "",
    provider: principal.identityProvider || "",
  };
};

export const getCurrentUser = async () => {
  try {
    const user = await request("/auth/me");
    cachedUser = user;
    return user;
  } catch (error) {
    if (error.status === 401) {
      try {
        const response = await fetch("/.auth/me", { credentials: "include" });
        if (!response.ok) return null;
        const payload = await response.json();
        const user = mapEasyAuthUser(payload);
        cachedUser = user;
        return user;
      } catch {
        if (canUseDevBypass()) {
          const devUser = buildDevUser();
          cachedUser = devUser;
          return devUser;
        }
        return null;
      }
    }
    throw error;
  }
};

export const getGoogleSignInUrl = () => {
  const returnTo = encodeURIComponent(window.location.origin);
  return toUrl(`/auth/google/login?returnTo=${returnTo}`);
};

export const signOut = async () => {
  if (cachedUser?.provider === "local-dev") {
    cachedUser = null;
    return { logoutUrl: null };
  }
  cachedUser = null;
  return request("/auth/logout", { method: "POST" });
};

export const requestAccountDeletion = async () => {
  cachedUser = null;
  await request("/account", { method: "DELETE" });
};

export const listAssignments = async () => request("/assignments");

export const getAssignmentById = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}`);

export const createAssignment = async (title, problemCount) =>
  request("/assignments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: title.trim(),
      problemCount,
    }),
  });

export const addProblemToAssignment = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/add`, {
    method: "POST",
  });

export const deleteLastProblemFromAssignment = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/last`, {
    method: "DELETE",
  });

export const deleteAssignment = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}`, {
    method: "DELETE",
  });

export const saveAssignmentPdf = async (assignmentId, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`, {
    method: "POST",
    body: formData,
  });
};

export const getAssignmentPdf = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`);

export const getAssignmentPdfDownloadUrl = async (assignmentId) => {
  try {
    const data = await request(
      `/assignments/${encodeURIComponent(assignmentId)}/pdf/download-url`,
    );
    if (typeof data?.url === "string" && data.url.length > 0) {
      return data.url;
    }
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return toUrl(`/assignments/${encodeURIComponent(assignmentId)}/pdf/download`);
};

export const deleteAssignmentPdf = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`, {
    method: "DELETE",
  });

export const downloadAssignmentPdfBlob = async (assignmentId) => {
  const response = await fetch(
    toUrl(`/assignments/${encodeURIComponent(assignmentId)}/pdf/download`),
    {
      credentials: "include",
      headers: buildUserHeaders(),
    },
  );
  if (!response.ok) {
    throw await buildError(response);
  }
  return response.blob();
};

export const getProblemScene = async (assignmentId, problemIndex) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/scene`,
  );

export const saveProblemScene = async (assignmentId, problemIndex, scene) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/scene`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ scene }),
    },
  );

export const getProblemContext = async (assignmentId, problemIndex) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/context`,
  );

export const saveProblemContext = async (assignmentId, problemIndex, { answerKey }) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/context`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ answerKey }),
    },
  );

export const getProblemImage = async (assignmentId, problemIndex) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`,
  );

export const saveProblemImage = async (assignmentId, problemIndex, file) => {
  const formData = new FormData();
  formData.append("file", file);
  return request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`,
    {
      method: "PUT",
      body: formData,
    },
  );
};

export const deleteProblemImage = async (assignmentId, problemIndex) =>
  request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`,
    {
      method: "DELETE",
    },
  );

export const downloadProblemImageBlob = async (assignmentId, problemIndex) => {
  const response = await fetch(
    toUrl(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image/download`),
    {
      credentials: "include",
      headers: buildUserHeaders(),
    },
  );
  if (!response.ok) {
    throw await buildError(response);
  }
  return response.blob();
};
