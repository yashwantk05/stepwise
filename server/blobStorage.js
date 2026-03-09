import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { Buffer } from "node:buffer";

const CONNECTION_STRING = globalThis.process?.env?.AZURE_STORAGE_CONNECTION_STRING || "";
const ACCOUNT_NAME = globalThis.process?.env?.AZURE_STORAGE_ACCOUNT || "";
const ACCOUNT_KEY = globalThis.process?.env?.AZURE_STORAGE_ACCESS_KEY || "";
const CONTAINER_NAME = globalThis.process?.env?.AZURE_STORAGE_CONTAINER || "assignment-pdfs";

let containerClient = null;
let setupPromise = null;

const sanitize = (value, fallback) => {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

const createBlobName = (userId, assignmentId, originalFileName) => {
  const safeUser = sanitize(userId, "user");
  const safeAssignment = sanitize(assignmentId, "assignment");
  const safeFile = sanitize(originalFileName, "problem-sheet");
  const now = Date.now();
  return `${safeUser}/${safeAssignment}/${now}-${safeFile}.pdf`;
};

const createSceneBlobName = (userId, assignmentId, problemIndex) => {
  const safeUser = sanitize(userId, "user");
  const safeAssignment = sanitize(assignmentId, "assignment");
  const safeProblem = Number(problemIndex) || 1;
  return `${safeUser}/${safeAssignment}/problem-${safeProblem}.excalidraw`;
};

const createProblemImageBlobName = (userId, assignmentId, problemIndex) => {
  const safeUser = sanitize(userId, "user");
  const safeAssignment = sanitize(assignmentId, "assignment");
  const safeProblem = Number(problemIndex) || 1;
  return `${safeUser}/${safeAssignment}/problem-${safeProblem}.png`;
};

const getBlobServiceClient = () => {
  if (CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  }

  if (ACCOUNT_NAME && ACCOUNT_KEY) {
    const sharedKeyCredential = new StorageSharedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY);
    const serviceUrl = `https://${ACCOUNT_NAME}.blob.core.windows.net`;
    return new BlobServiceClient(serviceUrl, sharedKeyCredential);
  }

  throw new Error(
    "Blob storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCESS_KEY.",
  );
};

const requireContainer = async () => {
  if (containerClient) return containerClient;
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    const serviceClient = getBlobServiceClient();
    const client = serviceClient.getContainerClient(CONTAINER_NAME);
    await client.createIfNotExists();
    containerClient = client;
    return client;
  })();

  return setupPromise;
};

export const uploadAssignmentPdfToBlob = async ({ userId, assignmentId, fileName, contentType, buffer }) => {
  const container = await requireContainer();
  const blobName = createBlobName(userId, assignmentId, fileName);
  const blobClient = container.getBlockBlobClient(blobName);
  await blobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType || "application/pdf",
    },
  });
  return blobName;
};

export const deleteBlobIfExists = async (blobName) => {
  if (!blobName) return;
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  await blobClient.deleteIfExists();
};

export const downloadAssignmentPdfFromBlob = async (blobName) => {
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const response = await blobClient.download();
  return {
    stream: response.readableStreamBody,
    contentType: response.contentType || "application/pdf",
    contentLength: Number(response.contentLength || 0),
  };
};

export const createReadSasUrl = async (blobName, expiresInMinutes = 15) => {
  if (!blobName) return null;
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  const expiresOn = new Date(Date.now() + expiresInMinutes * 60_000);
  try {
    const sasUrl = await blobClient.generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      expiresOn,
    });
    return sasUrl;
  } catch {
    return null;
  }
};

export const uploadProblemSceneToBlob = async ({
  userId,
  assignmentId,
  problemIndex,
  scene,
}) => {
  const container = await requireContainer();
  const blobName = createSceneBlobName(userId, assignmentId, problemIndex);
  const blobClient = container.getBlockBlobClient(blobName);
  const serializedScene = JSON.stringify(scene || null);
  const buffer = Buffer.from(serializedScene, "utf-8");
  await blobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: "application/vnd.excalidraw+json",
    },
  });
  return {
    blobName,
    fileName: `problem-${Number(problemIndex) || 1}.excalidraw`,
    contentType: "application/vnd.excalidraw+json",
    size: buffer.length,
  };
};

export const downloadProblemSceneFromBlob = async (blobName) => {
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const response = await blobClient.download();
  const chunks = [];
  if (!response.readableStreamBody) return null;

  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(body);
};

export const uploadProblemImageToBlob = async ({
  userId,
  assignmentId,
  problemIndex,
  buffer,
  contentType = "image/png",
}) => {
  const container = await requireContainer();
  const blobName = createProblemImageBlobName(userId, assignmentId, problemIndex);
  const blobClient = container.getBlockBlobClient(blobName);
  await blobClient.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  });
  return {
    blobName,
    fileName: `problem-${Number(problemIndex) || 1}.png`,
    contentType,
    size: buffer.length,
  };
};

export const downloadProblemImageFromBlob = async (blobName) => {
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const response = await blobClient.download();
  return {
    stream: response.readableStreamBody,
    contentType: response.contentType || "image/png",
    contentLength: Number(response.contentLength || 0),
  };
};

export const downloadProblemImageBufferFromBlob = async (blobName) => {
  const container = await requireContainer();
  const blobClient = container.getBlobClient(blobName);
  const exists = await blobClient.exists();
  if (!exists) return null;

  const response = await blobClient.download();
  const chunks = [];
  if (!response.readableStreamBody) return null;

  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: response.contentType || "image/png",
    contentLength: Number(response.contentLength || 0),
  };
};
