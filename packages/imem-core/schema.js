// Firestore Schema v2 — shared constants
// Spec: 인크레티나_ELISHA/최신/IncretinAi_Firestore_Schema_v2.md
//
// This module is the single source of truth for schema enums.
// Both the IncretinA i web app and the Telegram bot must import these.

const SCHEMA_VERSION = 2;
const IMEM_VERSION = '2.0.0';

// ─────────────────────────────────────────────
// Source channels — every write records its origin
// ─────────────────────────────────────────────
const SOURCE = Object.freeze({
  WEB_APP:           'web_app',
  TELEGRAM_BOT:      'telegram_bot',
  IOS_APP:           'ios_app',           // future
  ANDROID_APP:       'android_app',       // future
  CLINICIAN_PORTAL:  'clinician_portal',  // future (Synca)
  SYSTEM_SCHEDULER:  'system_scheduler',
  ADMIN_CONSOLE:     'admin_console',
  MIGRATION_SCRIPT:  'migration_script',
});

const ALL_SOURCES = Object.values(SOURCE);

// ─────────────────────────────────────────────
// Event types — append-only log
// ─────────────────────────────────────────────
const EVENT = Object.freeze({
  ROUTINE_CHECK:       'routine_check',
  RISK_ACTIVATE:       'risk_activate',
  RECOVERY_DONE:       'recovery_done',
  WEIGHT_LOG:          'weight_log',
  MEAL_LOG:            'meal_log',
  PROFILE_UPDATE:      'profile_update',
  BOT_MESSAGE_IN:      'bot_message_in',
  BOT_MESSAGE_OUT:     'bot_message_out',
  NOTIFICATION_SENT:   'notification_sent',
  NOTIFICATION_ACTED:  'notification_acted',
  SCORE_RECOMPUTE:     'score_recompute',
});

const ALL_EVENT_TYPES = Object.values(EVENT);

// ─────────────────────────────────────────────
// Personas
// ─────────────────────────────────────────────
const PERSONA = Object.freeze({
  CLINICAL:    'clinical',
  DRIVER:      'driver',
  EMPATHETIC:  'empathetic',
});

const ALL_PERSONAS = Object.values(PERSONA);

// ─────────────────────────────────────────────
// Document path builders
// Use these instead of hardcoding paths in app/bot code.
// ─────────────────────────────────────────────
const paths = {
  user:          (uid)        => `users/${uid}`,
  settingsApp:   (uid)        => `users/${uid}/settings/app`,
  telegramLink:  (uid)        => `users/${uid}/integrations/telegram`,
  dailyRoutine:  (uid, date)  => `users/${uid}/dailyRoutines/${date}`,
  events:        (uid)        => `users/${uid}/events`,
  event:         (uid, id)    => `users/${uid}/events/${id}`,
  messages:      (uid)        => `users/${uid}/messages`,
  message:       (uid, id)    => `users/${uid}/messages/${id}`,
  surveys:       (uid)        => `users/${uid}/surveys`,
  linkCode:      (code)       => `linkCodes/${code}`,
  systemImem:    ()           => `systemConfig/imem`,
};

// ─────────────────────────────────────────────
// Factories — produce well-formed documents.
// These are pure functions; the caller decides how to write them.
// ─────────────────────────────────────────────

/**
 * Build a `_meta` block for any document.
 * @param {string} source - one of SOURCE.*
 * @param {Date|null} [now] - injected for testability
 */
function makeMeta(source, now = null) {
  if (!ALL_SOURCES.includes(source)) {
    throw new Error(`Invalid source: ${source}`);
  }
  const ts = now || new Date();
  return {
    createdAt: ts,
    updatedAt: ts,
    schemaVersion: SCHEMA_VERSION,
    source,
  };
}

/**
 * Build an immutable event document.
 * @param {Object} input
 * @param {string} input.type     - one of EVENT.*
 * @param {string} input.date     - logical date "YYYY-MM-DD"
 * @param {string} input.source   - one of SOURCE.*
 * @param {Object} input.payload  - event-specific data
 * @param {Date}   [input.now]
 */
function makeEvent({ type, date, source, payload, now = null }) {
  if (!ALL_EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid event type: ${type}`);
  }
  if (!ALL_SOURCES.includes(source)) {
    throw new Error(`Invalid source: ${source}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error(`Invalid date format: ${date} (expected YYYY-MM-DD)`);
  }
  const ts = now || new Date();
  return {
    type,
    date,
    timestamp: ts,
    source,
    imemVersion: IMEM_VERSION,
    payload: payload || {},
    _meta: {
      createdAt: ts,
      schemaVersion: SCHEMA_VERSION,
    },
  };
}

/**
 * Build a one-time link code (top-level linkCodes/{code}).
 * @param {string} uid
 * @param {Date} [now]
 * @param {number} [ttlMinutes=5]
 */
function makeLinkCode(uid, now = null, ttlMinutes = 5) {
  const ts = now || new Date();
  const expires = new Date(ts.getTime() + ttlMinutes * 60 * 1000);
  // 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return {
    code,
    doc: {
      uid,
      createdAt: ts,
      expiresAt: expires,
      used: false,
      usedAt: null,
      usedByChatId: null,
    },
  };
}

/**
 * Detect schema version of an existing document (for v1/v2 reads).
 * @param {Object} doc
 * @returns {1|2}
 */
function detectSchemaVersion(doc) {
  if (doc && doc._meta && doc._meta.schemaVersion === 2) return 2;
  return 1;
}

module.exports = {
  SCHEMA_VERSION,
  IMEM_VERSION,
  SOURCE,
  ALL_SOURCES,
  EVENT,
  ALL_EVENT_TYPES,
  PERSONA,
  ALL_PERSONAS,
  paths,
  makeMeta,
  makeEvent,
  makeLinkCode,
  detectSchemaVersion,
};
