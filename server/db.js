import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = globalThis.process?.env?.DATABASE_URL || "";
const SSL_MODE =
  globalThis.process?.env?.PGSSL === "disable"
    ? false
    : { rejectUnauthorized: false };

let pool = null;
let initPromise = null;

const requireDatabaseUrl = () => {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }
};

export const getPool = () => {
  requireDatabaseUrl();
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
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
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_scenes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        scene JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      );
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

export const listAssignmentsForUser = async (userId) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, title, created_at, updated_at
      FROM assignments
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
};

export const findAssignmentById = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, title, created_at, updated_at
      FROM assignments
      WHERE user_id = $1 AND id = $2
      LIMIT 1;
    `,
    [userId, assignmentId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
};

export const insertAssignment = async (userId, title) => {
  const now = Date.now();
  const id = `assignment-${now}-${Math.random().toString(36).slice(2, 8)}`;
  await getPool().query(
    `
      INSERT INTO assignments (id, user_id, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4);
    `,
    [id, userId, title, now],
  );
  return { id, userId, title, createdAt: now, updatedAt: now };
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
      SELECT id, user_id, assignment_id, problem_index, scene, updated_at
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
    updatedAt: Number(row.updated_at),
  };
};

export const upsertScene = async (userId, assignmentId, problemIndex, scene) => {
  const sceneId = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  await getPool().query(
    `
      INSERT INTO problem_scenes (
        id, user_id, assignment_id, problem_index, scene, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (id)
      DO UPDATE SET
        scene = EXCLUDED.scene,
        updated_at = EXCLUDED.updated_at;
    `,
    [sceneId, userId, assignmentId, problemIndex, JSON.stringify(scene || null), now],
  );
  return {
    id: sceneId,
    userId,
    assignmentId,
    problemIndex,
    scene: scene || null,
    updatedAt: now,
  };
};

export const deleteUserData = async (userId) => {
  await getPool().query("DELETE FROM app_users WHERE id = $1;", [userId]);
};
