// IncretinA i Telegram Bot — Phase 0 entry point.
// Run: node src/index.js   (or: npm run dev)

require('dotenv').config();

const { Bot } = require('grammy');
const { initFirebase } = require('./firebase');
const { startCommand } = require('./commands/start');
const { linkCommand } = require('./commands/link');
const { checkCommand } = require('./commands/check');
const { weightCommand } = require('./commands/weight');
const { scoreCommand } = require('./commands/score');
const { goldenCommand } = require('./commands/golden');
const { predictCommand } = require('./commands/predict');
const { chatHandler, personaCommand, photoHandler, mealCallbackHandler, personaCallbackHandler } = require('./commands/chat');
const { rankingCommand, participantsCommand } = require('./commands/ranking');
const { preloadCommand, preloadCallbackHandler } = require('./commands/preload');
const { validateClient } = require('./claude');
const { startScheduler, runManualTrigger } = require('./scheduler');
const { initProactive } = require('./proactive');
const { db } = require('./firebase');
const { sendChallengeEncouragement } = require('./notifiers');
const { markChallengeTriggerProcessed, saveTestResultPending } = require('./store');
const { handleFeelingCallback } = require('./commands/feeling');
const { decodeTestToken } = require('./utils/testToken');
const { handleContentStart, contentActionCallback } = require('./commands/contentAction');
const { handleCheckinCallback } = require('./commands/checkin');
const { handlePredictionCallback } = require('./commands/prediction');
const { broadcastCommand } = require('./commands/broadcast');
const { handleBodyCompCallback } = require('./localRouter');
const { crewSetupCommand, nicknameCommand, crewCommand, crewJoinCommand, crewLeaveCommand, crewOnCommand, crewOffCommand, crewInviteCommand, crewInviteCallbackHandler } = require('./commands/crew');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN missing. Copy .env.example → .env and fill it in.');
  process.exit(1);
}

initFirebase();

// Validate Anthropic API key early — fail fast if misconfigured
try {
  validateClient();
} catch (e) {
  console.error('\u274c', e.message, '\u2014 bot will start but AI chat will not work.');
}

const bot = new Bot(TOKEN);

// ── Commands ──
// /start — 일반 진입 + Track D deep link (ti_ 토큰 처리)
bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim() || '';
  if (payload.startsWith('do_')) {
    // Loop 1: 라이브러리 [오늘 이거 해보기] deep link
    try {
      const handled = await handleContentStart(ctx, payload);
      if (handled) return;
    } catch (e) {
      console.warn('[start:do_] failed:', e.message);
    }
    return startCommand(ctx); // 알 수 없는 키 → 일반 /start 폴백
  }
  if (payload.startsWith('ti_')) {
    // 인크레틴 코드 테스트 deep link
    const token = payload.slice(3); // "ti_" 제거
    try {
      const decoded = decodeTestToken(token);
      const chatId = ctx.chat.id;
      await saveTestResultPending(chatId, decoded).catch((e) => {
        console.warn('[start:ti_] saveTestResultPending failed:', e.message);
      });
      // decoded.type은 딥링크 토큰 출처 → 알려진 값만 표시(원문 HTML 주입 차단)
      const typeLabel = { alpha: '🌅 리듬형', beta: '🥚 순서형', gamma: '💪 민감도형', balanced: '⭐ 밸런스형' }[decoded.type] || '내 타입';
      await ctx.reply(
        `인크레틴 코드 테스트 결과를 받았어요 🤍\n\n` +
        `내 타입: <b>${typeLabel}</b>\n\n` +
        `앱과 연결하면 이 결과를 바탕으로 맞춤 코칭이 시작돼요.\n` +
        `이미 연결되어 있다면 테스트 결과가 자동으로 반영됩니다.\n\n` +
        `앱 연결: /link [6자리 코드]`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.warn('[start:ti_] token decode failed:', e.message);
      // 토큰 오류 시 일반 /start 로 폴백
      return startCommand(ctx);
    }
    return;
  }
  return startCommand(ctx);
});
bot.command('link',    linkCommand);
bot.command('check',   checkCommand);
bot.command('weight',  weightCommand);
bot.command('score',   scoreCommand);
bot.command('golden',  goldenCommand);
bot.command('predict', predictCommand);
bot.command('persona', personaCommand);
bot.command('ranking',      rankingCommand);      // 관리자: CCS 순위
bot.command('participants', participantsCommand); // 관리자: 참가자 현황
bot.command('broadcast',    broadcastCommand);    // 관리자: 전체 공지 (ADMIN_CHAT_ID 게이팅)
bot.command('preload',      preloadCommand);      // 프리로드 레시피 추천
// ── 크루 시스템 (Phase 1) ──
bot.command('crew_setup',   crewSetupCommand);    // 관리자: 크루 생성·설정 (그룹챗에서)
bot.command('crew_on',      crewOnCommand);       // 관리자: 크루 활성화
bot.command('crew_off',     crewOffCommand);      // 관리자: 크루 발송 중지
bot.command('crew_invite',  crewInviteCommand);   // 관리자: 특정 사용자 초대 DM 발송
bot.command('crew_join',    crewJoinCommand);     // 멤버: 참여(opt-in)
bot.command('crew_leave',   crewLeaveCommand);    // 멤버: 탈퇴
bot.command('nickname',     nicknameCommand);     // 멤버: 표시 이름 변경
bot.command('crew',         crewCommand);         // 멤버: 내 크루 정보
bot.command('myid', (ctx) => ctx.reply(`내 Telegram Chat ID: <code>${ctx.from?.id}</code>`, { parse_mode: 'HTML' })); // 본인 chatId 확인 (초대용)

// ── Meal confirm/edit/cancel callbacks (must come before text handler) ──
bot.callbackQuery(/^meal:/, mealCallbackHandler);
bot.callbackQuery(/^persona:/, personaCallbackHandler);
// ── Phase 1: 느낌 버튼 콜백 ──
bot.callbackQuery(/^feeling:/, handleFeelingCallback);
// ── 프리로드 콜백 ──
bot.callbackQuery(/^preload:/, preloadCallbackHandler);
// ── Loop 1: 콘텐츠 행동 제안 콜백 ──
bot.callbackQuery(/^doact:/, contentActionCallback);
// ── Phase 0: 아침 체중 안부 콜백 ──
bot.callbackQuery(/^checkin:/, handleCheckinCallback);
// ── 제안 1+2: 오후 검증(예측→검증) 콜백 ──
bot.callbackQuery(/^pvfeel:/, handlePredictionCallback);
// ── 체성분 인라인 버튼 콜백 ──
bot.callbackQuery(/^bca:/, handleBodyCompCallback);
// ── 크루 초대 응답 콜백 ──
bot.callbackQuery(/^crewinvite:/, crewInviteCallbackHandler);

// ── Photo handler (vision MVP — food → kcal + IMEM β) ──
bot.on('message:photo', photoHandler);

// ── Natural language fallback (must be last) ──
bot.on('message:text', chatHandler);

// ── Later-phase stubs ──
const stubs = {
  report:  '🛠 /report 는 Phase 4 에서 곧 추가됩니다.',
};
for (const [cmd, msg] of Object.entries(stubs)) {
  bot.command(cmd, (ctx) => ctx.reply(msg));
}

// ── Catch-all error handler ──
bot.catch((err) => {
  console.error('Bot error:', err);
});

// ── 관리자 수동 챌린지 독려 트리거 감시 ──
// 앱 관리자 버튼 → Firestore challenges/weekly-challenge.manualTrigger.processed=false
// → 봇이 감지 → 즉시 발송 → processed=true 로 표시 (중복 방지)
function watchChallengeTrigger(bot) {
  const ref = db().doc('challenges/weekly-challenge');
  ref.onSnapshot(async (snap) => {
    if (!snap.exists) return;
    const trigger = snap.data().manualTrigger;
    if (!trigger || trigger.processed !== false) return;

    console.log('[challenge] 수동 트리거 감지 — 즉시 독려 메시지 발송');
    try {
      // 먼저 처리중 표시 (중복 실행 방지)
      await markChallengeTriggerProcessed();
      await sendChallengeEncouragement(bot, true);
    } catch (e) {
      console.error('[challenge] 수동 트리거 처리 실패:', e);
    }
  }, (err) => {
    console.warn('[challenge] Firestore 리스너 오류:', err.message);
  });
  console.log('👀 챌린지 수동 트리거 감시 시작 (challenges/weekly-challenge)');
}

// ── Boot ──
(async () => {
  // If NOTIFY_NOW is set, run the one-shot notifier and exit (no polling).
  if (await runManualTrigger(bot)) {
    process.exit(0);
  }

  const mode = (process.env.BOT_MODE || 'polling').toLowerCase();
  if (mode === 'polling') {
    console.log('🤖 IncretinA i Bot — polling mode (dev)');
    initProactive(bot);
    startScheduler(bot);
    watchChallengeTrigger(bot);   // 관리자 수동 독려 메시지 리스너
    bot.start();
  } else {
    console.error('Webhook mode is configured for Phase 2 deployment. Use polling for Phase 0.');
    process.exit(1);
  }
})();
