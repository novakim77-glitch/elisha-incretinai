// IMEM Core — 4-week weight prediction (lightweight)
// Pure function extracted from IncretinAi_v7.0.html (line 3129).
//
// Model is intentionally simple: weeklyDelta = -0.5 * (α·β·γ) * compliance
// BMR (Mifflin-St Jeor) is computed but not currently used in the delta —
// preserved here for parity with v7.0 in case it gets wired in later.

const { totalEfficiency } = require('./calculate');

/**
 * @param {Object} input
 * @param {Object} input.imem        - result of calculateIMEM
 * @param {number} input.score       - 0~100 normalized score
 * @param {Object} input.profile
 * @param {number} input.profile.cw  - current weight (kg)
 * @param {number} input.profile.h   - height (m)
 * @param {number} input.profile.age
 * @param {'male'|'female'} input.profile.gender
 * @returns {{predicted:number, delta:number, weeklyDelta:number, bmr:number}|null}
 */
function getWeightPrediction({ imem, score, profile }) {
  const { cw, h, age, gender } = profile;
  if (!cw || !h || h <= 0) return null;

  const compliance = Math.max(0.3, score / 100);

  const bmr = gender === 'male'
    ? 10 * cw + 6.25 * (h * 100) - 5 * age + 5
    : 10 * cw + 6.25 * (h * 100) - 5 * age - 161;

  const multiplier = totalEfficiency(imem);
  const weeklyDelta = -0.5 * multiplier * compliance;

  const predicted = Math.round((cw + weeklyDelta * 4) * 10) / 10;
  const delta = Math.round((predicted - cw) * 10) / 10;

  return { predicted, delta, weeklyDelta, bmr };
}

module.exports = { getWeightPrediction };
