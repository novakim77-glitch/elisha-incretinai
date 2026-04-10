// IMEM Core — Score & Unlocking
// Pure functions extracted from IncretinAi_v7.0.html (lines 1374-1408, 2723-2750)

const { routine, risks, UNLOCK_SCHEDULE } = require('./constants');

/**
 * Determine current user week from start date OR cloud history.
 * @param {Object} opts
 * @param {string|Date|null} [opts.userStartDate]
 * @param {number} [opts.historyDays=0]  - days of cloud history (>=7 → full unlock)
 * @param {Date} [opts.now]
 */
function getUserWeek({ userStartDate = null, historyDays = 0, now = new Date() } = {}) {
  if (historyDays >= 7) return 4;
  if (!userStartDate) return 1;
  const n = new Date(now); n.setHours(0, 0, 0, 0);
  const s = new Date(userStartDate); s.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((n - s) / 86400000);
  return Math.min(4, Math.floor(diffDays / 7) + 1);
}

function getUnlockedRoutineIndices(week) {
  const indices = [];
  for (let w = 1; w <= week; w++) {
    if (UNLOCK_SCHEDULE[w]) indices.push(...UNLOCK_SCHEDULE[w]);
  }
  return indices;
}

function getUnlockedMaxScore(week) {
  const unlocked = getUnlockedRoutineIndices(week);
  return unlocked.reduce((s, i) => s + routine[i].pts, 0) || 100;
}

/**
 * Compute the normalized 0~100 score (with -20 floor) the same way v7.0 does.
 * @param {Object} input
 * @param {boolean[]} input.checks       - length 10
 * @param {boolean[]} input.riskActive   - length 8
 * @param {boolean[]} input.recoveryDone - length 8
 * @param {number} input.week            - 1~4
 */
function calculateScore({ checks, riskActive, recoveryDone, week }) {
  const unlocked = getUnlockedRoutineIndices(week);

  const positive = routine.reduce((s, item, i) => {
    if (!unlocked.includes(i)) return s;
    return s + (checks[i] ? item.pts : 0);
  }, 0);

  const totalPenalty = risks.reduce(
    (s, r, i) => s + (riskActive[i] ? r.penalty : 0), 0);
  const totalRecovery = risks.reduce(
    (s, r, i) => s + (riskActive[i] && recoveryDone[i] ? r.recPts : 0), 0);

  const raw = positive + totalPenalty + totalRecovery;
  const maxScore = getUnlockedMaxScore(week);
  const normalized = Math.round((raw / maxScore) * 100);
  return Math.max(-20, Math.min(100, normalized));
}

module.exports = {
  getUserWeek,
  getUnlockedRoutineIndices,
  getUnlockedMaxScore,
  calculateScore,
};
