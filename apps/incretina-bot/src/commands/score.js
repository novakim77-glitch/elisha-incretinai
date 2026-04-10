// /score — today's normalized IMEM score + α/β/γ breakdown

const {
  calculateIMEM, totalEfficiency, calculateScore, calculateSunTimes,
} = require('imem-core');
const { getDailyRoutine, toLogicalDate } = require('../store');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./_shared');

async function scoreCommand(ctx) {
  const { uid, profile, week } = await resolveUser(ctx);
  const date = toLogicalDate(new Date());
  const daily = await getDailyRoutine(uid, date);

  const checks       = checksObjToArray(daily.checks);
  const riskActive   = riskObjToArray(daily.riskActive);
  const recoveryDone = riskObjToArray(daily.recoveryDone);

  const lat = profile.lat || 37.5665; // Seoul fallback
  const sun = calculateSunTimes(lat);

  const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset });
  const score = calculateScore({ checks, riskActive, recoveryDone, week });
  const eff = totalEfficiency(imem);

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
