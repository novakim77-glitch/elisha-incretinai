// Helpers shared by Phase 1 commands.
const { constants, getUserWeek, getUnlockedRoutineIndices } = require('imem-core');
const {
  findUidByChatId, ensureStandaloneUser, getProfile, countHistoryDays,
  backfillLinkFlag,
} = require('../store');

/**
 * Resolve the bot user: returns { uid, profile, week, unlocked }.
 * Creates a standalone user if first contact.
 */
async function resolveUser(ctx) {
  const chatId = ctx.chat.id;
  let uid = await findUidByChatId(chatId);
  if (!uid) {
    uid = await ensureStandaloneUser({
      chatId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
    });
  }
  const profile = (await getProfile(uid)) || {};
  // Backfill telegramLinked flag for users that linked before the mirror was added
  if (!String(uid).startsWith('tg_') && !profile.telegramLinked) {
    try { await backfillLinkFlag(uid, chatId); profile.telegramLinked = true; profile.telegramChatId = chatId; }
    catch (e) { console.warn('backfill link flag failed:', e.message); }
  }
  const historyDays = await countHistoryDays(uid);
  const week = getUserWeek({
    userStartDate: profile.userStartDate || null,
    historyDays,
    now: new Date(),
  });
  const unlocked = getUnlockedRoutineIndices(week);
  return { uid, profile, week, unlocked };
}

/**
 * Convert a `{index: bool}` map into a length-10 boolean array
 * the imem-core score/calculate functions expect.
 */
function checksObjToArray(obj, len = constants.routine.length) {
  const arr = new Array(len).fill(false);
  if (!obj) return arr;
  for (const [k, v] of Object.entries(obj)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < len) arr[i] = !!v;
  }
  return arr;
}

function riskObjToArray(obj, len = constants.risks.length) {
  const arr = new Array(len).fill(false);
  if (!obj) return arr;
  for (const [k, v] of Object.entries(obj)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < len) arr[i] = !!v;
  }
  return arr;
}

module.exports = { resolveUser, checksObjToArray, riskObjToArray };
