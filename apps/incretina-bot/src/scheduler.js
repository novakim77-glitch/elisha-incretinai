// Phase 2A — Local cron scheduler (runs while bot process is alive).
// Times are KST (Asia/Seoul). Phase 2B will migrate these to Cloud Functions.

const cron = require('node-cron');
const {
  sendMorningBriefing, sendLastCall, sendDailyRecap,
  sendMorningLight, sendLunchGolden, sendDinnerGolden,
} = require('./notifiers');

const TZ = 'Asia/Seoul';

function startScheduler(bot) {
  // 06:30 KST — 햇빛 노출 (NEW)
  cron.schedule('30 6 * * *', () => {
    sendMorningLight(bot).catch((e) => console.error('[cron] morning-light failed:', e));
  }, { timezone: TZ });

  // 07:00 KST — morning briefing
  cron.schedule('0 7 * * *', () => {
    sendMorningBriefing(bot).catch((e) => console.error('[cron] morning failed:', e));
  }, { timezone: TZ });

  // 11:30 KST — 점심 골든타임 임박 (NEW)
  cron.schedule('30 11 * * *', () => {
    sendLunchGolden(bot).catch((e) => console.error('[cron] lunch-golden failed:', e));
  }, { timezone: TZ });

  // 17:00 KST — 저녁 골든타임 임박 (NEW)
  cron.schedule('0 17 * * *', () => {
    sendDinnerGolden(bot).catch((e) => console.error('[cron] dinner-golden failed:', e));
  }, { timezone: TZ });

  // 18:30 KST — metabolic switch last-call
  cron.schedule('30 18 * * *', () => {
    sendLastCall(bot).catch((e) => console.error('[cron] lastcall failed:', e));
  }, { timezone: TZ });

  // 22:00 KST — daily recap
  cron.schedule('0 22 * * *', () => {
    sendDailyRecap(bot).catch((e) => console.error('[cron] recap failed:', e));
  }, { timezone: TZ });

  console.log('⏰ Scheduler armed — 06:30 / 07:00 / 11:30 / 17:00 / 18:30 / 22:00 KST');
}

/**
 * One-shot manual trigger. Does NOT start polling — sends the notification
 * via the bot API and returns. Call from index.js before bot.start().
 * Returns true if a manual trigger ran (caller should exit), false otherwise.
 */
async function runManualTrigger(bot) {
  const nowKind = process.env.NOTIFY_NOW;
  if (!nowKind) return false;

  console.log(`[notify] manual trigger: ${nowKind}`);
  const fn = {
    morning:      () => sendMorningBriefing(bot),
    lastcall:     () => sendLastCall(bot),
    recap:        () => sendDailyRecap(bot),
    morninglight: () => sendMorningLight(bot),
    lunch:        () => sendLunchGolden(bot),
    dinner:       () => sendDinnerGolden(bot),
  }[nowKind];
  if (!fn) {
    console.warn(`[notify] unknown NOTIFY_NOW value: ${nowKind}`);
    return true; // still treat as manual mode → exit
  }
  try {
    await fn();
    console.log(`[notify] manual trigger done: ${nowKind}`);
  } catch (e) {
    console.error('[notify] manual trigger failed:', e);
  }
  return true;
}

module.exports = { startScheduler, runManualTrigger };
