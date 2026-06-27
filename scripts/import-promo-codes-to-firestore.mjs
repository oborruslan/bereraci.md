import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [, , inputPath = "firebase-private/promo-codes-1000.json"] = process.argv;
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialPath) {
  console.error("Setează GOOGLE_APPLICATION_CREDENTIALS către cheia service account Firebase.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const absoluteInputPath = path.resolve(projectRoot, inputPath);
const serviceAccount = JSON.parse(await fs.readFile(credentialPath, "utf8"));
const payload = JSON.parse(await fs.readFile(absoluteInputPath, "utf8"));
const codes = Array.isArray(payload.codes) ? payload.codes : [];

if (!codes.length) {
  console.error(`Nu am găsit coduri în ${absoluteInputPath}.`);
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const collectionName = payload.collection || "promoCodes";
const batchSize = 450;
let imported = 0;

for (let index = 0; index < codes.length; index += batchSize) {
  const batch = db.batch();
  const chunk = codes.slice(index, index + batchSize);

  for (const item of chunk) {
    const code = String(item.id || item.code || "").trim().toUpperCase();
    if (!code) {
      continue;
    }

    const ref = db.collection(collectionName).doc(code);
    batch.set(ref, {
      active: item.active !== false,
      batchId: payload.batchId || item.batchId || "bereraci-default",
      issued: item.issued === true,
      source: item.source || "store-balti",
      createdAt: FieldValue.serverTimestamp(),
      importedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    imported += 1;
  }

  await batch.commit();
  console.log(`Importate ${Math.min(imported, codes.length)} / ${codes.length} coduri...`);
}

console.log(`Gata. Coduri importate în colecția ${collectionName}: ${imported}.`);
