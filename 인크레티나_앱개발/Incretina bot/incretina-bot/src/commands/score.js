// /score — today's normalized IMEM score + α/β/γ breakdown

const {
  calculateIMEM, totalEfficiency, calculateScore, calculateSunTimes,
} = require('imem-core');
const { getDailyRoutine, toLogicalDate, saveScore } = require('../store');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./_shared');

async function scoreCommand(ctx) {
  const { uid, profile, week } = await resolveUser(ctx);
  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const daily = await getDailyRoutine(uid, date);

  const checks       = checksObjToArray(daily.checks);
  const riskActive   = riskObjToArray(daily.riskActive);
  const recoveryDone = riskObjToArray(daily.recoveryDone);

  const lat = profile.lat || 37.5665; // Seoul fallback
  const sun = calculateSunTimes(lat);

  const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset });
  const score = calculateScore({ checks, riskActive, recoveryDone, week });
  const eff = totalEfficiency(imem);

  // 점수 저장 (CCS 집계용) — 조회할 때마다 최신 값으로 갱신
  try {
    await saveScore(uid, date, {
      score,
      alpha: Number(imem.alpha_net.toFixed(2)),
      beta:  Number(imem.beta_net.toFixed(2)),
      gamma: Number(imem.gamma_net.toFixed(2)),
      betaMeal: Number((imem.beta_meal || 1).toFixed(3)),
      efficiency: Number(eff.toFixed(3)),
    });
  } catch (e) {
    console.warn('[score] saveScore failed (non-fatal):', e.message);
  }

  const lines = [
    `📊 *IMEM 점수* (${date}, ${week}주차)`,
    ``,
    `총점: *${score}* / 100`,
    `대사 효율(α·β·γ): *${eff.toFixed(2)}*`,
    ``,
    `α (타이밍):     ${imem.alpha_net.toFixed(2)}`,
    `β (시퀀스):     ${imem.beta_net.toFixed(2)}`,
    `γ (민감도):     ${imem.gamma_net.toFixed(2)}`,
    ``,
    `루틴 확인: /check    예측 보기: /predict`,
  ];
  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = { scoreCommand };
