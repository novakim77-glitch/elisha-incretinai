// /predict — 4-week weight projection based on today's IMEM + score

const {
  calculateIMEM, calculateScore, calculateSunTimes, getWeightPrediction, totalEfficiency,
} = require('imem-core');
const { getDailyRoutine, toLogicalDate } = require('../store');
const { resolveUser, checksObjToArray, riskObjToArray } = require('./_shared');

async function predictCommand(ctx) {
  const { uid, profile, week } = await resolveUser(ctx);

  // Require minimum profile fields to predict
  const cw = profile.weight || profile.cw;
  const h = profile.height || profile.h;
  const age = profile.age;
  const gender = profile.gender;
  if (!cw || !h || !age || !gender) {
    return ctx.reply(
      `📐 예측을 위해 프로필이 필요해요:\n` +
      `• 체중 → \`/weight 72.5\`\n` +
      `• 키/나이/성별은 앱의 [프로필]에서 입력 후 다시 시도해 주세요.\n\n` +
      `앱 미사용자용 프로필 명령어는 다음 단계에 추가됩니다.`,
      { parse_mode: 'Markdown' },
    );
  }

  const tz = profile.timezone || 'Asia/Seoul';
  const date = toLogicalDate(new Date(), tz);
  const daily = await getDailyRoutine(uid, date);
  const checks       = checksObjToArray(daily.checks);
  const riskActive   = riskObjToArray(daily.riskActive);
  const recoveryDone = riskObjToArray(daily.recoveryDone);

  const lat = profile.lat || 37.5665;
  const sun = calculateSunTimes(lat);
  const imem = calculateIMEM({ checks, riskActive, recoveryDone, profile, sunset: sun.sunset });
  const score = calculateScore({ checks, riskActive, recoveryDone, week });

  const hMeters = h > 3 ? h / 100 : h; // allow cm or m
  const result = getWeightPrediction({
    imem, score,
    profile: { cw, h: hMeters, age, gender },
  });
  if (!result) return ctx.reply('예측을 계산할 수 없어요. 프로필 정보를 확인해 주세요.');

  const sign = result.delta <= 0 ? '' : '+';
  const lines = [
    `📈 *4주 체중 예측*`,
    ``,
    `현재: *${cw} kg*`,
    `4주 후: *${result.predicted} kg*  (${sign}${result.delta} kg)`,
    `주간 변화: ${sign}${result.weeklyDelta.toFixed(2)} kg/주`,
    ``,
    `_현재 점수 ${score}점 · 대사효율 ${totalEfficiency(imem).toFixed(2)} 기준._`,
    `점수를 올리면 예측이 개선돼요. 오늘 남은 루틴은 /check`,
  ];
  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = { predictCommand };
