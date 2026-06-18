// Phase 2A — Local cron scheduler (runs while bot process is alive).
// Times are KST (Asia/Seoul). Phase 2B will migrate these to Cloud Functions.

const cron = require('node-cron');
const {
  sendMorningBriefing, sendLastCall, sendDailyRecap,
  sendMorningLight, sendLunchGolden, sendDinnerGolden,
  sendMissedPreload, sendMissedSequence, sendMissedDinnerClose,
  sendLunchPreload, sendDinnerPreload,
  sendLateNightRecovery, sendNoMealNudge,
  sendPreLunchCoaching, sendPreDinnerCoaching,
  sendChallengeEncouragement,
  sendAfternoonComfortCheck,
  sendUnmetContent,
  sendBodyCompReminder,
} = require('./notifiers');
const { sendCrewLeaderboard, sendCrewMilestones, sendCrewReturnNudge } = require('./crewNotifier');

const TZ = 'Asia/Seoul';

function startScheduler(bot) {
  // 06:30 KST — 햇빛 노출
  cron.schedule('30 6 * * *', () => {
    sendMorningLight(bot).catch((e) => console.error('[cron] morning-light failed:', e));
  }, { timezone: TZ });

  // 06:35 KST — 어제 야식 회복 코칭
  cron.schedule('35 6 * * *', () => {
    sendLateNightRecovery(bot).catch((e) => console.error('[cron] late-night-recovery failed:', e));
  }, { timezone: TZ });

  // 07:00 KST — morning briefing
  cron.schedule('0 7 * * *', () => {
    sendMorningBriefing(bot).catch((e) => console.error('[cron] morning failed:', e));
  }, { timezone: TZ });

  // 10:30 KST — 점심 프리로드 추천 (Phase B)
  cron.schedule('30 10 * * *', () => {
    sendLunchPreload(bot).catch((e) => console.error('[cron] lunch-preload failed:', e));
  }, { timezone: TZ });

  // 11:00 KST — 점심 프리코칭
  cron.schedule('0 11 * * *', () => {
    sendPreLunchCoaching(bot).catch((e) => console.error('[cron] pre-lunch failed:', e));
  }, { timezone: TZ });

  // 11:30 KST — 점심 골든타임 임박
  cron.schedule('30 11 * * *', () => {
    sendLunchGolden(bot).catch((e) => console.error('[cron] lunch-golden failed:', e));
  }, { timezone: TZ });

  // 11:35 KST — 프리로드 미완료 알림
  cron.schedule('35 11 * * *', () => {
    sendMissedPreload(bot).catch((e) => console.error('[cron] missed-preload failed:', e));
  }, { timezone: TZ });

  // 13:30 KST — 인크레틴 시퀀스 미완료 알림
  cron.schedule('30 13 * * *', () => {
    sendMissedSequence(bot).catch((e) => console.error('[cron] missed-sequence failed:', e));
  }, { timezone: TZ });

  // 16:00 KST — 오후 검증 (예측→검증 루프, flag 격리)
  cron.schedule('0 16 * * *', () => {
    sendAfternoonComfortCheck(bot).catch((e) => console.error('[cron] afternoon-check failed:', e));
  }, { timezone: TZ });

  // 16:30 KST — 저녁 프리코칭
  cron.schedule('30 16 * * *', () => {
    sendPreDinnerCoaching(bot).catch((e) => console.error('[cron] pre-dinner failed:', e));
  }, { timezone: TZ });

  // 17:00 KST — 저녁 골든타임 임박
  cron.schedule('0 17 * * *', () => {
    sendDinnerGolden(bot).catch((e) => console.error('[cron] dinner-golden failed:', e));
  }, { timezone: TZ });

  // 17:30 KST — 저녁 프리로드 추천 (Phase B)
  cron.schedule('30 17 * * *', () => {
    sendDinnerPreload(bot).catch((e) => console.error('[cron] dinner-preload failed:', e));
  }, { timezone: TZ });

  // 18:00 KST — 식사 미기록 넛지
  cron.schedule('0 18 * * *', () => {
    sendNoMealNudge(bot).catch((e) => console.error('[cron] no-meal-nudge failed:', e));
  }, { timezone: TZ });

  // 18:30 KST — metabolic switch last-call
  cron.schedule('30 18 * * *', () => {
    sendLastCall(bot).catch((e) => console.error('[cron] lastcall failed:', e));
  }, { timezone: TZ });

  // 19:30 KST — 저녁 마감 미완료 알림
  cron.schedule('30 19 * * *', () => {
    sendMissedDinnerClose(bot).catch((e) => console.error('[cron] missed-dinner-close failed:', e));
  }, { timezone: TZ });

  // 22:00 KST — daily recap
  cron.schedule('0 22 * * *', () => {
    sendDailyRecap(bot).catch((e) => console.error('[cron] recap failed:', e));
  }, { timezone: TZ });

  // 22:30 KST — 크루 일일 리더보드 (그룹챗 발송, crew 미설정/비활성 시 자동 skip)
  cron.schedule('30 22 * * *', () => {
    sendCrewLeaderboard(bot).catch((e) => console.error('[cron] crew-leaderboard failed:', e));
  }, { timezone: TZ });

  // 22:35 KST — 크루 마일스톤 축하 (그룹챗, 새 달성만)
  cron.schedule('35 22 * * *', () => {
    sendCrewMilestones(bot).catch((e) => console.error('[cron] crew-milestone failed:', e));
  }, { timezone: TZ });

  // 14:00 KST — 크루 부드러운 복귀 (3일+ 비활성 멤버 개인 DM)
  cron.schedule('0 14 * * *', () => {
    sendCrewReturnNudge(bot).catch((e) => console.error('[cron] crew-return failed:', e));
  }, { timezone: TZ });

  // 09:00 KST 매주 월요일 — 챌린지 주간 독려 메시지
  cron.schedule('0 9 * * 1', () => {
    sendChallengeEncouragement(bot, false).catch((e) => console.error('[cron] challenge-encouragement failed:', e));
  }, { timezone: TZ });

  // 09:30 KST 매주 월요일 — 시간축 언멧니즈(탈모) 예고/동행/회복신호 (flag 격리)
  cron.schedule('30 9 * * 1', () => {
    sendUnmetContent(bot).catch((e) => console.error('[cron] unmet failed:', e));
  }, { timezone: TZ });

  // 10:00 KST 매일 — 체성분 재측정 리마인더 (14일 이상 미측정 사용자)
  cron.schedule('0 10 * * *', () => {
    sendBodyCompReminder(bot).catch((e) => console.error('[cron] bodycomp-reminder failed:', e));
  }, { timezone: TZ });

  console.log('⏰ Scheduler armed — 06:30 / 06:35 / 07:00 / 10:00 체성분리마인더 / 10:30 / 11:00 / 11:30 / 11:35 / 13:30 / 16:00 / 16:30 / 17:00 / 17:30 / 18:00 / 18:30 / 14:00 크루복귀 / 19:30 / 22:00 / 22:30 크루리더보드 / 22:35 크루마일스톤 KST | 월 09:00 챌린지 독려 · 월 09:30 언멧니즈');
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
    morning:            () => sendMorningBriefing(bot),
    lastcall:           () => sendLastCall(bot),
    recap:              () => sendDailyRecap(bot),
    morninglight:       () => sendMorningLight(bot),
    lunch:              () => sendLunchGolden(bot),
    dinner:             () => sendDinnerGolden(bot),
    missedpreload:      () => sendMissedPreload(bot),
    lunchpreload:       () => sendLunchPreload(bot),
    dinnerpreload:      () => sendDinnerPreload(bot),
    missedsequence:     () => sendMissedSequence(bot),
    misseddinnerclose:  () => sendMissedDinnerClose(bot),
    latenightrecovery:  () => sendLateNightRecovery(bot),
    nomealnudge:        () => sendNoMealNudge(bot),
    prelunch:           () => sendPreLunchCoaching(bot),
    predinner:          () => sendPreDinnerCoaching(bot),
    afternooncheck:     () => sendAfternoonComfortCheck(bot),
    unmet:              () => sendUnmetContent(bot),
    challenge:          () => sendChallengeEncouragement(bot, true),
    bodycompreminder:   () => sendBodyCompReminder(bot),
    crewleaderboard:    () => sendCrewLeaderboard(bot, { manual: true }),
    crewmilestones:     () => sendCrewMilestones(bot, { manual: true }),
    crewreturn:         () => sendCrewReturnNudge(bot, { manual: true }),
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
