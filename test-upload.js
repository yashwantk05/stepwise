import fs from 'fs';
import { uploadAssignmentPdfToBlob } from './server/blobStorage.js';

async function test() {
  try {
    const buffer = Buffer.from("dummy pdf content");
    const res = await uploadAssignmentPdfToBlob({
      userId: "test-user",
      assignmentId: "test-assignment",
      fileName: "test.pdf",
      contentType: "application/pdf",
      buffer
    });
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
