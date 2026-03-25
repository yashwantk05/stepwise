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
        answer_key TEXT,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      ALTER TABLE problem_contexts
      ADD COLUMN IF NOT EXISTS answer_key TEXT;
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_titles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        attempted_at BIGINT,
        solved_at BIGINT,
        total_time_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_progress_assignment
      ON problem_progress (user_id, assignment_id, problem_index);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS notebook_quiz_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL,
        subject_name TEXT NOT NULL DEFAULT '',
        attempted_at BIGINT,
        solved_at BIGINT,
        total_questions INTEGER NOT NULL DEFAULT 0,
        correct_count INTEGER NOT NULL DEFAULT 0,
        mistake_count INTEGER NOT NULL DEFAULT 0,
        total_time_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL,
        UNIQUE (user_id, subject_id)
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_notebook_quiz_sessions_user
      ON notebook_quiz_sessions (user_id, updated_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS study_tool_cache (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        subject TEXT NOT NULL,
        notes_signature TEXT NOT NULL,
        output JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE (user_id, tool, subject, notes_signature)
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_study_tool_cache_lookup
      ON study_tool_cache (user_id, tool, subject, notes_signature, updated_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_error_attempts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'error_analysis',
        attempt_number INTEGER NOT NULL,
        observed_step TEXT,
        stage TEXT,
        correctness TEXT NOT NULL,
        confidence TEXT NOT NULL,
        hint_level INTEGER,
        raw_analysis JSONB,
        created_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_error_attempts_problem
      ON problem_error_attempts (user_id, assignment_id, problem_index, created_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_error_items (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL REFERENCES problem_error_attempts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        problem_index INTEGER NOT NULL,
        ordinal INTEGER NOT NULL,
        error_type TEXT,
        mistake_summary TEXT NOT NULL,
        why_wrong TEXT,
        suggested_fix TEXT,
        severity TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        UNIQUE (attempt_id, ordinal)
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_error_items_problem
      ON problem_error_items (user_id, assignment_id, problem_index, created_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_error_item_topics (
        error_item_id TEXT NOT NULL REFERENCES problem_error_items(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        PRIMARY KEY (error_item_id, topic)
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_error_item_topics_topic
      ON problem_error_item_topics (topic);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS problem_error_item_concepts (
        error_item_id TEXT NOT NULL REFERENCES problem_error_items(id) ON DELETE CASCADE,
        concept TEXT NOT NULL,
        PRIMARY KEY (error_item_id, concept)
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_problem_error_item_concepts_concept
      ON problem_error_item_concepts (concept);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS notebook_subjects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_notebook_subjects_user
      ON notebook_subjects (user_id, updated_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS notebook_notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        subject_id TEXT NOT NULL REFERENCES notebook_subjects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        source_type TEXT NOT NULL DEFAULT 'text',
        blob_name TEXT,
        file_name TEXT,
        content_type TEXT,
        file_size BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_notebook_notes_subject
      ON notebook_notes (user_id, subject_id, updated_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS socratic_chat_threads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_socratic_chat_threads_user
      ON socratic_chat_threads (user_id, updated_at DESC);
    `);

    await activePool.query(`
      CREATE TABLE IF NOT EXISTS socratic_chat_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES socratic_chat_threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL
      );
    `);

    await activePool.query(`
      ALTER TABLE socratic_chat_messages
      ADD COLUMN IF NOT EXISTS thread_id TEXT REFERENCES socratic_chat_threads(id) ON DELETE CASCADE;
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_socratic_chat_messages_user
      ON socratic_chat_messages (user_id, created_at DESC);
    `);

    await activePool.query(`
      CREATE INDEX IF NOT EXISTS idx_socratic_chat_messages_thread
      ON socratic_chat_messages (user_id, thread_id, created_at ASC);
    `);

    await activePool.query(`
      INSERT INTO socratic_chat_threads (id, user_id, title, created_at, updated_at)
      SELECT
        'socratic-thread-legacy-' || md5(user_id),
        user_id,
        'Previous chat',
        MIN(created_at),
        MAX(created_at)
      FROM socratic_chat_messages
      WHERE thread_id IS NULL
      GROUP BY user_id
      ON CONFLICT (id) DO NOTHING;
    `);

    await activePool.query(`
      UPDATE socratic_chat_messages
      SET thread_id = 'socratic-thread-legacy-' || md5(user_id)
      WHERE thread_id IS NULL;
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
  answerKey: row.answer_key || "",
  updatedAt: Number(row.updated_at),
});

export const getProblemContext = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, content, answer_key, updated_at
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
  answerKey = null,
) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_contexts (
        id, user_id, assignment_id, problem_index, content, answer_key, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id)
      DO UPDATE SET
        content = EXCLUDED.content,
        answer_key = EXCLUDED.answer_key,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, content, answer_key, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, content, answerKey, now],
  );
  return mapProblemContext(rows[0]);
};

export const setProblemAnswerKey = async (
  userId,
  assignmentId,
  problemIndex,
  answerKey,
) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  const normalizedAnswerKey = String(answerKey || "").trim() || null;
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_contexts (
        id, user_id, assignment_id, problem_index, content, answer_key, updated_at
      )
      VALUES ($1, $2, $3, $4, '', $5, $6)
      ON CONFLICT (id)
      DO UPDATE SET
        answer_key = EXCLUDED.answer_key,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, content, answer_key, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, normalizedAnswerKey, now],
  );
  return mapProblemContext(rows[0]);
};

export const removeProblemContext = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      DELETE FROM problem_contexts
      WHERE id = $1
      RETURNING id, user_id, assignment_id, problem_index, content, answer_key, updated_at;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemContext(rows[0]);
};

const mapProblemTitle = (row) => ({
  id: row.id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  title: String(row.title || "").trim(),
  updatedAt: Number(row.updated_at),
});

export const listProblemTitles = async (userId, assignmentId) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, title, updated_at
      FROM problem_titles
      WHERE user_id = $1 AND assignment_id = $2
      ORDER BY problem_index ASC;
    `,
    [userId, assignmentId],
  );
  return rows.map(mapProblemTitle);
};

export const setProblemTitle = async (userId, assignmentId, problemIndex, title) => {
  const normalizedTitle = String(title || "").trim();
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  if (!normalizedTitle) {
    await getPool().query(`DELETE FROM problem_titles WHERE id = $1;`, [id]);
    return null;
  }

  const now = Date.now();
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_titles (id, user_id, assignment_id, problem_index, title, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id)
      DO UPDATE SET
        title = EXCLUDED.title,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, title, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, normalizedTitle, now],
  );
  return mapProblemTitle(rows[0]);
};

export const removeProblemTitle = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      DELETE FROM problem_titles
      WHERE id = $1
      RETURNING id, user_id, assignment_id, problem_index, title, updated_at;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemTitle(rows[0]);
};

export const shiftProblemIndexesAfter = async (userId, assignmentId, removedProblemIndex) => {
  const tablesWithCompositeId = ["problem_scenes", "problem_images", "problem_contexts", "problem_titles"];
  const tablesWithoutCompositeId = ["problem_progress", "problem_error_attempts", "problem_error_items"];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    for (const tableName of tablesWithCompositeId) {
      await client.query(
        `
          UPDATE ${tableName}
          SET
            problem_index = -problem_index,
            id = user_id || ':' || assignment_id || ':' || (-problem_index)
          WHERE user_id = $1 AND assignment_id = $2 AND problem_index > $3;
        `,
        [userId, assignmentId, removedProblemIndex],
      );

      await client.query(
        `
          UPDATE ${tableName}
          SET
            problem_index = (-problem_index) - 1,
            id = user_id || ':' || assignment_id || ':' || (((-problem_index) - 1))
          WHERE user_id = $1 AND assignment_id = $2 AND problem_index < 0;
        `,
        [userId, assignmentId],
      );
    }

    for (const tableName of tablesWithoutCompositeId) {
      await client.query(
        `
          UPDATE ${tableName}
          SET problem_index = problem_index - 1
          WHERE user_id = $1 AND assignment_id = $2 AND problem_index > $3;
        `,
        [userId, assignmentId, removedProblemIndex],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const deleteUserData = async (userId) => {
  await getPool().query("DELETE FROM app_users WHERE id = $1;", [userId]);
};

const mapProblemErrorAttempt = (row) => ({
  id: row.id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  source: row.source,
  attemptNumber: Number(row.attempt_number),
  observedStep: row.observed_step || "",
  stage: row.stage || "",
  correctness: row.correctness,
  confidence: row.confidence,
  hintLevel: row.hint_level == null ? null : Number(row.hint_level),
  rawAnalysis: row.raw_analysis || null,
  createdAt: Number(row.created_at),
});

const mapProblemProgress = (row) => ({
  id: row.id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  attempted: row.attempted_at != null,
  solved: row.solved_at != null,
  attemptedAt: row.attempted_at == null ? null : Number(row.attempted_at),
  solvedAt: row.solved_at == null ? null : Number(row.solved_at),
  totalTimeSeconds: Number(row.total_time_seconds || 0),
  mistakeCount: Number(row.mistake_count || 0),
  updatedAt: Number(row.updated_at),
});

const mapNotebookQuizSession = (row) => ({
  id: row.id,
  userId: row.user_id,
  subjectId: row.subject_id,
  subjectName: row.subject_name || "",
  attempted: row.attempted_at != null,
  solved: row.solved_at != null,
  attemptedAt: row.attempted_at == null ? null : Number(row.attempted_at),
  solvedAt: row.solved_at == null ? null : Number(row.solved_at),
  totalQuestions: Number(row.total_questions || 0),
  correctCount: Number(row.correct_count || 0),
  mistakeCount: Number(row.mistake_count || 0),
  totalTimeSeconds: Number(row.total_time_seconds || 0),
  updatedAt: Number(row.updated_at),
});

const mapProblemErrorItem = (row) => ({
  id: row.id,
  attemptId: row.attempt_id,
  userId: row.user_id,
  assignmentId: row.assignment_id,
  problemIndex: Number(row.problem_index),
  ordinal: Number(row.ordinal),
  errorType: row.error_type || "",
  mistakeSummary: row.mistake_summary,
  whyWrong: row.why_wrong || "",
  suggestedFix: row.suggested_fix || "",
  severity: row.severity,
  topics: Array.isArray(row.topics) ? row.topics.filter(Boolean) : [],
  concepts: Array.isArray(row.concepts) ? row.concepts.filter(Boolean) : [],
  createdAt: Number(row.created_at),
});

export const removeProblemErrors = async (userId, assignmentId, problemIndex) => {
  await getPool().query(
    `
      DELETE FROM problem_error_attempts
      WHERE user_id = $1 AND assignment_id = $2 AND problem_index = $3;
    `,
    [userId, assignmentId, problemIndex],
  );
};

export const getProblemProgress = async (userId, assignmentId, problemIndex) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const { rows } = await getPool().query(
    `
      SELECT
        p.id,
        p.user_id,
        p.assignment_id,
        p.problem_index,
        p.attempted_at,
        p.solved_at,
        p.total_time_seconds,
        p.updated_at,
        COALESCE(m.mistake_count, 0) AS mistake_count
      FROM problem_progress p
      LEFT JOIN (
        SELECT user_id, assignment_id, problem_index, COUNT(*)::INT AS mistake_count
        FROM problem_error_items
        GROUP BY user_id, assignment_id, problem_index
      ) m
        ON m.user_id = p.user_id
       AND m.assignment_id = p.assignment_id
       AND m.problem_index = p.problem_index
      WHERE p.id = $1
      LIMIT 1;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapProblemProgress(rows[0]);
};

export const listProblemProgressForAssignment = async (userId, assignmentId, problemCount) => {
  const normalizedProblemCount = Math.max(1, Number(problemCount) || 1);
  const { rows } = await getPool().query(
    `
      SELECT
        p.id,
        p.user_id,
        p.assignment_id,
        p.problem_index,
        p.attempted_at,
        p.solved_at,
        p.total_time_seconds,
        p.updated_at,
        COALESCE(m.mistake_count, 0) AS mistake_count
      FROM problem_progress p
      LEFT JOIN (
        SELECT user_id, assignment_id, problem_index, COUNT(*)::INT AS mistake_count
        FROM problem_error_items
        WHERE user_id = $1 AND assignment_id = $2
        GROUP BY user_id, assignment_id, problem_index
      ) m
        ON m.user_id = p.user_id
       AND m.assignment_id = p.assignment_id
       AND m.problem_index = p.problem_index
      WHERE p.user_id = $1 AND p.assignment_id = $2
      ORDER BY p.problem_index ASC;
    `,
    [userId, assignmentId],
  );

  const progressByIndex = new Map(rows.map((row) => [Number(row.problem_index), mapProblemProgress(row)]));
  return Array.from({ length: normalizedProblemCount }, (_value, index) => {
    const problemIndex = index + 1;
    return (
      progressByIndex.get(problemIndex) || {
        id: `${userId}:${assignmentId}:${problemIndex}`,
        userId,
        assignmentId,
        problemIndex,
        attempted: false,
        solved: false,
        attemptedAt: null,
        solvedAt: null,
        totalTimeSeconds: 0,
        mistakeCount: 0,
        updatedAt: 0,
      }
    );
  });
};

export const upsertProblemProgress = async (
  userId,
  assignmentId,
  problemIndex,
  { attempted = false, solved = false, addTimeSeconds = 0 } = {},
) => {
  const id = `${userId}:${assignmentId}:${problemIndex}`;
  const now = Date.now();
  const normalizedAddTime = Math.max(0, Number(addTimeSeconds) || 0);
  const attemptedAt = attempted ? now : null;
  const solvedAt = solved ? now : null;
  const { rows } = await getPool().query(
    `
      INSERT INTO problem_progress (
        id, user_id, assignment_id, problem_index, attempted_at, solved_at, total_time_seconds, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id)
      DO UPDATE SET
        attempted_at = COALESCE(problem_progress.attempted_at, EXCLUDED.attempted_at),
        solved_at = CASE
          WHEN EXCLUDED.solved_at IS NOT NULL THEN COALESCE(problem_progress.solved_at, EXCLUDED.solved_at)
          ELSE problem_progress.solved_at
        END,
        total_time_seconds = GREATEST(0, problem_progress.total_time_seconds + EXCLUDED.total_time_seconds),
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, assignment_id, problem_index, attempted_at, solved_at, total_time_seconds, updated_at;
    `,
    [id, userId, assignmentId, problemIndex, attemptedAt, solvedAt, normalizedAddTime, now],
  );
  const progress = mapProblemProgress({ ...rows[0], mistake_count: 0 });
  const { rows: mistakeRows } = await getPool().query(
    `
      SELECT COUNT(*)::INT AS mistake_count
      FROM problem_error_items
      WHERE user_id = $1 AND assignment_id = $2 AND problem_index = $3;
    `,
    [userId, assignmentId, problemIndex],
  );
  progress.mistakeCount = Number(mistakeRows[0]?.mistake_count || 0);
  return progress;
};

export const getNotebookQuizSession = async (userId, subjectId) => {
  const id = `${userId}:quiz:${subjectId}`;
  const { rows } = await getPool().query(
    `
      SELECT
        id, user_id, subject_id, subject_name, attempted_at, solved_at,
        total_questions, correct_count, mistake_count, total_time_seconds, updated_at
      FROM notebook_quiz_sessions
      WHERE id = $1
      LIMIT 1;
    `,
    [id],
  );
  if (rows.length === 0) return null;
  return mapNotebookQuizSession(rows[0]);
};

export const listNotebookQuizSessions = async (userId) => {
  const { rows } = await getPool().query(
    `
      SELECT
        id, user_id, subject_id, subject_name, attempted_at, solved_at,
        total_questions, correct_count, mistake_count, total_time_seconds, updated_at
      FROM notebook_quiz_sessions
      WHERE user_id = $1
      ORDER BY updated_at DESC;
    `,
    [userId],
  );
  return rows.map(mapNotebookQuizSession);
};

export const upsertNotebookQuizSession = async (
  userId,
  subjectId,
  {
    subjectName = "",
    attempted = false,
    solved = false,
    totalQuestions = null,
    correctCount = null,
    mistakeCount = null,
    addTimeSeconds = 0,
  } = {},
) => {
  const id = `${userId}:quiz:${subjectId}`;
  const now = Date.now();
  const normalizedSubjectName = String(subjectName || "").trim();
  const normalizedAddTime = Math.max(0, Number(addTimeSeconds) || 0);
  const normalizedTotalQuestions = Number.isInteger(Number(totalQuestions)) ? Math.max(0, Number(totalQuestions)) : null;
  const normalizedCorrectCount = Number.isInteger(Number(correctCount)) ? Math.max(0, Number(correctCount)) : null;
  const normalizedMistakeCount = Number.isInteger(Number(mistakeCount)) ? Math.max(0, Number(mistakeCount)) : null;
  const attemptedAt = attempted ? now : null;
  const solvedAt = solved ? now : null;

  const { rows } = await getPool().query(
    `
      INSERT INTO notebook_quiz_sessions (
        id, user_id, subject_id, subject_name, attempted_at, solved_at,
        total_questions, correct_count, mistake_count, total_time_seconds, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id)
      DO UPDATE SET
        subject_name = CASE
          WHEN EXCLUDED.subject_name <> '' THEN EXCLUDED.subject_name
          ELSE notebook_quiz_sessions.subject_name
        END,
        attempted_at = COALESCE(notebook_quiz_sessions.attempted_at, EXCLUDED.attempted_at),
        solved_at = CASE
          WHEN EXCLUDED.solved_at IS NOT NULL THEN COALESCE(notebook_quiz_sessions.solved_at, EXCLUDED.solved_at)
          ELSE notebook_quiz_sessions.solved_at
        END,
        total_questions = CASE
          WHEN EXCLUDED.total_questions > 0 THEN EXCLUDED.total_questions
          ELSE notebook_quiz_sessions.total_questions
        END,
        correct_count = CASE
          WHEN EXCLUDED.correct_count >= 0 THEN EXCLUDED.correct_count
          ELSE notebook_quiz_sessions.correct_count
        END,
        mistake_count = CASE
          WHEN EXCLUDED.mistake_count >= 0 THEN EXCLUDED.mistake_count
          ELSE notebook_quiz_sessions.mistake_count
        END,
        total_time_seconds = GREATEST(0, notebook_quiz_sessions.total_time_seconds + EXCLUDED.total_time_seconds),
        updated_at = EXCLUDED.updated_at
      RETURNING
        id, user_id, subject_id, subject_name, attempted_at, solved_at,
        total_questions, correct_count, mistake_count, total_time_seconds, updated_at;
    `,
    [
      id,
      userId,
      subjectId,
      normalizedSubjectName,
      attemptedAt,
      solvedAt,
      normalizedTotalQuestions ?? 0,
      normalizedCorrectCount ?? 0,
      normalizedMistakeCount ?? 0,
      normalizedAddTime,
      now,
    ],
  );
  return mapNotebookQuizSession(rows[0]);
};

const mapStudyToolCache = (row) => ({
  id: row.id,
  userId: row.user_id,
  tool: row.tool,
  subject: row.subject,
  notesSignature: row.notes_signature,
  output: row.output,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export const getStudyToolCache = async (userId, { tool, subject, notesSignature }) => {
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, tool, subject, notes_signature, output, created_at, updated_at
      FROM study_tool_cache
      WHERE user_id = $1 AND tool = $2 AND subject = $3 AND notes_signature = $4
      ORDER BY updated_at DESC
      LIMIT 1;
    `,
    [userId, tool, subject, notesSignature],
  );
  if (rows.length === 0) return null;
  return mapStudyToolCache(rows[0]);
};

export const upsertStudyToolCache = async (
  userId,
  { tool, subject, notesSignature, output },
) => {
  const now = Date.now();
  const id = `${userId}:study-tool:${tool}:${subject}:${notesSignature}`;
  const { rows } = await getPool().query(
    `
      INSERT INTO study_tool_cache (
        id, user_id, tool, subject, notes_signature, output, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
      ON CONFLICT (user_id, tool, subject, notes_signature)
      DO UPDATE SET
        output = EXCLUDED.output,
        updated_at = EXCLUDED.updated_at
      RETURNING id, user_id, tool, subject, notes_signature, output, created_at, updated_at;
    `,
    [id, userId, tool, subject, notesSignature, JSON.stringify(output || null), now],
  );
  return mapStudyToolCache(rows[0]);
};

export const createProblemErrorAttempt = async (
  userId,
  assignmentId,
  problemIndex,
  {
    source = "error_analysis",
    observedStep = "",
    stage = "",
    correctness = "unclear",
    confidence = "low",
    hintLevel = null,
    rawAnalysis = null,
    mistakes = [],
  } = {},
) => {
  const client = await getPool().connect();
  const now = Date.now();
  const attemptId = `error-attempt-${now}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    await client.query("BEGIN");

    const nextAttemptResult = await client.query(
      `
        SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
        FROM problem_error_attempts
        WHERE user_id = $1 AND assignment_id = $2 AND problem_index = $3;
      `,
      [userId, assignmentId, problemIndex],
    );
    const attemptNumber = Number(nextAttemptResult.rows[0]?.next_attempt || 1);

    const attemptInsert = await client.query(
      `
        INSERT INTO problem_error_attempts (
          id, user_id, assignment_id, problem_index, source, attempt_number,
          observed_step, stage, correctness, confidence, hint_level, raw_analysis, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        RETURNING id, user_id, assignment_id, problem_index, source, attempt_number,
                  observed_step, stage, correctness, confidence, hint_level, raw_analysis, created_at;
      `,
      [
        attemptId,
        userId,
        assignmentId,
        problemIndex,
        source,
        attemptNumber,
        observedStep || null,
        stage || null,
        correctness,
        confidence,
        Number.isInteger(hintLevel) ? hintLevel : null,
        JSON.stringify(rawAnalysis || null),
        now,
      ],
    );

    const createdItems = [];
    for (let index = 0; index < mistakes.length; index += 1) {
      const entry = mistakes[index] || {};
      const itemId = `error-item-${now}-${index + 1}-${Math.random().toString(36).slice(2, 10)}`;
      const ordinal = index + 1;
      const itemInsert = await client.query(
        `
          INSERT INTO problem_error_items (
            id, attempt_id, user_id, assignment_id, problem_index, ordinal, error_type,
            mistake_summary, why_wrong, suggested_fix, severity, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id, attempt_id, user_id, assignment_id, problem_index, ordinal, error_type,
                    mistake_summary, why_wrong, suggested_fix, severity, created_at;
        `,
        [
          itemId,
          attemptId,
          userId,
          assignmentId,
          problemIndex,
          ordinal,
          entry.errorType || null,
          entry.mistakeSummary,
          entry.whyWrong || null,
          entry.suggestedFix || null,
          entry.severity,
          now,
        ],
      );

      const normalizedTopics = Array.isArray(entry.topics) ? entry.topics : [];
      const normalizedConcepts = Array.isArray(entry.concepts) ? entry.concepts : [];

      for (const topic of normalizedTopics) {
        await client.query(
          `
            INSERT INTO problem_error_item_topics (error_item_id, topic)
            VALUES ($1, $2)
            ON CONFLICT (error_item_id, topic) DO NOTHING;
          `,
          [itemId, topic],
        );
      }

      for (const concept of normalizedConcepts) {
        await client.query(
          `
            INSERT INTO problem_error_item_concepts (error_item_id, concept)
            VALUES ($1, $2)
            ON CONFLICT (error_item_id, concept) DO NOTHING;
          `,
          [itemId, concept],
        );
      }

      createdItems.push({
        ...mapProblemErrorItem(itemInsert.rows[0]),
        topics: normalizedTopics,
        concepts: normalizedConcepts,
      });
    }

    await client.query("COMMIT");
    return {
      attempt: mapProblemErrorAttempt(attemptInsert.rows[0]),
      mistakes: createdItems,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const listProblemErrorAttempts = async (userId, assignmentId, problemIndex, limit = 50) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const { rows: attemptRows } = await getPool().query(
    `
      SELECT id, user_id, assignment_id, problem_index, source, attempt_number,
             observed_step, stage, correctness, confidence, hint_level, raw_analysis, created_at
      FROM problem_error_attempts
      WHERE user_id = $1 AND assignment_id = $2 AND problem_index = $3
      ORDER BY created_at DESC
      LIMIT $4;
    `,
    [userId, assignmentId, problemIndex, safeLimit],
  );

  if (attemptRows.length === 0) return [];

  const attemptIds = attemptRows.map((row) => row.id);
  const { rows: itemRows } = await getPool().query(
    `
      SELECT
        i.id,
        i.attempt_id,
        i.user_id,
        i.assignment_id,
        i.problem_index,
        i.ordinal,
        i.error_type,
        i.mistake_summary,
        i.why_wrong,
        i.suggested_fix,
        i.severity,
        i.created_at,
        COALESCE(array_remove(array_agg(DISTINCT t.topic), NULL), '{}') AS topics,
        COALESCE(array_remove(array_agg(DISTINCT c.concept), NULL), '{}') AS concepts
      FROM problem_error_items i
      LEFT JOIN problem_error_item_topics t ON t.error_item_id = i.id
      LEFT JOIN problem_error_item_concepts c ON c.error_item_id = i.id
      WHERE i.attempt_id = ANY($1)
      GROUP BY
        i.id, i.attempt_id, i.user_id, i.assignment_id, i.problem_index,
        i.ordinal, i.error_type, i.mistake_summary, i.why_wrong,
        i.suggested_fix, i.severity, i.created_at
      ORDER BY i.ordinal ASC;
    `,
    [attemptIds],
  );

  const itemsByAttemptId = itemRows.reduce((accumulator, row) => {
    const key = row.attempt_id;
    if (!accumulator.has(key)) {
      accumulator.set(key, []);
    }
    accumulator.get(key).push(mapProblemErrorItem(row));
    return accumulator;
  }, new Map());

  return attemptRows.map((row) => ({
    ...mapProblemErrorAttempt(row),
    mistakes: itemsByAttemptId.get(row.id) || [],
  }));
};

export const listProblemErrorSummary = async ({
  userId,
  assignmentId = "",
  groupBy = "topic",
  limit = 20,
}) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const normalizedGroupBy = String(groupBy || "topic");
  const normalizedAssignmentId = String(assignmentId || "").trim();

  if (normalizedGroupBy === "topic") {
    const { rows } = await getPool().query(
      `
        SELECT t.topic AS key, COUNT(*)::INT AS count
        FROM problem_error_item_topics t
        INNER JOIN problem_error_items i ON i.id = t.error_item_id
        WHERE i.user_id = $1
          AND ($2 = '' OR i.assignment_id = $2)
        GROUP BY t.topic
        ORDER BY count DESC, key ASC
        LIMIT $3;
      `,
      [userId, normalizedAssignmentId, safeLimit],
    );
    return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
  }

  if (normalizedGroupBy === "concept") {
    const { rows } = await getPool().query(
      `
        SELECT c.concept AS key, COUNT(*)::INT AS count
        FROM problem_error_item_concepts c
        INNER JOIN problem_error_items i ON i.id = c.error_item_id
        WHERE i.user_id = $1
          AND ($2 = '' OR i.assignment_id = $2)
        GROUP BY c.concept
        ORDER BY count DESC, key ASC
        LIMIT $3;
      `,
      [userId, normalizedAssignmentId, safeLimit],
    );
    return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
  }

  const { rows } = await getPool().query(
    `
      SELECT COALESCE(NULLIF(TRIM(i.error_type), ''), 'unknown') AS key, COUNT(*)::INT AS count
      FROM problem_error_items i
      WHERE i.user_id = $1
        AND ($2 = '' OR i.assignment_id = $2)
      GROUP BY key
      ORDER BY count DESC, key ASC
      LIMIT $3;
    `,
    [userId, normalizedAssignmentId, safeLimit],
  );
  return rows.map((row) => ({ key: row.key, count: Number(row.count) }));
};

// ── Notebook subjects ──────────────────────────────────

const mapNotebookSubject = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export const listNotebookSubjects = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT id, user_id, name, created_at, updated_at
     FROM notebook_subjects
     WHERE user_id = $1
     ORDER BY updated_at DESC;`,
    [userId],
  );
  return rows.map(mapNotebookSubject);
};

export const getNotebookSubject = async (userId, subjectId) => {
  const { rows } = await getPool().query(
    `SELECT id, user_id, name, created_at, updated_at
     FROM notebook_subjects
     WHERE user_id = $1 AND id = $2
     LIMIT 1;`,
    [userId, subjectId],
  );
  if (rows.length === 0) return null;
  return mapNotebookSubject(rows[0]);
};

export const insertNotebookSubject = async (userId, name) => {
  const now = Date.now();
  const id = `subject-${now}-${Math.random().toString(36).slice(2, 8)}`;
  await getPool().query(
    `INSERT INTO notebook_subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4);`,
    [id, userId, name, now],
  );
  return { id, userId, name, createdAt: now, updatedAt: now };
};

export const removeNotebookSubject = async (userId, subjectId) => {
  await getPool().query(
    `DELETE FROM notebook_subjects WHERE user_id = $1 AND id = $2;`,
    [userId, subjectId],
  );
};

// ── Notebook notes ─────────────────────────────────────

const mapNotebookNote = (row) => ({
  id: row.id,
  userId: row.user_id,
  subjectId: row.subject_id,
  title: row.title,
  content: row.content,
  tags: Array.isArray(row.tags) ? row.tags : [],
  sourceType: row.source_type || "text",
  blobName: row.blob_name || null,
  fileName: row.file_name || null,
  contentType: row.content_type || null,
  fileSize: row.file_size != null ? Number(row.file_size) : null,
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

export const listNotebookNotes = async (userId, subjectId) => {
  const { rows } = await getPool().query(
    `SELECT id, user_id, subject_id, title, content, tags, source_type,
            blob_name, file_name, content_type, file_size, created_at, updated_at
     FROM notebook_notes
     WHERE user_id = $1 AND subject_id = $2
     ORDER BY updated_at DESC;`,
    [userId, subjectId],
  );
  return rows.map(mapNotebookNote);
};

export const getNotebookNote = async (userId, noteId) => {
  const { rows } = await getPool().query(
    `SELECT id, user_id, subject_id, title, content, tags, source_type,
            blob_name, file_name, content_type, file_size, created_at, updated_at
     FROM notebook_notes
     WHERE user_id = $1 AND id = $2
     LIMIT 1;`,
    [userId, noteId],
  );
  if (rows.length === 0) return null;
  return mapNotebookNote(rows[0]);
};

export const insertNotebookNote = async (userId, subjectId, {
  title,
  content = "",
  tags = [],
  sourceType = "text",
  blobName = null,
  fileName = null,
  contentType = null,
  fileSize = null,
}) => {
  const now = Date.now();
  const id = `note-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean).slice(0, 10) : [];
  const { rows } = await getPool().query(
    `INSERT INTO notebook_notes (
       id, user_id, subject_id, title, content, tags, source_type,
       blob_name, file_name, content_type, file_size, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING *;`,
    [id, userId, subjectId, title, content, safeTags, sourceType,
     blobName, fileName, contentType, fileSize, now],
  );
  return mapNotebookNote(rows[0]);
};

export const updateNotebookNote = async (userId, noteId, { title, content, tags }) => {
  const now = Date.now();
  const safeTags = Array.isArray(tags) ? tags.filter(Boolean).slice(0, 10) : undefined;
  const { rows } = await getPool().query(
    `UPDATE notebook_notes
     SET title = COALESCE($3, title),
         content = COALESCE($4, content),
         tags = COALESCE($5, tags),
         updated_at = $6
     WHERE user_id = $1 AND id = $2
     RETURNING *;`,
    [userId, noteId, title || null, content != null ? content : null, safeTags || null, now],
  );
  if (rows.length === 0) return null;
  return mapNotebookNote(rows[0]);
};

export const removeNotebookNote = async (userId, noteId) => {
  const { rows } = await getPool().query(
    `DELETE FROM notebook_notes
     WHERE user_id = $1 AND id = $2
     RETURNING *;`,
    [userId, noteId],
  );
  if (rows.length === 0) return null;
  return mapNotebookNote(rows[0]);
};

export const listAllNotebookNotesForUser = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT n.id, n.user_id, n.subject_id, n.title, n.content, n.tags, n.source_type,
            n.blob_name, n.file_name, n.content_type, n.file_size, n.created_at, n.updated_at
     FROM notebook_notes n
     WHERE n.user_id = $1
     ORDER BY n.updated_at DESC;`,
    [userId],
  );
  return rows.map(mapNotebookNote);
};

export const searchNotebookNotes = async (userId, query, subjectId = null) => {
  const pattern = `%${query}%`;
  const sql = subjectId
    ? `SELECT id, user_id, subject_id, title, content, tags, source_type,
              blob_name, file_name, content_type, file_size, created_at, updated_at
       FROM notebook_notes
       WHERE user_id = $1 AND subject_id = $3
         AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT 50;`
    : `SELECT id, user_id, subject_id, title, content, tags, source_type,
              blob_name, file_name, content_type, file_size, created_at, updated_at
       FROM notebook_notes
       WHERE user_id = $1
         AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT 50;`;
  const params = subjectId ? [userId, pattern, subjectId] : [userId, pattern];
  const { rows } = await getPool().query(sql, params);
  return rows.map(mapNotebookNote);
};

export const listNotebookNoteBlobNames = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT blob_name FROM notebook_notes
     WHERE user_id = $1 AND blob_name IS NOT NULL;`,
    [userId],
  );
  return rows.map((r) => r.blob_name).filter(Boolean);
};

const mapSocraticChatThread = (row) => ({
  id: row.id,
  userId: row.user_id,
  title: String(row.title || "New chat"),
  preview: String(row.preview || ""),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

const mapSocraticChatMessage = (row) => ({
  id: row.id,
  userId: row.user_id,
  threadId: row.thread_id,
  role: row.role === "assistant" ? "assistant" : "user",
  text: String(row.content || ""),
  createdAt: Number(row.created_at),
});

export const createSocraticChatThread = async (userId, title = "New chat") => {
  const now = Date.now();
  const id = `socratic-thread-${now}-${Math.random().toString(36).slice(2, 10)}`;
  const safeTitle = String(title || "").trim().slice(0, 120) || "New chat";
  const { rows } = await getPool().query(
    `
      INSERT INTO socratic_chat_threads (id, user_id, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4)
      RETURNING id, user_id, title, '' AS preview, created_at, updated_at;
    `,
    [id, userId, safeTitle, now],
  );
  return mapSocraticChatThread(rows[0]);
};

export const listSocraticChatThreads = async (userId, limit = 50) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await getPool().query(
    `
      SELECT
        t.id,
        t.user_id,
        t.title,
        t.created_at,
        t.updated_at,
        COALESCE((
          SELECT m.content
          FROM socratic_chat_messages m
          WHERE m.thread_id = t.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ), '') AS preview
      FROM socratic_chat_threads t
      WHERE t.user_id = $1
      ORDER BY t.updated_at DESC
      LIMIT $2;
    `,
    [userId, safeLimit],
  );
  return rows.map(mapSocraticChatThread);
};

export const removeSocraticChatThread = async (userId, threadId) => {
  const safeThreadId = String(threadId || "").trim();
  if (!safeThreadId) return null;
  const { rows } = await getPool().query(
    `
      DELETE FROM socratic_chat_threads
      WHERE user_id = $1 AND id = $2
      RETURNING id, user_id, title, '' AS preview, created_at, updated_at;
    `,
    [userId, safeThreadId],
  );
  if (rows.length === 0) return null;
  return mapSocraticChatThread(rows[0]);
};

export const insertSocraticChatMessage = async (userId, { threadId, role, text, createdAt = Date.now() }) => {
  const safeRole = role === "assistant" ? "assistant" : "user";
  const safeText = String(text || "").trim();
  const safeCreatedAt = Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now();
  const id = `socratic-msg-${safeCreatedAt}-${Math.random().toString(36).slice(2, 10)}`;
  const safeThreadId = String(threadId || "").trim();
  const { rows } = await getPool().query(
    `
      INSERT INTO socratic_chat_messages (id, user_id, thread_id, role, content, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, thread_id, role, content, created_at;
    `,
    [id, userId, safeThreadId, safeRole, safeText, safeCreatedAt],
  );
  await getPool().query(
    `
      UPDATE socratic_chat_threads
      SET
        updated_at = GREATEST(updated_at, $3),
        title = CASE
          WHEN title = 'New chat' AND $4 <> '' AND $5 = 'user' THEN LEFT($4, 120)
          ELSE title
        END
      WHERE id = $1 AND user_id = $2;
    `,
    [safeThreadId, userId, safeCreatedAt, safeText, safeRole],
  );
  return mapSocraticChatMessage(rows[0]);
};

export const listSocraticChatMessages = async (userId, threadId, limit = 200) => {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const safeThreadId = String(threadId || "").trim();
  const { rows } = await getPool().query(
    `
      SELECT id, user_id, thread_id, role, content, created_at
      FROM (
        SELECT id, user_id, thread_id, role, content, created_at
        FROM socratic_chat_messages
        WHERE user_id = $1 AND thread_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      ) recent
      ORDER BY created_at ASC;
    `,
    [userId, safeThreadId, safeLimit],
  );
  return rows.map(mapSocraticChatMessage);
};
