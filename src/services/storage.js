const DB_NAME = "stepwise_app_db";
const DB_VERSION = 1;

const STORES = {
  assignments: "assignments",
  assignmentFiles: "assignment_files",
  problemScenes: "problem_scenes",
};

const ACTIVE_USER_KEY = "stepwise.active_user";

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.assignments)) {
        db.createObjectStore(STORES.assignments, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.assignmentFiles)) {
        db.createObjectStore(STORES.assignmentFiles, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.problemScenes)) {
        db.createObjectStore(STORES.problemScenes, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const makeAssignmentId = () =>
  `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const makeFileId = (userId, assignmentId) => `${userId}:${assignmentId}`;
const makeSceneId = (userId, assignmentId, problemIndex) =>
  `${userId}:${assignmentId}:${problemIndex}`;

export const getActiveUser = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setActiveUser = (user) => {
  localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user));
};

export const clearActiveUser = () => {
  localStorage.removeItem(ACTIVE_USER_KEY);
};

export const listAssignments = async (userId) => {
  const db = await openDb();
  const tx = db.transaction(STORES.assignments, "readonly");
  const store = tx.objectStore(STORES.assignments);
  const all = await requestToPromise(store.getAll());
  return all
    .filter((assignment) => assignment.userId === userId)
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const getAssignmentById = async (assignmentId) => {
  const db = await openDb();
  const tx = db.transaction(STORES.assignments, "readonly");
  const store = tx.objectStore(STORES.assignments);
  return requestToPromise(store.get(assignmentId));
};

export const createAssignment = async (userId, title) => {
  const now = Date.now();
  const assignment = {
    id: makeAssignmentId(),
    userId,
    title: title.trim(),
    createdAt: now,
    updatedAt: now,
  };

  const db = await openDb();
  const tx = db.transaction(STORES.assignments, "readwrite");
  tx.objectStore(STORES.assignments).put(assignment);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return assignment;
};

export const deleteAssignment = async (userId, assignmentId) => {
  const db = await openDb();
  const tx = db.transaction(
    [STORES.assignments, STORES.assignmentFiles, STORES.problemScenes],
    "readwrite",
  );

  tx.objectStore(STORES.assignments).delete(assignmentId);
  tx.objectStore(STORES.assignmentFiles).delete(makeFileId(userId, assignmentId));

  const scenesStore = tx.objectStore(STORES.problemScenes);
  const scenes = await requestToPromise(scenesStore.getAll());
  scenes
    .filter(
      (scene) =>
        scene.userId === userId &&
        scene.assignmentId === assignmentId,
    )
    .forEach((scene) => scenesStore.delete(scene.id));

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const saveAssignmentPdf = async (userId, assignmentId, file) => {
  const db = await openDb();
  const tx = db.transaction(STORES.assignmentFiles, "readwrite");
  const store = tx.objectStore(STORES.assignmentFiles);

  const record = {
    id: makeFileId(userId, assignmentId),
    userId,
    assignmentId,
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    size: file.size,
    uploadedAt: Date.now(),
    blob: file,
  };

  store.put(record);

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return record;
};

export const getAssignmentPdf = async (userId, assignmentId) => {
  const db = await openDb();
  const tx = db.transaction(STORES.assignmentFiles, "readonly");
  const store = tx.objectStore(STORES.assignmentFiles);
  return requestToPromise(store.get(makeFileId(userId, assignmentId)));
};

export const deleteAssignmentPdf = async (userId, assignmentId) => {
  const db = await openDb();
  const tx = db.transaction(STORES.assignmentFiles, "readwrite");
  tx.objectStore(STORES.assignmentFiles).delete(makeFileId(userId, assignmentId));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const getProblemScene = async (userId, assignmentId, problemIndex) => {
  const db = await openDb();
  const tx = db.transaction(STORES.problemScenes, "readonly");
  const store = tx.objectStore(STORES.problemScenes);
  return requestToPromise(store.get(makeSceneId(userId, assignmentId, problemIndex)));
};

export const saveProblemScene = async (
  userId,
  assignmentId,
  problemIndex,
  scene,
) => {
  const db = await openDb();
  const tx = db.transaction(STORES.problemScenes, "readwrite");
  const store = tx.objectStore(STORES.problemScenes);

  store.put({
    id: makeSceneId(userId, assignmentId, problemIndex),
    userId,
    assignmentId,
    problemIndex,
    scene,
    updatedAt: Date.now(),
  });

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
