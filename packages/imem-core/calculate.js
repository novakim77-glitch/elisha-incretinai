// IMEM Core v2.0 — α/β/γ Calculator with Penalty + Recovery
// Pure function extracted from IncretinAi_v7.0.html (line 2659).
// Logic preserved 1:1 — only DOM/global reads are replaced with arguments.
//
// Routine indices (10):
//   0 기상리셋  1 커피부스트  2 수분  3 프리로드  4 시퀀스(채소→고기→밥)
//   5 식후산책  6 저녁마감  7 활동     8 야간공복  9 수면준비
//
// Risk indices (8):
//   0 R-01 늦잠     1 R-02 가당음료  2 R-03 프리로드스킵  3 R-04 순서위반
//   4 R-05 좌식     5 R-06 19시이후  6 R-07 야식         7 R-08 블루라이트

const { timeToMinutes } = require('./biosync');

/**
 * @param {Object} input
 * @param {boolean[]} input.checks       - length 10
 * @param {boolean[]} input.riskActive   - length 8
 * @param {boolean[]} input.recoveryDone - length 8
 * @param {Object}   input.profile
 * @param {'no'|'pre'|'yes'} input.profile.isDiabetic
 * @param {number}   input.profile.exCount  - weekly exercise count
 * @param {{h:number,m:number}|null} input.sunset - today's sunset (or null)
 * @param {boolean}  [input.isNightMode=false]
 * @returns {{alpha_net:number,beta_net:number,gamma_net:number,alpha_penalty:number,beta_penalty:number,gamma_penalty:number}}
 */

/**
 * Compute beta_meal multiplier from today's meal array.
 * Formula: β_meal = 0.95 + avgBetaScore × 0.075
 * Range: [0.95, 1.025]. No meals → 1.0 (backward compatible).
 */
function computeBetaMeal(meals) {
  if (!meals || meals.length === 0) return 1.0;
  var validMeals = meals.filter(function(m) {
    return typeof m.betaScore === 'number' && m.betaScore >= 0;
  });
  if (validMeals.length === 0) return 1.0;
  var avgBeta = validMeals.reduce(function(s, m) { return s + m.betaScore; }, 0) / validMeals.length;
  return Math.round((0.95 + avgBeta * 0.075) * 1000) / 1000;
}

function calculateIMEM(input) {
  const {
    checks,
    riskActive,
    recoveryDone,
    profile,
    sunset,
    isNightMode = false,
    meals = [],
  } = input;

  // ── α base + bonus ──
  let alpha = 1.0;
  if (checks[6]) {
    const ssM = sunset ? timeToMinutes(sunset.h, sunset.m) : 1080;
    alpha = ssM >= 1140 ? 1.10 : 1.05;
  } else if (isNightMode) {
    alpha = 0.90;
  }
  if (checks[0]) alpha += 0.02;
  if (checks[8] && checks[9]) alpha += 0.02;

  // ── α penalty ──
  let alpha_pen = 0;
  if (riskActive[0]) alpha_pen += 0.05;  // R-01 늦잠
  if (riskActive[5]) alpha_pen += 0.10;  // R-06 19시이후
  if (riskActive[6]) alpha_pen += 0.20;  // R-07 야식
  if (riskActive[7]) alpha_pen += 0.04;  // R-08 블루라이트

  // ── α recovery ──
  let alpha_rec = 0;
  if (riskActive[0] && recoveryDone[0]) alpha_rec += 0.05;
  if (riskActive[5] && recoveryDone[5]) alpha_rec += 0.10 * 0.67;
  if (riskActive[6] && recoveryDone[6]) alpha_rec += 0.20 * 0.40;
  if (riskActive[7] && recoveryDone[7]) alpha_rec += 0.04 * 0.50;

  const alpha_net = Math.max(0.75, Math.min(1.14,
    Math.round((alpha - alpha_pen + alpha_rec) * 100) / 100));

  // ── β base ──
  const beta_pre = checks[3] ? 1.025 : 1.0;
  const beta_seq = (checks[4] && checks[5]) ? 1.025 : (checks[4] ? 1.015 : 1.0);
  const beta_base = Math.round((beta_pre * beta_seq) * 1000) / 1000;

  // β_meal: actual meal quality multiplier from betaScore data
  const beta_meal = computeBetaMeal(meals);

  // ── β penalty ──
  let beta_pen = 0;
  if (riskActive[1]) beta_pen += 0.03;  // R-02 가당음료
  if (riskActive[2]) beta_pen += 0.02;  // R-03 프리로드스킵
  if (riskActive[3]) beta_pen += 0.05;  // R-04 순서위반

  // ── β recovery ──
  let beta_rec = 0;
  if (riskActive[1] && recoveryDone[1]) beta_rec += 0.03 * 0.50;
  if (riskActive[2] && recoveryDone[2]) beta_rec += 0.02 * 0.50;
  if (riskActive[3] && recoveryDone[3]) beta_rec += 0.05 * 0.60;

  const beta_net = Math.max(0.90, Math.min(1.051,
    Math.round((beta_base * beta_meal - beta_pen + beta_rec) * 1000) / 1000));

  // ── γ base ──
  const { isDiabetic, exCount } = profile;
  const gamma_base = isDiabetic === 'yes' ? 0.85 : (isDiabetic === 'pre' ? 0.95 : 1.00);
  const gamma_ex = (exCount >= 3 && checks[7]) ? 0.05
                 : (exCount >= 3 ? 0.03
                 : (checks[7] ? 0.02 : 0));
  const gamma_raw = Math.round((gamma_base * (1 + gamma_ex)) * 100) / 100;

  // ── γ penalty ──
  let gamma_pen = 0;
  if (riskActive[4]) gamma_pen += 0.02;  // R-05 좌식

  // ── γ recovery ──
  let gamma_rec = 0;
  if (riskActive[4] && recoveryDone[4]) gamma_rec += 0.02;

  const gamma_net = Math.max(0.70, Math.min(1.05,
    Math.round((gamma_raw - gamma_pen + gamma_rec) * 100) / 100));

  return {
    alpha_net, beta_net, gamma_net,
    alpha_penalty: alpha_pen,
    beta_penalty: beta_pen,
    gamma_penalty: gamma_pen,
    beta_meal,
  };
}

function totalEfficiency(imem) {
  return imem.alpha_net * imem.beta_net * imem.gamma_net;
}

module.exports = { calculateIMEM, totalEfficiency, computeBetaMeal };
