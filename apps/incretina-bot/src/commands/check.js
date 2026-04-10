// /check — show unlocked routines, toggle by index.
//   /check              → list today's routines w/ status
//   /check 1 3 5        → mark those indices as done (1-based for humans)
//   /check uncheck 1    → clear mark

const { constants } = require('imem-core');
const { getDailyRoutine, setRoutineChecks, toLogicalDate } = require('../store');
const { resolveUser } = require('./_shared');

async function checkCommand(ctx) {
  const { uid, week, unlocked } = await resolveUser(ctx);
  const date = toLogicalDate(new Date());
  const daily = await getDailyRoutine(uid, date);

  const args = (ctx.match || '').trim().split(/\s+/).filter(Boolean);
  let uncheck = false;
  let tokens = args;
  if (tokens[0] === 'uncheck') { uncheck = true; tokens = tokens.slice(1); }

  if (tokens.length > 0) {
    // Mark / unmark
    const updates = {};
    const invalid = [];
    for (const tok of tokens) {
      const human = Number(tok);
      const idx = human - 1; // humans use 1-based
      if (!Number.isInteger(human) || !unlocked.includes(idx)) {
        invalid.push(tok);
        continue;
      }
      updates[idx] = !uncheck;
    }
    if (invalid.length) {
      return ctx.reply(
        `⚠️ 사용할 수 없는 번호: ${invalid.join(', ')}\n` +
        `현재 주(${week}주차)에 해제된 루틴 번호만 선택할 수 있어요. /check 로 목록을 다시 확인해 주세요.`,
      );
    }
    await setRoutineChecks(uid, date, updates);
    // Re-read and fall through to display
    daily.checks = { ...daily.checks, ...updates };
  }

  // Render list
  let lines = [`📋 *오늘의 루틴* (${date}, ${week}주차)\n`];
  let done = 0;
  unlocked
    .slice()
    .sort((a, b) => a - b)
    .forEach((i) => {
      const r = constants.routine[i];
      const checked = !!daily.checks[i];
      if (checked) done += 1;
      const mark = checked ? '✅' : '⬜️';
      const human = i + 1;
      lines.push(`${mark} *${human}.* ${r.icon} ${r.t} ${r.title} (${r.pts}점)\n    _${r.action}_`);
    });
  lines.push('');
  lines.push(`완료: ${done}/${unlocked.length}`);
  lines.push('');
  lines.push('체크: `/check 1 3 5`   해제: `/check uncheck 1`');
  lines.push('점수 보기: `/score`');

  return ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = { checkCommand };
