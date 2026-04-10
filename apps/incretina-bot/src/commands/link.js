// /link <6-digit-code> — bind this Telegram chat to an existing IncretinA i Firebase UID.

const { consumeLinkCode } = require('../store');

async function linkCommand(ctx) {
  const arg = (ctx.match || '').trim();

  if (!/^\d{6}$/.test(arg)) {
    return ctx.reply(
      `사용법: /link 482917\n\n` +
      `IncretinA i 앱 → 설정 → 텔레그램 연결 에서 6자리 코드를 받아 입력해 주세요.\n` +
      `(코드는 5분간만 유효합니다)`,
    );
  }

  const result = await consumeLinkCode({
    code: arg,
    chatId: ctx.chat.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
  });

  if (!result.ok) {
    const messages = {
      not_found:    '코드를 찾을 수 없어요. 앱에서 새 코드를 발급받아 다시 시도해 주세요.',
      already_used: '이미 사용된 코드예요. 새 코드를 발급받아 주세요.',
      expired:      '코드가 만료되었어요 (5분 초과). 새 코드를 발급받아 주세요.',
    };
    return ctx.reply(`⚠️ ${messages[result.reason] || '알 수 없는 오류가 발생했어요.'}`);
  }

  return ctx.reply(
    `🎉 IncretinA i 계정과 연결되었어요!\n\n` +
    `이제 여기서 루틴 체크, 체중 기록, AI 코칭을 받을 수 있어요.\n` +
    `/check 로 오늘의 루틴을 확인해 보세요.`,
  );
}

module.exports = { linkCommand };
