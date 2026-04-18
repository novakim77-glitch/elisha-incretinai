// Firebase Admin initialization — singleton.
// Used by all bot commands to read/write Firestore.

const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
  if (initialized) return;
  // GOOGLE_APPLICATION_CREDENTIALS env var points at the service account JSON.
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'incretina-i-pro',
  });
  initialized = true;
}

function db() {
  if (!initialized) initFirebase();
  return admin.firestore();
}

function FieldValue() {
  return admin.firestore.FieldValue;
}

function Timestamp() {
  return admin.firestore.Timestamp;
}

module.exports = { initFirebase, db, FieldValue, Timestamp, admin };
