import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig, raffleCollections } from "./firebase-config.js";

const CODE_PREFIX = "BR";
const CODE_BODY_LENGTH = 8;
const STORAGE_KEY = "bereraciPromoCode";

const form = document.getElementById("promoCodeForm");
const input = document.getElementById("promoCodeInput");
const submitButton = document.getElementById("promoCodeSubmit");
const submitButtonLabel = document.getElementById("promoCodeSubmitLabel");
const statusNode = document.getElementById("promoCodeStatus");

let firebaseApp;
let firebaseAuth;
let firestoreDb;
let embeddedAllowlist;

function isFirebaseConfigured(config) {
  return Boolean(
    config &&
    config.apiKey &&
    config.projectId &&
    !String(config.apiKey).startsWith("PASTE_") &&
    !String(config.projectId).startsWith("PASTE_")
  );
}

function setStatus(message, type = "") {
  if (!statusNode) {
    return;
  }

  statusNode.textContent = message;
  statusNode.classList.toggle("is-success", type === "success");
  statusNode.classList.toggle("is-error", type === "error");
}

function setLoading(isLoading) {
  if (submitButton) {
    submitButton.disabled = isLoading;
  }

  if (submitButtonLabel) {
    submitButtonLabel.textContent = isLoading ? "Se verifică..." : "Participă";
  }
}

function readEmbeddedAllowlist() {
  if (embeddedAllowlist !== undefined) {
    return embeddedAllowlist;
  }

  const allowlistNode = document.getElementById("promoCodeAllowlist");
  if (!allowlistNode) {
    embeddedAllowlist = null;
    return embeddedAllowlist;
  }

  try {
    const parsed = JSON.parse(allowlistNode.textContent || "{}");
    const hashes = Array.isArray(parsed.hashes) ? parsed.hashes : [];
    embeddedAllowlist = {
      batchId: parsed.batchId || "",
      count: Number(parsed.count || hashes.length),
      salt: parsed.salt || "",
      hashes: new Set(hashes)
    };
  } catch {
    embeddedAllowlist = null;
  }

  return embeddedAllowlist;
}

async function sha256Hex(value) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("crypto-unavailable");
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isCodeInEmbeddedAllowlist(code) {
  const allowlist = readEmbeddedAllowlist();
  if (!allowlist || !allowlist.salt || !allowlist.hashes.size) {
    return true;
  }

  const hash = await sha256Hex(`${allowlist.salt}:${code}`);
  return allowlist.hashes.has(hash);
}

function normalizePromoCode(value) {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const withoutPrefix = compact.startsWith(CODE_PREFIX)
    ? compact.slice(CODE_PREFIX.length)
    : compact;

  if (withoutPrefix.length !== CODE_BODY_LENGTH) {
    return "";
  }

  return `${CODE_PREFIX}-${withoutPrefix.slice(0, 4)}-${withoutPrefix.slice(4)}`;
}

function rememberCode(code) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Local storage is optional; Firebase remains the source of truth.
  }
}

function readRememberedCode() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

async function ensureFirebase() {
  if (!isFirebaseConfigured(firebaseConfig)) {
    throw new Error("firebase-not-configured");
  }

  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
  }

  if (!firebaseAuth.currentUser) {
    await signInAnonymously(firebaseAuth);
  }
}

async function registerPromoCode(code) {
  const isAllowedLocally = await isCodeInEmbeddedAllowlist(code);
  if (!isAllowedLocally) {
    throw new Error("invalid-promo-code");
  }

  if (!isFirebaseConfigured(firebaseConfig)) {
    rememberCode(code);
    return { mode: "local" };
  }

  await ensureFirebase();

  const promoRef = doc(firestoreDb, raffleCollections.promoCodes, code);
  const promoSnapshot = await getDoc(promoRef);

  if (!promoSnapshot.exists() || promoSnapshot.data().active !== true) {
    throw new Error("invalid-promo-code");
  }

  const participantRef = doc(firestoreDb, raffleCollections.participants, code);
  const participantSnapshot = await getDoc(participantRef);
  const participantData = {
    promoCode: code,
    eligibleForAllDraws: true,
    status: "active",
    source: "bereraci.md",
    lastAuthUid: firebaseAuth.currentUser.uid,
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (!participantSnapshot.exists()) {
    participantData.createdAt = serverTimestamp();
  }

  await setDoc(participantRef, participantData, { merge: true });
  rememberCode(code);
  return { mode: "firebase" };
}

function friendlyError(error) {
  if (error && error.message === "firebase-not-configured") {
    return "Firebase nu este configurat încă. Adaugă datele proiectului în assets/js/firebase-config.js.";
  }

  if (error && error.message === "crypto-unavailable") {
    return "Browserul nu poate verifica promo codul în siguranță. Încearcă dintr-un browser actualizat.";
  }

  if (error && error.message === "invalid-promo-code") {
    return "Promo codul introdus nu este valid. Verifică literele și cifrele de pe cod.";
  }

  if (error && String(error.code || "").includes("permission-denied")) {
    return "Codul pare valid, dar regulile Firestore nu permit înscrierea. Verifică regulile din firebase/firestore.rules.";
  }

  return "Nu am putut verifica promo codul acum. Încearcă din nou peste câteva momente.";
}

function initializeForm() {
  if (!form || !input) {
    return;
  }

  const allowlist = readEmbeddedAllowlist();
  const rememberedCode = readRememberedCode();
  if (rememberedCode) {
    input.value = rememberedCode;
    setStatus(`Cod salvat: ${rememberedCode}. Acest cod rămâne participant la tombolele viitoare.`, "success");
  } else if (allowlist && allowlist.count) {
    setStatus(`${allowlist.count} promo coduri sunt pregătite pentru tombolă. Introdu codul primit în magazin.`);
  } else if (!isFirebaseConfigured(firebaseConfig)) {
    setStatus("Firebase este pregătit în site, dar trebuie completată configurația proiectului.", "error");
  }

  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = normalizePromoCode(input.value);
    if (!code) {
      setStatus("Introdu un promo code în format BR-XXXX-XXXX.", "error");
      input.focus();
      return;
    }

    input.value = code;
    setLoading(true);
    setStatus("Verificăm promo codul...");

    try {
      const result = await registerPromoCode(code);
      const suffix = result.mode === "firebase"
        ? "Ești înscris la tombolele viitoare Bere & Raci."
        : "Codul este valid în lista locală. Pentru înscriere online permanentă, configurează Firebase și importă codurile.";
      setStatus(`Cod valid: ${code}. ${suffix}`, "success");
    } catch (error) {
      setStatus(friendlyError(error), "error");
    } finally {
      setLoading(false);
    }
  });
}

initializeForm();
