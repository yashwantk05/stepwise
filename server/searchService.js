import { SearchClient, SearchIndexClient, AzureKeyCredential } from "@azure/search-documents";

const readEnv = (name) => String(globalThis.process?.env?.[name] || "").trim();
const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const getSearchConfig = () => {
  const endpoint = trimTrailingSlash(readEnv("AZURE_SEARCH_ENDPOINT"));
  const apiKey = readEnv("AZURE_SEARCH_API_KEY");
  const indexName = readEnv("AZURE_SEARCH_INDEX_NAME") || "stepwise-notes";

  if (!endpoint || !apiKey) return null;
  return { endpoint, apiKey, indexName };
};

const getAzureConfig = () => {
  const endpoint = trimTrailingSlash(readEnv("AZURE_OPENAI_ENDPOINT"));
  const apiKey = readEnv("AZURE_OPENAI_API_KEY");
  const apiVersion = readEnv("AZURE_OPENAI_API_VERSION") || "2024-02-01";
  const deployment =
    readEnv("AZURE_OPENAI_MODEL") ||
    readEnv("AZURE_OPENAI_DEPLOYMENT") ||
    readEnv("AZURE_OPENAI_DEPLOYMENT_NAME");

  if (!endpoint || !apiKey || !deployment) return null;
  return { endpoint, apiKey, apiVersion, deployment };
};

export const initSearchIndex = async () => {
  const config = getSearchConfig();
  if (!config) {
    console.log("Azure AI Search not configured, skipping index initialization.");
    return false;
  }

  const { endpoint, apiKey, indexName } = config;
  const credential = new AzureKeyCredential(apiKey);
  const indexClient = new SearchIndexClient(endpoint, credential);

  try {
    const existingIndex = await indexClient.getIndex(indexName);
    console.log(`Search index '${indexName}' already exists.`);
    
    // Check if new multimodal fields exist, add them if missing
    const existingFieldNames = new Set(existingIndex.fields.map(f => f.name));
    const newFields = [];
    if (!existingFieldNames.has("blobName")) {
      newFields.push({ name: "blobName", type: "Edm.String", filterable: true });
    }
    if (!existingFieldNames.has("sourceContentType")) {
      newFields.push({ name: "sourceContentType", type: "Edm.String", filterable: true });
    }
    
    if (newFields.length > 0) {
      console.log(`Adding ${newFields.length} new field(s) to index: ${newFields.map(f => f.name).join(", ")}`);
      existingIndex.fields.push(...newFields);
      try {
        await indexClient.createOrUpdateIndex(existingIndex);
        console.log("Index schema updated successfully.");
      } catch (updateErr) {
        console.error("Failed to update index schema:", updateErr.message);
      }
    }
    
    return true;
  } catch (err) {
    if (err.statusCode !== 404) {
      console.error("Error accessing search index:", err);
      return false;
    }
  }

  // Create index schema since it doesn't exist
  console.log(`Creating search index '${indexName}'...`);
  const indexSchema = {
    name: indexName,
    fields: [
      { name: "id", type: "Edm.String", key: true, filterable: true, sortable: true },
      { name: "userId", type: "Edm.String", filterable: true, sortable: true },
      { name: "noteId", type: "Edm.String", filterable: true, sortable: true },
      { name: "subjectId", type: "Edm.String", filterable: true, sortable: true },
      { name: "subjectName", type: "Edm.String", searchable: true, filterable: true },
      { name: "title", type: "Edm.String", searchable: true },
      { name: "chunkText", type: "Edm.String", searchable: true },
      { name: "chunkIndex", type: "Edm.Int32" },
      { name: "sourceType", type: "Edm.String", filterable: true },
      { name: "tags", type: "Collection(Edm.String)", searchable: true, filterable: true },
      { name: "updatedAt", type: "Edm.Int64", filterable: true, sortable: true },
      { name: "blobName", type: "Edm.String", filterable: true },
      { name: "sourceContentType", type: "Edm.String", filterable: true },
      {
        name: "contentVector",
        type: "Collection(Edm.Single)",
        searchable: true,
        vectorSearchDimensions: 1536,
        vectorSearchProfileName: "my-vector-profile",
      },
    ],
    vectorSearch: {
      algorithms: [{ name: "my-hnsw", kind: "hnsw" }],
      profiles: [{ name: "my-vector-profile", algorithmConfigurationName: "my-hnsw" }],
    },
  };

  try {
    await indexClient.createIndex(indexSchema);
    console.log(`Successfully created search index '${indexName}'.`);
    return true;
  } catch (err) {
    console.error("Failed to create search index:", err);
    return false;
  }
};

const generateEmbedding = async (text) => {
  const config = getAzureConfig();
  if (!config) return null;

  const { endpoint, apiKey, apiVersion } = config;
  const embeddingModel = readEnv("AZURE_OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small";

  try {
    const response = await fetch(
      `${endpoint}/openai/deployments/${encodeURIComponent(embeddingModel)}/embeddings?api-version=${encodeURIComponent(apiVersion)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": apiKey },
        body: JSON.stringify({ input: text }),
      }
    );
    if (!response.ok) {
      console.warn("Embedding generation returned status", response.status);
      return null;
    }
    const data = await response.json();
    return data?.data?.[0]?.embedding || null;
  } catch (err) {
    console.warn("Embedding generation failed:", err.message);
    return null;
  }
};

// Simple chunking roughly by splitting into length and words, overlapping
const chunkText = (text, maxLength = 2000, overlap = 200) => {
  if (!text) return [];
  const words = text.split(/\s+/);
  const chunks = [];
  let currentWords = [];
  let currentLength = 0;

  for (const word of words) {
    currentWords.push(word);
    currentLength += word.length + 1; // 1 for space

    if (currentLength >= maxLength) {
      chunks.push(currentWords.join(" "));
      
      // Calculate overlap back
      let overlapWords = [];
      let overlapLength = 0;
      for (let i = currentWords.length - 1; i >= 0; i--) {
        overlapLength += currentWords[i].length + 1;
        overlapWords.unshift(currentWords[i]);
        if (overlapLength >= overlap) break;
      }
      currentWords = overlapWords;
      currentLength = overlapLength;
    }
  }

  if (currentWords.length > 0) {
    const remaining = currentWords.join(" ").trim();
    if (remaining) {
      chunks.push(remaining);
    }
  }

  return chunks;
};

export const indexNoteChunks = async ({ userId, noteId, subjectId, subjectName, title, content, sourceType, tags, updatedAt, blobName, contentType }) => {
  const config = getSearchConfig();
  if (!config || !content) return;

  const { endpoint, apiKey, indexName } = config;
  const credential = new AzureKeyCredential(apiKey);
  const searchClient = new SearchClient(endpoint, indexName, credential);

  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  const batch = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const embedding = await generateEmbedding(`${title}\n${chunkContent}`);
    
    // We only index if embedding succeeds or fallback to keyword only
    batch.push({
      id: `${noteId}-chunk-${i}`,
      userId,
      noteId,
      subjectId,
      subjectName: subjectName || "Untitled Subject",
      title: title || "Untitled Note",
      chunkText: chunkContent,
      chunkIndex: i,
      sourceType: sourceType || "text",
      tags: tags || [],
      contentVector: embedding || [],
      updatedAt: Number(updatedAt) || Date.now(),
      blobName: blobName || "",
      sourceContentType: contentType || "",
    });
  }

  try {
    await searchClient.uploadDocuments(batch);
    console.log(`Indexed ${batch.length} chunk(s) for note ${noteId} (blobName: ${blobName || 'none'})`);
  } catch (err) {
    console.error(`Failed to index note chunks for ${noteId}:`, err);
  }
};

export const deleteNoteFromIndex = async (noteId) => {
  const config = getSearchConfig();
  if (!config) return;

  const { endpoint, apiKey, indexName } = config;
  const credential = new AzureKeyCredential(apiKey);
  const searchClient = new SearchClient(endpoint, indexName, credential);

  try {
    // First, find all chunks for this note
    const result = await searchClient.search("*", {
      filter: `noteId eq '${noteId}'`,
      select: ["id"]
    });

    const docsToDelete = [];
    for await (const res of result.results) {
      docsToDelete.push({ id: res.document.id });
    }

    if (docsToDelete.length > 0) {
      await searchClient.deleteDocuments(docsToDelete);
    }
  } catch (err) {
    console.error(`Failed to delete note index chunks for ${noteId}:`, err);
  }
};

export const deleteNotebookFromIndex = async (subjectId) => {
  const config = getSearchConfig();
  if (!config) return;

  const { endpoint, apiKey, indexName } = config;
  const credential = new AzureKeyCredential(apiKey);
  const searchClient = new SearchClient(endpoint, indexName, credential);

  try {
    const result = await searchClient.search("*", {
      filter: `subjectId eq '${subjectId}'`,
      select: ["id"]
    });

    const docsToDelete = [];
    for await (const res of result.results) {
      docsToDelete.push({ id: res.document.id });
    }

    if (docsToDelete.length > 0) {
      await searchClient.deleteDocuments(docsToDelete);
    }
  } catch (err) {
    console.error(`Failed to delete subject index chunks for ${subjectId}:`, err);
  }
};

export const searchNotes = async (userId, query, subjectId = null, topK = 5) => {
  const config = getSearchConfig();
  if (!config || !query) return [];

  const { endpoint, apiKey, indexName } = config;
  const credential = new AzureKeyCredential(apiKey);
  const searchClient = new SearchClient(endpoint, indexName, credential);

  const queryEmbedding = await generateEmbedding(query);
  const filter = subjectId 
    ? `userId eq '${userId}' and subjectId eq '${subjectId}'` 
    : `userId eq '${userId}'`;

  try {
    const searchOptions = {
      top: topK,
      filter,
      select: ["noteId", "subjectId", "title", "chunkText", "tags", "sourceType", "blobName", "sourceContentType"]
    };

    if (queryEmbedding && queryEmbedding.length === 1536) {
      searchOptions.vectorSearchOptions = {
        queries: [
          {
            kind: "vector",
            vector: queryEmbedding,
            kNearestNeighborsCount: topK,
            fields: ["contentVector"]
          }
        ]
      };
    }

    const searchResults = await searchClient.search(query, searchOptions);
    const results = [];
    
    for await (const result of searchResults.results) {
      results.push({
        ...result.document,
        searchScore:
          Number(result?.score)
          || Number(result?.["@search.score"])
          || 0,
      });
    }
    
    return results;
  } catch (err) {
    console.error("Failed to search notes:", err);
    return [];
  }
};
