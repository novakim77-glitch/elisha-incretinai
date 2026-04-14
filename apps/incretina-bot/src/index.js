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
const { validateClient } = require('./claude');
const { startScheduler, runManualTrigger } = require('./scheduler');
const { initProactive } = require('./proactive');

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
    bot.start();
  } else {
    console.error('Webhook mode is configured for Phase 2 deployment. Use polling for Phase 0.');
    process.exit(1);
  }
})();
