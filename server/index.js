import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(globalThis.process?.env?.PORT) || 8080;
const distDir = path.resolve(__dirname, "..", "dist");
const indexFile = path.join(distDir, "index.html");

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "stepwise-api" });
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
