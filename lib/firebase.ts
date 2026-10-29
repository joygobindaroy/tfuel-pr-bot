import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let configured = false;

// Lazy so that builds without env vars do not crash.
export function getDb() {
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      }),
    });
  const db = getFirestore(app);
  if (!configured) {
    // An undefined field must never crash a write: Firestore throws on it synchronously, which .catch() can't intercept.
    try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already initialised */ }
    configured = true;
  }
  return db;
}
