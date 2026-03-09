import pg from "pg";

const { Pool } = pg;
const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;

const readDatabaseUrl = () => {
  const directUrl = globalThis.process?.env?.DATABASE_URL || "";
  if (directUrl) return directUrl;

  const host = globalThis.process?.env?.AZURE_POSTGRESQL_HOST || "";
  const port = globalThis.process?.env?.AZURE_POSTGRESQL_PORT || "5432";
  const database = globalThis.process?.env?.AZURE_POSTGRESQL_DATABASE || "";
  const user = globalThis.process?.env?.AZURE_POSTGRESQL_USER || "";
  const password = globalThis.process?.env?.AZURE_POSTGRESQL_PASSWORD || "";
  const azureSsl = String(globalThis.process?.env?.AZURE_POSTGRESQL_SSL || "").toLowerCase();

  if (!host || !database || !user || !password) return "";

  const query = azureSsl === "disable" ? "" : "?sslmode=require";
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${query}`;
};

const SSL_MODE =
  globalThis.process?.env?.PGSSL === "disable"
    ? false
    : { rejectUnauthorized: false };

let pool = null;
let initPromise = null;

const requireDatabaseUrl = () => {
  const databaseUrl = readDatabaseUrl();
  if (!databaseUrl) {
    throw new Error(
      "Database config is missing. Set DATABASE_URL or AZURE_POSTGRESQL_HOST/PORT/DATABASE/USER/PASSWORD.",
    );
  }
  return databaseUrl;
};

export const getPool = () => {
  const databaseUrl = requireDatabaseUrl();
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: SSL_MODE,
    });
  }
  return pool;
};

export const initDb = async () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const activePool = getPool();
    await activePool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        problem_count INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
    await activePool.query(`
      ALTER TABLE assignments
      ADD COLUMN IF NOT EXISTS problem_count INTEGER NOT NULL DEFAULT 1;
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_scenes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        scene JSONB NOT NULL,
        blob_name TEXT,
        file_name TEXT,
        content_type TEXT,
        size BIGINT,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      ALTER TABLE problem_scenes
      ADD COLUMN IF NOT EXISTS blob_name TEXT;
    `);
    await activePool.query(`
      ALTER TABLE problem_scenes
      ADD COLUMN IF NOT EXISTS file_name TEXT;
    `);
    await activePool.query(`
      ALTER TABLE problem_scenes
      ADD COLUMN IF NOT EXISTS content_type TEXT;
    `);
    await activePool.query(`
      ALTER TABLE problem_scenes
      ADD COLUMN IF NOT EXISTS size BIGINT;
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS assignment_pdfs (
        assignment_id TEXT PRIMARY KEY REFERENCES assignments(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        blob_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size BIGINT NOT NULL,
        uploaded_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_images (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        blob_name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_contexts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);
  })();

  return initPromise;
};

export const upsertUser = async (user) => {
  const now = Date.now();
  await getPool().query(
    `
      INSERT INTO app_users (id, name, email, provider, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        provider = EXCLUDED.provider,
        updated_at = EXCLUDED.updated_at;
    `,
    [user.id, user.name || "User", user.email || "", user.provider || "", now],
  );
};

const normalizeProblemCount = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return Math.min(MAX_PROBLEM_COUNT, Math.max(MIN_PROBLEM_COUNT, parsed));
};

const mapAssignment = (row) => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  problemCount: normalizeProblemCount(row.problem_count),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export const listAssignmentsForUser = async (userId) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, title, problem_count, created_at, updated_at
      FROM assignments
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `,
    [userId],
  );
  return rows.map(mapAssignment);
};

export const findAssignmentById = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, title, problem_count, created_at, updated_at
      FROM assignments
      WHERE user_id = $1 AND id = $2
      LIMIT 1;
    `,
    [userId, assignmentId],
  );
  if (rows.length === 0) return null;
  return mapAssignment(rows[0]);
};

export const insertAssignment = async (userId, title, problemCount = MIN_PROBLEM_COUNT) => {
  const now = Date.now();
  const id = `assignment-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const normalizedCount = normalizeProblemCount(problemCount);
  await getPool().query(
    `
      INSERT INTO assignments (id, user_id, title, problem_count, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5);
    `,
    [id, userId, title, normalizedCount, now],
  );
  return {
    id,
    userId,
    title,
    problemCount: normalizedCount,
    createdAt: now,
    updatedAt: now,
  };
};

export const setAssignmentProblemCount = async (userId, assignmentId, problemCount) => {
  const normalizedCount = normalizeProblemCount(problemCount);
  const now = Date.now();
  const { rows } = await getPool().query(
    `
      UPDATE assignments
      SET problem_count = $3, updated_at = $4
      WHERE user_id = $1 AND id = $2
      RETURNING id, user_id, title, problem_count, created_at, updated_at;
    `,
    [userId, assignmentId, normalizedCount, now],
  );
  if (rows.length === 0) return null;
  return mapAssignment(rows[0]);
};

export const removeAssignment = async (userId, assignmentId) => {
  await getPool().query(
    `
      DELETE FROM assignments
      WHERE user_id = $1 AND id = $2;
    `,
    [userId, assignmentId],
  );
};

const mapAssignmentPdf = (row) => ({
  assignmentId: row.assignment_id,
  userId: row.user_id,
  blobName: row.blob_name,
  fileName: row.file_name,
  contentType: row.content_type,
  size: Number(row.size),
  uploadedAt: Number(row.uploaded_at),
  updatedAt: Number(row.updated_at),
});

export const getAssignmentPdfByAssignmentId = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT assignment_id, user_id, blob_name, file_name, content_type, size, uploaded_at, updated_at
      FROM assignment_pdfs
      WHERE user_id = $1 AND assignment_id = $2
      LIMIT 1;
    `,
    [userId, assignmentId],
  );

  if (rows.length === 0) return null;
  return mapAssignmentPdf(rows[0]);
};

export const upsertAssignmentPdf = async ({
  assignmentId,
  userId,
  blobName,
  fileName,
  contentType,
  size,
}) => {
  const now = Date.now();
  const { rows } = await getPool().query(
    `
      INSERT INTO assignment_pdfs (
        assignment_id, user_id, blob_name, file_name, content_type, size, uploaded_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      ON CONFLICT (assignment_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        blob_name = EXCLUDED.blob_name,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        size = EXCLUDED.size,
        uploaded_at = EXCLUDED.uploaded_at,
        updated_at = EXCLUDED.updated_at
      RETURNING assignment_id, user_id, blob_name, file_name, content_type, size, uploaded_at, updated_at;
    `,
    [assignmentId, userId, blobName, fileName, contentType, size, now],
  );
  return mapAssignmentPdf(rows[0]);
};

export const removeAssignmentPdf = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      DELETE FROM assignment_pdfs
      WHERE user_id = $1 AND assignment_id = $2
      RETURNING assignment_id, user_id, blob_name, file_name, content_type, size, uploaded_at, updated_at;
    `,
    [userId, assignmentId],
  );
  if (rows.length === 0) return null;
  return mapAssignmentPdf(rows[0]);
};

export const listAssignmentPdfsForUser = async (userId) => {
  const { rows } = await getPool().query(
    `
      SELECT assignment_id, user_id, blob_name, file_name, content_type, size, uploaded_at, updated_at
      FROM assignment_pdfs
      WHERE user_id = $1;
    `,
    [userId],
  );
  return rows.map(mapAssignmentPdf);
};

export const getScene = async (userId, assignmentId, problemIndex) => {
  const sceneId = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, scene, blob_name, file_name, content_type, size, updated_at
      FROM problem_scenes
      WHERE id = $1
      LIMIT 1;
    `,
    [sceneId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    assignmentId: row.assignment_id,
    problemIndex: Number(row.problem_index),
    scene: row.scene,
    blobName: row.blob_name || null,
    fileName: row.file_name || null,
    contentType: row.content_type || null,
    size: row.size != null ? Number(row.size) : null,
    updatedAt: Number(row.updated_at),
  };
};

export const upsertScene = async (
  userId,
  assignmentId,
  problemIndex,
  scene,
  { blobName = null, fileName = null, contentType = null, size = null } = {},
) => {
  const sceneId = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  await getPool().query(
    `
      INSERT INTO problem_scenes (
        id, user_id, assignment_id, problem_index, scene, blob_name, file_name, content_type, size, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
      ON CONFLICT (id)
      DO UPDATE SET
        scene = EXCLUDED.scene,
        blob_name = EXCLUDED.blob_name,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        size = EXCLUDED.size,
        updated_at = EXCLUDED.updated_at;
    `,
    [
      sceneId,
      userId,
      assignmentId,
      problemIndex,
      JSON.stringify(scene || null),
      blobName,
      fileName,
      contentType,
      size,
      now,
    ],
  );
  return {
    id: sceneId,
    userId,
    assignmentId,
    problemIndex,
    scene: scene || null,
    blobName,
    fileName,
    contentType,
    size,
    updatedAt: now,
  };
};

export const listSceneBlobNamesForAssignment = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT blob_name
      FROM problem_scenes
      WHERE user_id = $1 AND assignment_id = $2 AND blob_name IS NOT NULL;
    `,
    [userId, assignmentId],
  );
  return rows
    .map((row) => row.blob_name)
    .filter((blobName) => typeof blobName === "string" && blobName.length > 0);
};

export const removeScene = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      DELETE FROM problem_scenes
      WHERE id = $1
      RETURNING id, user_id, assignment_id, problem_index, scene, blob_name, file_name, content_type, size, updated_at;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    assignmentId: row.assignment_id,
    problemIndex: Number(row.problem_index),
    scene: row.scene,
    blobName: row.blob_name || null,
    fileName: row.file_name || null,
    contentType: row.content_type || null,
    size: row.size != null ? Number(row.size) : null,
    updatedAt: Number(row.updated_at),
  };
};

const mapProblemImage = (row) => ({
  id: row.id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  blobName: row.blob_name,
  fileName: row.file_name,
  contentType: row.content_type,
  size: Number(row.size),
  updatedAt: Number(row.updated_at),
});

export const getProblemImage = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, blob_name, file_name, content_type, size, updated_at
      FROM problem_images
      WHERE id = $1
      LIMIT 1;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemImage(rows[0]);
};

export const upsertProblemImage = async (
  userId,
  assignmentId,
  problemIndex,
  { blobName, fileName, contentType, size },
) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_images (
        id, user_id, assignment_id, problem_index, blob_name, file_name, content_type, size, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id)
      DO UPDATE SET
        blob_name = EXCLUDED.blob_name,
        file_name = EXCLUDED.file_name,
        content_type = EXCLUDED.content_type,
        size = EXCLUDED.size,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, blob_name, file_name, content_type, size, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, blobName, fileName, contentType, size, now],
  );
  return mapProblemImage(rows[0]);
};

export const removeProblemImage = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      DELETE FROM problem_images
      WHERE id = $1
      RETURNING id, user_id, assignment_id, problem_index, blob_name, file_name, content_type, size, updated_at;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemImage(rows[0]);
};

export const listProblemImageBlobNamesForAssignment = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT blob_name
      FROM problem_images
      WHERE user_id = $1 AND assignment_id = $2;
    `,
    [userId, assignmentId],
  );
  return rows
    .map((row) => row.blob_name)
    .filter((blobName) => typeof blobName === "string" && blobName.length > 0);
};

export const listProblemImageBlobNamesForUser = async (userId) => {
  const { rows } = await getPool().query(
    `
      SELECT blob_name
      FROM problem_images
      WHERE user_id = $1;
    `,
    [userId],
  );
  return rows
    .map((row) => row.blob_name)
    .filter((blobName) => typeof blobName === "string" && blobName.length > 0);
};

const mapProblemContext = (row) => ({
  id: row.id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  content: row.content,
  updatedAt: Number(row.updated_at),
});

export const getProblemContext = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, content, updated_at
      FROM problem_contexts
      WHERE id = $1
      LIMIT 1;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemContext(rows[0]);
};

export const upsertProblemContext = async (
  userId,
  assignmentId,
  problemIndex,
  content,
) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_contexts (
        id, user_id, assignment_id, problem_index, content, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id)
      DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, content, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, content, now],
  );
  return mapProblemContext(rows[0]);
};

export const removeProblemContext = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      DELETE FROM problem_contexts
      WHERE id = $1
      RETURNING id, user_id, assignment_id, problem_index, content, updated_at;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemContext(rows[0]);
};

export const deleteUserData = async (userId) => {
  await getPool().query("DELETE FROM app_users WHERE id = $1;", [userId]);
};
