const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const SUBJECTS_KEY = "stepwise_subjects_v1";
const ASSIGNMENT_SUBJECT_MAP_KEY = "stepwise_assignment_subject_map_v1";
const DEFAULT_SUBJECT_NAME = "General";

type AnyRecord = Record<string, unknown>;

interface User {
  id: string;
  name: string;
  email: string;
  provider?: string;
  avatarUrl?: string;
}

interface Subject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface Assignment {
  id: string;
  title: string;
  problemCount: number;
  createdAt?: number;
  updatedAt?: number;
  subjectId?: string;
  [key: string]: unknown;
}

interface AssignmentProblem {
  problemIndex: number;
  title: string;
}

interface FileRecord {
  fileName: string;
  size: number;
  uploadedAt: number;
}

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  fileName?: string;
  size?: number;
  uploadedAt?: number;
}

let cachedUser: User | null = null;

const toUrl = (path: string) => `${API_BASE}${path}`;
const normalizeFlag = (value: unknown) => String(value || "").trim().toLowerCase();

const canUseDevBypass = () => {
  const bypassFlag = normalizeFlag(import.meta.env.VITE_DEV_AUTH_BYPASS);
  return bypassFlag === "true" || bypassFlag === "1" || bypassFlag === "yes";
};

const buildDevUser = (): User => ({
  id: String(import.meta.env.VITE_DEV_USER_ID || "local-dev-user"),
  name: String(import.meta.env.VITE_DEV_USER_NAME || "Local Developer"),
  email: String(import.meta.env.VITE_DEV_USER_EMAIL || "local-dev@stepwise.local"),
  provider: "local-dev",
});

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const listSubjectsLocal = (): Subject[] => readJson<Subject[]>(SUBJECTS_KEY, []);
const saveSubjectsLocal = (subjects: Subject[]) => writeJson(SUBJECTS_KEY, subjects);

const readAssignmentSubjectMap = (): Record<string, string> =>
  readJson<Record<string, string>>(ASSIGNMENT_SUBJECT_MAP_KEY, {});
const saveAssignmentSubjectMap = (map: Record<string, string>) =>
  writeJson(ASSIGNMENT_SUBJECT_MAP_KEY, map);

const buildError = async (response: Response) => {
  let message = `Request failed (${response.status}).`;
  try {
    const data = await response.json();
    if (typeof data?.message === "string" && data.message) {
      message = data.message;
    }
  } catch {
    // Ignore invalid JSON responses.
  }
  const error = new Error(message) as Error & { status?: number };
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
        "x-stepwise-user-avatar": cachedUser.avatarUrl || "",
      }
    : {};

const isDebugImagesEnabled = () =>
  ["true", "1", "yes"].includes(normalizeFlag(import.meta.env.VITE_DEBUG_AI_IMAGES));

const debugEchoImage = async (blob: Blob, label: string) => {
  const formData = new FormData();
  formData.append("file", blob, `${label || "debug"}.png`);

  const response = await fetch(`${API_BASE}/debug/echo-image?label=${encodeURIComponent(label)}`, {
    method: "POST",
    credentials: "include",
    headers: buildUserHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Debug echo failed.");
  }
};

const request = async (path: string, options: RequestInit = {}) => {
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

const mapEasyAuthUser = (payload: unknown): User | null => {
  const first = Array.isArray(payload) ? payload[0] : null;
  const principal = first?.clientPrincipal || first;
  if (!principal?.userId) return null;

  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  const readClaim = (...types: string[]) =>
    claims.find((claim: AnyRecord) => types.includes(String(claim.typ)))?.val || "";

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
    avatarUrl:
      readClaim(
        "picture",
        "urn:google:picture",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/picture",
        "avatar_url",
        "profile",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/uri",
      ) || "",
  };
};

const withSubjectOnAssignment = (assignment: Assignment): Assignment => {
  const map = readAssignmentSubjectMap();
  const subjectId = map[assignment.id];
  if (!subjectId) return assignment;
  return { ...assignment, subjectId };
};

export const getCurrentUser = async (): Promise<User | null> => {
  try {
    const user = (await request("/auth/me")) as User;
    cachedUser = user;
    return user;
  } catch (error) {
    const typedError = error as Error & { status?: number };
    if (typedError.status === 401) {
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

export const getGoogleSignInUrl = (): string => {
  const returnTo = encodeURIComponent(window.location.origin);
  return toUrl(`/auth/google/login?returnTo=${returnTo}`);
};

export const signOut = async (): Promise<{ logoutUrl?: string | null }> => {
  if (cachedUser?.provider === "local-dev") {
    cachedUser = null;
    return { logoutUrl: null };
  }
  cachedUser = null;
  const returnTo = encodeURIComponent(`${window.location.origin}/login`);
  return (await request(`/auth/logout?returnTo=${returnTo}`, { method: "POST" })) as {
    logoutUrl?: string;
  };
};

export const requestAccountDeletion = async (): Promise<void> => {
  cachedUser = null;
  await request("/account", { method: "DELETE" });
};

export const listSubjects = async (): Promise<Subject[]> => {
  const subjects = listSubjectsLocal();
  if (subjects.length > 0) {
    return subjects;
  }

  const defaultSubject: Subject = {
    id: `subject-${Date.now()}`,
    name: DEFAULT_SUBJECT_NAME,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSubjectsLocal([defaultSubject]);
  return [defaultSubject];
};

export const getSubjectById = async (id: string): Promise<Subject> => {
  const subject = listSubjectsLocal().find((entry) => entry.id === id);
  if (!subject) throw new Error("Subject not found");
  return subject;
};

export const createSubject = async (name: string): Promise<Subject> => {
  const subjects = listSubjectsLocal();
  const newSubject: Subject = {
    id: `subject-${Date.now()}`,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  subjects.unshift(newSubject);
  saveSubjectsLocal(subjects);
  return newSubject;
};

export const deleteSubject = async (id: string): Promise<void> => {
  const subjects = listSubjectsLocal().filter((entry) => entry.id !== id);
  saveSubjectsLocal(subjects);

  const assignments = await listAssignments(id);
  for (const assignment of assignments) {
    await deleteAssignment(assignment.id);
  }

  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith(`note-${id}-`) || key === `notes-${id}`) {
      localStorage.removeItem(key);
    }
  }
};

const normalizeNote = (entry: Partial<Note> & Record<string, unknown>): Note => {
  const createdAt =
    typeof entry.createdAt === "number"
      ? entry.createdAt
      : typeof entry.uploadedAt === "number"
        ? entry.uploadedAt
        : Date.now();

  const updatedAt =
    typeof entry.updatedAt === "number"
      ? entry.updatedAt
      : typeof entry.uploadedAt === "number"
        ? entry.uploadedAt
        : createdAt;

  const titleSource =
    typeof entry.title === "string" && entry.title.trim()
      ? entry.title
      : typeof entry.fileName === "string" && entry.fileName.trim()
        ? entry.fileName
        : "Untitled Note";

  const content =
    typeof entry.content === "string"
      ? entry.content
      : typeof entry.fileName === "string"
        ? `Imported file: ${entry.fileName}`
        : "";

  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : `note-${Date.now()}`,
    title: titleSource,
    content,
    tags: Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : [],
    createdAt,
    updatedAt,
    fileName: typeof entry.fileName === "string" ? entry.fileName : undefined,
    size: typeof entry.size === "number" ? entry.size : undefined,
    uploadedAt: typeof entry.uploadedAt === "number" ? entry.uploadedAt : undefined,
  };
};

const saveNotes = (subjectId: string, notes: Note[]) => {
  writeJson(`notes-${subjectId}`, notes);
};

export const listNotes = async (subjectId: string): Promise<Note[]> => {
  const rawNotes = readJson<Array<Partial<Note> & Record<string, unknown>>>(`notes-${subjectId}`, []);
  const normalized = rawNotes.map(normalizeNote);
  saveNotes(subjectId, normalized);
  return normalized;
};

export const createTextNote = async (
  subjectId: string,
  input: { title: string; content?: string; tags?: string[] },
): Promise<Note> => {
  const notes = await listNotes(subjectId);
  const timestamp = Date.now();
  const newNote: Note = {
    id: `note-${timestamp}`,
    title: input.title.trim() || "Untitled Note",
    content: (input.content || "").trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.filter((tag) => tag.trim().length > 0).slice(0, 6)
      : [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  notes.unshift(newNote);
  saveNotes(subjectId, notes);
  return newNote;
};

export const updateTextNote = async (
  subjectId: string,
  noteId: string,
  updates: { title: string; content: string; tags?: string[] },
): Promise<Note> => {
  const notes = await listNotes(subjectId);
  const noteIndex = notes.findIndex((entry) => entry.id === noteId);
  if (noteIndex === -1) {
    throw new Error("Note not found");
  }

  const current = notes[noteIndex];
  const updatedNote: Note = {
    ...current,
    title: updates.title.trim() || current.title,
    content: updates.content,
    tags: Array.isArray(updates.tags)
      ? updates.tags.filter((tag) => tag.trim().length > 0).slice(0, 6)
      : current.tags,
    updatedAt: Date.now(),
  };

  notes[noteIndex] = updatedNote;
  saveNotes(subjectId, notes);
  return updatedNote;
};

export const uploadNote = async (subjectId: string, file: File): Promise<Note> => {
  const notes = await listNotes(subjectId);
  const noteId = `note-${Date.now()}`;
  const newNote: Note = {
    id: noteId,
    title: file.name,
    content: `Imported file: ${file.name}`,
    tags: ["Uploaded"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    fileName: file.name,
    size: file.size,
    uploadedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || "");
      localStorage.setItem(`note-${subjectId}-${noteId}`, base64);
      notes.unshift(newNote);
      saveNotes(subjectId, notes);
      resolve(newNote);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const downloadNoteBlob = async (subjectId: string, noteId: string): Promise<Blob> => {
  const base64 = localStorage.getItem(`note-${subjectId}-${noteId}`);
  if (!base64) throw new Error("Note not found");

  const response = await fetch(base64);
  return response.blob();
};

export const deleteNote = async (subjectId: string, noteId: string): Promise<void> => {
  const notes = await listNotes(subjectId);
  const filtered = notes.filter((entry) => entry.id !== noteId);
  saveNotes(subjectId, filtered);
  localStorage.removeItem(`note-${subjectId}-${noteId}`);
};

export const listAssignments = async (subjectId: string): Promise<Assignment[]> => {
  const subjects = await listSubjects();
  const fallbackSubjectId = subjects[0]?.id;
  const assignments = (await request("/assignments")) as Assignment[];
  const assignmentSubjectMap = readAssignmentSubjectMap();
  let mapChanged = false;

  if (fallbackSubjectId) {
    for (const assignment of assignments) {
      if (!assignmentSubjectMap[assignment.id]) {
        assignmentSubjectMap[assignment.id] = fallbackSubjectId;
        mapChanged = true;
      }
    }
  }

  if (mapChanged) {
    saveAssignmentSubjectMap(assignmentSubjectMap);
  }

  return assignments
    .filter((assignment) => assignmentSubjectMap[assignment.id] === subjectId)
    .map((assignment) => ({ ...assignment, subjectId }));
};

export const getAssignmentById = async (assignmentId: string): Promise<Assignment> => {
  const assignment = (await request(`/assignments/${encodeURIComponent(assignmentId)}`)) as Assignment;
  return withSubjectOnAssignment(assignment);
};

export const createAssignment = async (
  subjectId: string,
  title: string,
  problemCount: number,
): Promise<Assignment> => {
  const assignment = (await request("/assignments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: title.trim(),
      problemCount,
    }),
  })) as Assignment;

  const assignmentSubjectMap = readAssignmentSubjectMap();
  assignmentSubjectMap[assignment.id] = subjectId;
  saveAssignmentSubjectMap(assignmentSubjectMap);
  return { ...assignment, subjectId };
};

export const addProblemToAssignment = async (assignmentId: string): Promise<Assignment> => {
  const assignment = (await request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/add`,
    { method: "POST" },
  )) as Assignment;
  return withSubjectOnAssignment(assignment);
};

export const deleteLastProblemFromAssignment = async (
  assignmentId: string,
): Promise<{ assignment: Assignment; removedProblemIndex: number; removedArtifacts: boolean }> => {
  const result = (await request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/last`,
    { method: "DELETE" },
  )) as { assignment: Assignment; removedProblemIndex: number; removedArtifacts: boolean };

  return {
    ...result,
    assignment: withSubjectOnAssignment(result.assignment),
  };
};

export const listAssignmentProblems = async (assignmentId: string): Promise<AssignmentProblem[]> => {
  return (await request(`/assignments/${encodeURIComponent(assignmentId)}/problems`)) as AssignmentProblem[];
};

export const renameAssignmentProblem = async (
  assignmentId: string,
  problemIndex: number,
  title: string,
): Promise<AssignmentProblem> => {
  return (await request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  })) as AssignmentProblem;
};

export const deleteProblemFromAssignment = async (
  assignmentId: string,
  problemIndex: number,
): Promise<{ assignment: Assignment; removedProblemIndex: number; removedArtifacts: boolean }> => {
  const result = (await request(
    `/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}`,
    { method: "DELETE" },
  )) as { assignment: Assignment; removedProblemIndex: number; removedArtifacts: boolean };

  return {
    ...result,
    assignment: withSubjectOnAssignment(result.assignment),
  };
};

export const deleteAssignment = async (assignmentId: string): Promise<void> => {
  await request(`/assignments/${encodeURIComponent(assignmentId)}`, {
    method: "DELETE",
  });

  const assignmentSubjectMap = readAssignmentSubjectMap();
  delete assignmentSubjectMap[assignmentId];
  saveAssignmentSubjectMap(assignmentSubjectMap);
};

export const saveAssignmentPdf = async (assignmentId: string, file: File): Promise<void> => {
  const formData = new FormData();
  formData.append("file", file);

  await request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`, {
    method: "POST",
    body: formData,
  });
};

export const getAssignmentPdf = async (assignmentId: string): Promise<FileRecord | null> => {
  return (await request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`)) as FileRecord | null;
};

export const getAssignmentPdfDownloadUrl = async (assignmentId: string): Promise<string> => {
  try {
    const data = (await request(
      `/assignments/${encodeURIComponent(assignmentId)}/pdf/download-url`,
    )) as { url?: string };
    if (typeof data?.url === "string" && data.url.length > 0) {
      return data.url;
    }
  } catch (error) {
    const typedError = error as Error & { status?: number };
    if (typedError.status !== 404) throw error;
  }
  return toUrl(`/assignments/${encodeURIComponent(assignmentId)}/pdf/download`);
};

export const downloadAssignmentPdfBlob = async (assignmentId: string): Promise<Blob> => {
  const response = await fetch(toUrl(`/assignments/${encodeURIComponent(assignmentId)}/pdf/download`), {
    credentials: "include",
    headers: buildUserHeaders(),
  });
  if (!response.ok) {
    throw await buildError(response);
  }
  return response.blob();
};

export const deleteAssignmentPdf = async (assignmentId: string): Promise<void> => {
  await request(`/assignments/${encodeURIComponent(assignmentId)}/pdf`, {
    method: "DELETE",
  });
};

export const getProblemScene = async (assignmentId: string, problemIndex: number) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/scene`);

export const saveProblemScene = async (assignmentId: string, problemIndex: number, scene: unknown) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/scene`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scene }),
  });

export const getProblemContext = async (assignmentId: string, problemIndex: number) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/context`);

export const saveProblemContext = async (
  assignmentId: string,
  problemIndex: number,
  { answerKey }: { answerKey: string },
) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/context`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ answerKey }),
  });

export const getProblemImage = async (assignmentId: string, problemIndex: number) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`);

export const saveProblemImage = async (assignmentId: string, problemIndex: number, file: Blob) => {
  if (isDebugImagesEnabled()) {
    const label = `gpt-problem-context-source-problem-${problemIndex}`;
    void debugEchoImage(file, label).catch(() => {});
  }

  const formData = new FormData();
  formData.append("file", file);
  await request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`, {
    method: "PUT",
    body: formData,
  });
};

export const downloadProblemImageBlob = async (assignmentId: string, problemIndex: number) => {
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

export const deleteProblemImage = async (assignmentId: string, problemIndex: number) =>
  request(`/assignments/${encodeURIComponent(assignmentId)}/problems/${problemIndex}/image`, {
    method: "DELETE",
  });
