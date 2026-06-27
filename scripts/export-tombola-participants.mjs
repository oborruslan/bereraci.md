import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const [, , outputPath = "firebase-private/tombola-participants.csv"] = process.argv;
const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialPath) {
  console.error("Setează GOOGLE_APPLICATION_CREDENTIALS către cheia service account Firebase.");
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), serviceAccount.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`OAuth token error: ${response.status} ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

function fieldValue(fields, name) {
  const field = fields[name];
  if (!field) {
    return "";
  }

  if ("stringValue" in field) {
    return field.stringValue;
  }
  if ("booleanValue" in field) {
    return field.booleanValue ? "true" : "false";
  }
  if ("timestampValue" in field) {
    return field.timestampValue;
  }
  if ("integerValue" in field) {
    return field.integerValue;
  }

  return "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function listParticipants(projectId, token) {
  const participants = [];
  let pageToken = "";

  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tombolaParticipants`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Firestore list error: ${response.status} ${JSON.stringify(data)}`);
    }

    for (const document of data.documents || []) {
      const fields = document.fields || {};
      participants.push({
        promoCode: fieldValue(fields, "promoCode"),
        customerName: fieldValue(fields, "customerName"),
        customerPhone: fieldValue(fields, "customerPhone"),
        status: fieldValue(fields, "status"),
        eligibleForAllDraws: fieldValue(fields, "eligibleForAllDraws"),
        createdAt: fieldValue(fields, "createdAt"),
        updatedAt: fieldValue(fields, "updatedAt"),
        lastLoginAt: fieldValue(fields, "lastLoginAt")
      });
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return participants;
}

const serviceAccount = JSON.parse(await fs.readFile(credentialPath, "utf8"));
const token = await getAccessToken(serviceAccount);
const allParticipants = await listParticipants(serviceAccount.project_id, token);
const participants = allParticipants
  .filter((participant) => participant.status === "active" && participant.eligibleForAllDraws === "true")
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

const header = [
  "promoCode",
  "customerName",
  "customerPhone",
  "status",
  "eligibleForAllDraws",
  "createdAt",
  "updatedAt",
  "lastLoginAt"
];
const lines = [
  header.join(","),
  ...participants.map((participant) => header.map((key) => csvEscape(participant[key])).join(","))
];
const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
await fs.writeFile(absoluteOutputPath, `${lines.join("\n")}\n`, "utf8");

console.log(`PARTICIPANTS=${participants.length}`);
console.log(`TOTAL_DOCUMENTS=${allParticipants.length}`);
console.log(`CSV=${absoluteOutputPath}`);
