// /weight 72.5 — log today's weight

const { logWeight, toLogicalDate, getProfile } = require('../store');
const { resolveUser } = require('./_shared');

async function weightCommand(ctx) {
  const { uid } = await resolveUser(ctx);
  const raw = (ctx.match || '').trim();

  if (!raw) {
    const profile = await getProfile(uid);
    const last = profile && profile.weight ? `현재 기록: *${profile.weight} kg*` : '아직 기록된 체중이 없어요.';
    return ctx.reply(
      `⚖️ *체중 기록*\n\n${last}\n\n사용법: \`/weight 72.5\``,
      { parse_mode: 'Markdown' },
    );
  }

  const w = Number(raw);
  if (!Number.isFinite(w) || w < 25 || w > 300) {
    return ctx.reply('⚠️ 25~300 사이의 숫자(kg)로 입력해 주세요. 예: `/weight 72.5`', { parse_mode: 'Markdown' });
  }

  const date = toLogicalDate(new Date());
  await logWeight(uid, date, w);
  return ctx.reply(
    `✅ 오늘 체중 *${w} kg* 기록 완료 (${date}).\n예측을 보시려면 /predict`,
    { parse_mode: 'Markdown' },
  );
}

module.exports = { weightCommand };
