const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const toUrl = (path) => `${API_BASE}${path}`;

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

const request = async (path, options = {}) => {
  const response = await fetch(toUrl(path), {
    credentials: "include",
    ...options,
  });

  if (!response.ok) {
    throw await buildError(response);
  }

  if (response.status === 204) return null;
  return response.json();
};

export const getCurrentUser = async () => {
  try {
    return await request("/auth/me");
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
};

export const getGoogleSignInUrl = () => {
  const returnTo = encodeURIComponent(window.location.origin);
  return toUrl(`/auth/google/login?returnTo=${returnTo}`);
};

export const signOut = async () => {
  await request("/auth/logout", { method: "POST" });
};

export const requestAccountDeletion = async () => {
  await request("/account", { method: "DELETE" });
};

export const listAssignments = async () => request("/assignments");

export const getAssignmentById = async (assignmentId) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}`);

export const createAssignment = async (title) =>
  request("/assignments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: title.trim() }),
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
