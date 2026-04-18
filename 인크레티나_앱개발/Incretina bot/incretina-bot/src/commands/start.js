// /start — entry point. Two paths:
//   1. Already linked → personal greeting
//   2. New chat → standalone bootstrap + invite to /link

const { findUidByChatId, ensureStandaloneUser } = require('../store');

async function startCommand(ctx) {
  const chatId = ctx.chat.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;

  let uid = await findUidByChatId(chatId);

  if (uid) {
    return ctx.reply(
      `안녕하세요 ${firstName || ''}님 👋\n` +
      `이미 IncretinA i 와 연결되어 있어요.\n\n` +
      `사용 가능한 명령어:\n` +
      `/check — 오늘의 루틴 체크리스트\n` +
      `/weight 78.2 — 체중 기록\n` +
      `/score — 현재 IMEM 점수\n` +
      `/golden — 골든타임 정보`,
    );
  }

  // First-time chat — create standalone user
  uid = await ensureStandaloneUser({ chatId, username, firstName });

  return ctx.reply(
    `안녕하세요 ${firstName || ''}님! 🌅\n` +
    `IncretinA i AI 코치예요.\n\n` +
    `이미 IncretinA i 앱을 사용 중이시면, 앱에서 [설정 → 텔레그램 연결]로 6자리 코드를 받아 다음과 같이 입력해 주세요:\n\n` +
    `   /link 482917\n\n` +
    `앱이 없으셔도 괜찮아요. 여기서 바로 시작할 수 있습니다.\n` +
    `먼저 /check 로 오늘의 루틴부터 보시겠어요?`,
  );
}

module.exports = { startCommand };
