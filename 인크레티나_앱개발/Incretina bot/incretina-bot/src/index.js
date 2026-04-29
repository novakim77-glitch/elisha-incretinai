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
const { validateClient } = require('./claude');
const { startScheduler, runManualTrigger } = require('./scheduler');
const { initProactive } = require('./proactive');
const { db } = require('./firebase');
const { sendChallengeEncouragement } = require('./notifiers');
const { markChallengeTriggerProcessed } = require('./store');

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
bot.command('start',   startCommand);
bot.command('link',    linkCommand);
bot.command('check',   checkCommand);
bot.command('weight',  weightCommand);
bot.command('score',   scoreCommand);
bot.command('golden',  goldenCommand);
bot.command('predict', predictCommand);
bot.command('persona', personaCommand);
bot.command('ranking',      rankingCommand);      // 관리자: CCS 순위
bot.command('participants', participantsCommand); // 관리자: 참가자 현황

// ── Meal confirm/edit/cancel callbacks (must come before text handler) ──
bot.callbackQuery(/^meal:/, mealCallbackHandler);
bot.callbackQuery(/^persona:/, personaCallbackHandler);

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
