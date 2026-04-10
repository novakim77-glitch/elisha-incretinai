// /golden — bio-sync window (sunrise/sunset + metabolic switch deadline)

const { calculateSunTimes, isWithinGoldenTime, getMinutesToSunset } = require('imem-core');
const { resolveUser } = require('./_shared');

function fmt(t) {
  return `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
}

async function goldenCommand(ctx) {
  const { profile } = await resolveUser(ctx);
  const lat = profile.lat || 37.5665;
  const sun = calculateSunTimes(lat);
  const now = new Date();
  const within = isWithinGoldenTime(sun, now);
  const toSunset = getMinutesToSunset(sun, now);

  // Metabolic switch: last meal should be before 19:00
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const switchMin = 19 * 60;
  const minsToSwitch = switchMin - nowMin;

  const lines = [
    `🌅 *Bio-Sync 골든타임*`,
    ``,
    `일출: *${fmt(sun.sunrise)}*`,
    `일몰: *${fmt(sun.sunset)}*`,
    ``,
    within
      ? `☀️ 현재 골든타임 *활성* — 일몰까지 ${Math.max(0, toSunset)}분`
      : `🌙 골든타임 종료 — 내일 일출을 기다립니다`,
    ``,
    `⏰ *Metabolic Switch* (19:00 마감)`,
    minsToSwitch > 0
      ? `남은 시간: *${Math.floor(minsToSwitch / 60)}시간 ${minsToSwitch % 60}분*`
      : `마감 지남 — 내일 프리로드에 집중해 주세요`,
  ];
  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = { goldenCommand };
