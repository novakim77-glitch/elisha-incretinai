// Proactive coaching — event-driven timers (not cron).
// Currently: post-meal walk reminder (40 min after lunch/dinner).

const { getDailyRoutine, getProfile, toLogicalDate } = require('./store');
const { schema } = require('imem-core');
const { db } = require('./firebase');
const { paths, makeEvent, SOURCE, EVENT } = schema;

let _bot = null;
const _timers = new Map(); // key → timeout id

function initProactive(bot) {
  _bot = bot;
}

/** Safe send — swallow per-user errors. */
async function safeSend(chatId, text) {
  try {
    await _bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    console.error(`[proactive] send failed chatId=${chatId}:`, err.description || err.message);
    return false;
  }
}

async function logNotification(uid, kind, payload = {}) {
  const now = new Date();
  await db().collection(paths.events(uid)).add(
    makeEvent({
      type: EVENT.NOTIFICATION_SENT,
      date: toLogicalDate(now),
      source: SOURCE.SYSTEM_SCHEDULER,
      payload: { kind, ...payload },
      now,
    }),
  );
}

/**
 * Schedule a walk reminder 40 minutes after a qualifying meal.
 * Only for lunch/dinner. Skips if routine 5 (글루코스 클리어런스) already done.
 */
function schedulePostMealWalk(uid, chatId, date, mealType) {
  if (!_bot) return;
  if (mealType !== 'lunch' && mealType !== 'dinner') return;

  const key = `walk:${uid}:${date}:${mealType}`;
  // Reset if already scheduled (e.g. user logged a second lunch item)
  if (_timers.has(key)) {
    clearTimeout(_timers.get(key));
    _timers.delete(key);
  }

  const timer = setTimeout(async () => {
    _timers.delete(key);
    try {
      const profile = (await getProfile(uid)) || {};
      if (profile.notifyPrefs && profile.notifyPrefs.postMealWalk === false) return;

      const daily = await getDailyRoutine(uid, date);
      if (daily.checks && daily.checks[5]) return; // already did the walk

      const mealKr = mealType === 'lunch' ? '점심' : '저녁';
      const text = [
        `🚶 *${mealKr} 식후 40분 지났어요!*`,
        ``,
        `지금 빠른 걷기 *30분*이면 혈당 클리어런스 최적 타이밍이에요.`,
        `GLUT4 수용체가 활성화되어 혈당을 직접 연소합니다.`,
        ``,
        `완료하면: /check 6`,
      ].join('\n');

      const ok = await safeSend(chatId, text);
      if (ok) await logNotification(uid, 'post_meal_walk', { mealType });
    } catch (e) {
      console.error('[proactive] postMealWalk error:', e.message);
    }
  }, 40 * 60 * 1000); // 40 minutes

  _timers.set(key, timer);
  console.log(`[proactive] walk reminder scheduled: ${key} (40min)`);
}

function clearAllTimers() {
  for (const [key, timer] of _timers) {
    clearTimeout(timer);
  }
  _timers.clear();
}

module.exports = { initProactive, schedulePostMealWalk, clearAllTimers };
