// ─────────────────────────────────────────────
// 라이브러리 티저 — "오늘의 한 장"
// 라이브러리 콘텐츠(과학 16 + 본식 순서 10)의 메타데이터 인덱스.
// 후킹 1~2문장만 봇이 보여주고, [자세히 보기] 버튼으로
// 라이브러리 해당 콘텐츠 상세 딥링크(?item=science-7)에 연결.
// Claude 호출 없음 — 사전 작성 문구만 사용 (API 비용 0).
// ─────────────────────────────────────────────

const LIBRARY_URL = 'https://novakim77-glitch.github.io/elisha-incretinai/IncretinAi_Library.html';

// key: 딥링크 id (라이브러리 HTML의 type-id와 일치해야 함)
// coeff: 추천 매칭용 IMEM 계수 태그 (alpha/beta/gamma/general)
// tags: 맥락 매칭 (latenight = 야식·수면·일주기 관련)
const TEASERS = [
  // ── 인크레틴 과학 (SCIENCE 16) ──
  { key: 'science-12', coeff: 'general', emoji: '🧪', title: '인크레틴이란 무엇인가?',
    hook: '위고비·마운자로의 정체가 사실 우리 몸이 매일 만들고 있는 호르몬이라는 것, 아셨나요? 5분이면 전체 그림이 보여요.' },
  { key: 'science-1', coeff: 'beta', emoji: '🧬', title: 'GLP-1은 어떻게 분비되는가',
    hook: '식사 15~30분 전 한 입이 왜 본식 과식을 줄여줄까요? 그 비밀은 소장 끝의 L세포에 있어요.' },
  { key: 'science-2', coeff: 'beta', emoji: '🥗', title: '채소→단백질→탄수화물 순서의 과학',
    hook: '같은 메뉴인데 먹는 순서만 바꿔도 몸의 반응이 달라져요. 흡수가 40% 느려지는 이유.' },
  { key: 'science-3', coeff: 'alpha', emoji: '🌅', title: 'Bio-Sync 골든타임의 진실',
    hook: '같은 음식도 먹는 시간에 따라 몸의 반응이 달라요. 일출과 일몰 사이가 특별한 이유.' },
  { key: 'science-4', coeff: 'gamma', emoji: '🚶', title: '식후 산책의 메타볼릭 효과',
    hook: '식후 10분 걷기가 만드는 차이, 생각보다 큽니다. 근육이 혈당을 빨아들이는 골든타임.' },
  { key: 'science-5', coeff: 'beta', emoji: '⚖️', title: '"천연 위고비"의 과학적 진실',
    hook: 'SNS에서 화제인 식전 달걀+올리브오일, 진짜일까요? 과학이 답하는 부분과 과장된 부분.' },
  { key: 'science-6', coeff: 'general', emoji: '💊', title: 'GLP-1이 체중 감량에 도움이 되는 이유',
    hook: '위고비가 효과 있는 4가지 기전 — 알고 나면 내 몸이 스스로 하는 일이 보여요.' },
  { key: 'science-7', coeff: 'general', emoji: '💉', title: 'GLP-1 주사를 끊으면 요요가 오는 이유',
    hook: '중단 1년 안에 감량분의 66%가 돌아오는 메커니즘. 미리 알면 대비할 수 있어요.' },
  { key: 'science-8', coeff: 'alpha', tags: ['latenight'], emoji: '🌙', title: '인크레틴 호르몬 일주기 과학',
    hook: '같은 야식도 밤에 먹으면 더 부담되는 건 기분 탓이 아니에요. 호르몬에도 시계가 있거든요.' },
  { key: 'science-9', coeff: 'gamma', emoji: '🏋️', title: 'GLP-1 호르몬 부스터 생활습관',
    hook: '약 없이 포만 호르몬을 끌어올리는 검증된 5가지. 이미 하고 계신 것도 있을 거예요.' },
  { key: 'science-10', coeff: 'gamma', emoji: '🔥', title: '인슐린 저항성이 살찌는 진짜 이유',
    hook: '많이 먹어서가 아니라, 신호가 둔해져서 살찌는 악순환 — 끊는 방법이 있어요.' },
  { key: 'science-11', coeff: 'alpha', tags: ['latenight'], emoji: '⏰', title: '공복 14시간이 특별한 이유',
    hook: '저녁을 일찍 닫으면 몸 안에서 리셋 스위치가 켜져요. AMPK라는 이름의 청소부 이야기.' },
  { key: 'science-13', coeff: 'beta', emoji: '☕', title: '커피와 인크레틴 — 마시는 타이밍의 과학',
    hook: '커피가 포만 호르몬을 부스트한다는 사실, 알고 계셨나요? 단, 마시는 타이밍이 중요해요.' },
  { key: 'science-14', coeff: 'gamma', tags: ['latenight'], emoji: '😴', title: '수면이 인크레틴을 살린다',
    hook: '잠을 줄이면 다음 날 더 배고픈 이유 — 수면 부족은 포만 호르몬을 직접 망가뜨려요.' },
  { key: 'science-15', coeff: 'gamma', emoji: '🏃', title: '시간대별 운동법 — Day vs Night',
    hook: '아침엔 유산소, 저녁엔 근력 — 같은 운동도 시간대에 따라 효과가 달라요.' },
  { key: 'science-16', coeff: 'general', emoji: '🩺', title: '인크레틴의 놀라운 효과 — 비만·당뇨·치매까지',
    hook: '체중 감량을 넘어 전신 건강까지 — GLP-1이 몸 곳곳에 미치는 증명된 효과들.' },

  // ── 본식 순서 가이드 (BSEQ 10) ──
  { key: 'bseq-1', coeff: 'beta', emoji: '🥗', title: '인크레틴 비빔밥',
    hook: '비빔밥, 비비기 전에 나물 먼저 — 순서 하나로 같은 비빔밥이 다른 식사가 돼요.' },
  { key: 'bseq-2', coeff: 'beta', emoji: '🥣', title: '된장찌개 정식 순서',
    hook: '가장 한국적인 식탁이 사실 최적의 식사가 될 수 있어요. 나물→건더기→밥 순서면.' },
  { key: 'bseq-3', coeff: 'beta', emoji: '🥩', title: '제육볶음 + 쌈 정식',
    hook: '고기도 순서만 지키면 부담 없는 식사 — 핵심은 쌈채소 1~2장을 먼저.' },
  { key: 'bseq-4', coeff: 'beta', emoji: '🍝', title: '파스타 인크레틴 버전',
    hook: '파스타 포기 안 해도 돼요. 샐러드 먼저, 면은 나중 — 순서가 답이에요.' },
  { key: 'bseq-5', coeff: 'beta', emoji: '🍱', title: '볶음밥 / 덮밥 전략',
    hook: '한 그릇 메뉴는 순서를 못 지킨다? 원 플레이트에서도 가능한 공략법이 있어요.' },
  { key: 'bseq-6', coeff: 'beta', emoji: '🔥', title: '삼겹살집 가이드',
    hook: '회식 삼겹살집에서도 지킬 수 있어요 — 고기 굽는 동안 할 일이 딱 하나 있거든요.' },
  { key: 'bseq-7', coeff: 'beta', emoji: '🍣', title: '초밥집 가이드',
    hook: '초밥은 밥과 생선이 한 입에 — 그래도 순서를 만드는 방법이 있어요.' },
  { key: 'bseq-8', coeff: 'beta', emoji: '🥡', title: '중국집 가이드',
    hook: '짜장면 먹는 날, 죄책감 대신 전략을 — 주문 단계부터 시작하는 피해 최소화.' },
  { key: 'bseq-9', coeff: 'beta', emoji: '🍔', title: '패스트푸드 가이드',
    hook: '버거를 먹어야 하는 날의 현실적인 가이드 — 어쩔 수 없을 때 피해 줄이기.' },
  { key: 'bseq-10', coeff: 'beta', emoji: '🍽️', title: '뷔페 완전 정복',
    hook: '뷔페는 다이어트의 무덤? 접시 순서만 바꾸면 오히려 연습장이 돼요.' },
];

// ─────────────────────────────────────────────
// Loop 1 — 행동 변환 테이블 (콘텐츠 → 오늘 해볼 행동 1개)
// 라이브러리 [오늘 이거 해보기] 버튼 → /start do_<type>_<id> → 여기서 제안 생성.
// 모든 confirm은 *이미 존재하는* 알림 슬롯에 연결 — 신규 스케줄링 코드 없음.
// ─────────────────────────────────────────────

// 각 confirm = ㉠ 지금 당장 할 작은 행동 1개 + ㉡ 실제로 일어나는 후속(실재 슬롯)만 약속.
//   (이행 코드가 없는 "오늘 짚어드릴게요" 류 빈 약속 제거 — 신뢰 붕괴 방지)
const ACTION_CONFIRMS = {
  // walk/move → schedulePostMealWalk(식사 기록 시 40분 뒤 산책 알림)로 실재 이행
  walk:    '좋아요! 그럼 지금 딱 하나 — 다음 식사 후 10분 걷기예요 🚶 식사를 기록하시면 40분 뒤에 산책 타이밍을 챙겨드릴게요.',
  move:    '좋아요! 그럼 지금 딱 하나 — 다음 식사 후 10분 걷기 어때요 💪 식사를 기록하시면 40분 뒤에 산책 타이밍을 챙겨드릴게요.',
  // mealseq → 점심·저녁 프리코칭(정규 슬롯)이 받쳐줌
  mealseq: '좋아요! 다음 끼니에 딱 하나 — 채소부터 먼저 한 입이에요 🥗 식사 전 코칭 때 제가 다시 살짝 짚어드릴게요.',
  // preload → 오전 10:30 프리로드 추천(정규 슬롯)
  preload: '좋아요! 본식 15~30분 전 단백질 한 입 — 그게 프리로드예요 🥚 다음 식사 전에 한번 해보세요. 오전 10:30 추천도 보내드려요.',
  // timing → 18:30 마감 신호(정규 슬롯)
  timing:  '좋아요! 오늘 저녁은 평소보다 30분 일찍 닫아볼까요 ⏰ 6시 반쯤 제가 마감 신호도 드릴게요.',
  // sleep/insight → 다음날 아침 모닝 메아리로 실재 이행 (당일 빈 약속 제거)
  sleep:   '좋아요! 오늘 밤 딱 하나 — 자기 1시간 전 화면 끄기예요 😴 내일 아침 브리핑에서 다시 챙겨드릴게요.',
  insight: '좋아요! 그럼 오늘 첫 끼니부터 기록해볼까요 🤍 내일 아침 브리핑에서 한번 더 짚어드릴게요.',
};

const ACTIONS = {
  'science-12': { cat: 'insight', propose: '인크레틴의 전체 그림을 보셨네요. 이제 매끼가 호르몬 훈련의 기회예요 — 오늘 기록부터 같이 시작해볼까요?' },
  'science-1':  { cat: 'preload', propose: '프리로드의 과학까지 보셨다면 이제 실전이죠 🥚 내일 점심 전 10:30에 추천 레시피를 보내드릴까요?' },
  'science-2':  { cat: 'mealseq', propose: '식사 순서의 과학, 읽기만 하면 아깝죠 🥗 다음 끼니에 채소 먼저 — 식사 시간에 제가 한 번 상기시켜 드릴까요?' },
  'science-3':  { cat: 'timing',  propose: '골든타임 글 보고 오셨군요 🌅 오늘 저녁 마감을 같이 챙겨볼까요? 6시 반쯤 제가 신호 드릴게요.' },
  'science-4':  { cat: 'walk',    propose: '식후 산책 글 보고 오셨네요 🚶 오늘 식사를 기록하시면 40분 뒤에 산책 타이밍을 알려드릴까요?' },
  'science-5':  { cat: 'preload', propose: '"천연 위고비"의 진실까지 아셨다면 직접 해보셔야죠 🥚 내일 10:30에 프리로드 추천을 보내드릴까요?' },
  'science-6':  { cat: 'insight', propose: '약이 하는 일을 알면, 내 몸이 할 수 있는 일도 보여요. 오늘 기록에 이 관점을 얹어 코칭해드릴까요?' },
  'science-7':  { cat: 'insight', propose: '요요의 메커니즘을 아셨다면 절반은 온 거예요. 내 몸의 분비 능력을 챙기는 코칭, 오늘부터 시작해볼까요?' },
  'science-8':  { cat: 'timing',  propose: '호르몬에도 시계가 있다는 이야기, 와닿으셨나요 🌙 오늘 저녁을 너무 늦지 않게 — 6시 반쯤 제가 신호 드릴까요?' },
  'science-9':  { cat: 'move',    propose: '5가지 부스터 중 하나만 오늘 해보면 어때요? 제가 오늘 흐름을 봐서 하나 짚어드릴까요?' },
  'science-10': { cat: 'insight', propose: '악순환은 아는 순간부터 끊을 수 있어요. 오늘 기록에 이 관점을 얹어 코칭해드릴까요?' },
  'science-11': { cat: 'timing',  propose: '공복 14시간의 시작은 저녁 마감이에요 ⏰ 오늘 6시 반쯤 마감 신호를 드릴까요?' },
  'science-13': { cat: 'insight', propose: '커피 타이밍의 과학까지 보셨네요 ☕ 내일 아침 커피 전에 제가 핵심 한 줄을 짚어드릴까요?' },
  'science-14': { cat: 'sleep',   propose: '수면이 포만 호르몬을 지킨다는 것, 오늘 밤부터 해볼까요 😴 리캡 때 수면 준비를 같이 점검해드릴까요?' },
  'science-15': { cat: 'move',    propose: '시간대별 운동법을 보셨다면, 오늘 내 시간대에 맞는 한 가지 — 제가 골라드릴까요?' },
  'science-16': { cat: 'insight', propose: '인크레틴이 몸 전체에 하는 일을 보셨네요. 오늘의 작은 실천이 그 전부와 연결돼요 — 같이 시작해볼까요?' },
  'bseq-1':  { cat: 'mealseq', propose: '비빔밥 공략법까지 보셨네요 🥗 다음에 비빔밥 드실 때 나물 먼저 — 식사 시간에 제가 상기시켜 드릴까요?' },
  'bseq-2':  { cat: 'mealseq', propose: '된장찌개 정식 순서, 오늘 저녁에 바로 써먹을 수 있어요 🥣 식사 전에 제가 핵심 순서를 상기시켜 드릴까요?' },
  'bseq-3':  { cat: 'mealseq', propose: '제육볶음+쌈 전략까지 보셨다면 실전 준비 끝 🥩 다음 식사 전에 쌈채소 먼저 — 제가 상기시켜 드릴까요?' },
  'bseq-4':  { cat: 'mealseq', propose: '파스타도 순서가 답이라는 것, 다음 파스타 날에 샐러드 먼저 — 식사 전에 제가 상기시켜 드릴까요?' },
  'bseq-5':  { cat: 'mealseq', propose: '한 그릇 메뉴 공략법까지 보셨네요 🍱 다음 덮밥 날, 핵심 한 가지를 식사 전에 짚어드릴까요?' },
  'bseq-6':  { cat: 'mealseq', propose: '삼겹살집 가이드까지 보셨다면 회식 준비 끝 🔥 다음 식사 전에 핵심(쌈채소 먼저)을 상기시켜 드릴까요?' },
  'bseq-7':  { cat: 'mealseq', propose: '초밥집에서도 순서를 만들 수 있어요 🍣 다음 식사 전에 핵심 순서를 상기시켜 드릴까요?' },
  'bseq-8':  { cat: 'mealseq', propose: '중국집 전략까지 보셨네요 🥡 다음 식사 전에 주문 단계 팁부터 상기시켜 드릴까요?' },
  'bseq-9':  { cat: 'mealseq', propose: '패스트푸드 날의 피해 줄이기, 알아두면 든든하죠 🍔 다음 식사 전에 핵심을 상기시켜 드릴까요?' },
  'bseq-10': { cat: 'mealseq', propose: '뷔페 공략법까지 보셨다면 이제 뷔페가 연습장이에요 🍽️ 다음 식사 전에 접시 순서를 상기시켜 드릴까요?' },
};

// Loop 2 — 모닝 메아리: 어제 [좋아요]한 약속을 다음날 아침에 한 줄로 상기
// (Markdown V1 모닝 브리핑에 삽입되므로 *·_ 금지 — 이모지만 사용)
const ACTION_ECHOES = {
  walk:    '어제 식후 산책 해보기로 하셨죠 🚶 오늘 식사 기록하시면 40분 뒤에 제가 챙길게요.',
  mealseq: '어제 "채소 먼저" 해보기로 하셨죠 🥗 오늘 첫 끼니에서 바로 시작해봐요.',
  preload: '어제 프리로드 해보기로 하셨죠 🥚 오전 10:30에 추천 레시피 보내드릴게요.',
  timing:  '어제 저녁 일찍 닫기로 하셨죠 ⏰ 오늘 저녁 6시 반에 제가 신호 드릴게요.',
  sleep:   '어제 수면 챙기기로 하셨죠 😴 오늘 밤 리캡에서 같이 점검해요.',
  move:    '어제 몸 움직여보기로 하셨죠 💪 오늘 기회가 보이면 제가 짚어드릴게요.',
  insight: '어제 읽으신 글, 오늘 하루 기록에 같이 녹여볼게요 🤍',
};

// 'science-4' → 메아리 문구 | null
function getIntentEcho(key) {
  const act = ACTIONS[key];
  if (!act) return null;
  return ACTION_ECHOES[act.cat] || ACTION_ECHOES.insight;
}

// Loop 1-③ — 당일 메아리: 오늘 [좋아요]한 약속을 같은 날 정규 슬롯(프리코칭/마감)에서 이행
// "어제~"가 아닌 "아까~" 톤. 안전: plain text(특수 parse 없음), 이모지만.
const ACTION_ECHOES_TODAY = {
  walk:    '🔖 아까 식후 산책 해보기로 하셨죠 🚶 이번 식사 후 10분이면 충분해요.',
  move:    '🔖 아까 몸 움직여보기로 하셨죠 💪 이번 식사 후 10분 걷기 어때요.',
  mealseq: '🔖 아까 "채소 먼저" 해보기로 하셨죠 🥗 이번 끼니에서 바로 시작해봐요.',
  preload: '🔖 아까 프리로드 해보기로 하셨죠 🥚 본식 15~30분 전 단백질 한 입이에요.',
  timing:  '🔖 아까 저녁 일찍 닫기로 하셨죠 ⏰ 오늘 그 약속, 지금부터 지켜봐요.',
  sleep:   '🔖 아까 수면 챙기기로 하셨죠 😴 오늘 밤 화면 한 시간 일찍 꺼봐요.',
  insight: '🔖 아까 읽으신 글, 오늘 기록에 같이 녹여봐요 🤍',
};

// 오늘(today) 'yes'한 contentIntent 중 cats에 해당하는 가장 최근 1개 → 당일 메아리 문구 | null
//   intents: users/{uid}.contentIntents [{ k, s, d }]  (s: click/yes/no, d: YYYY-MM-DD)
function getActiveIntentEcho(intents, cats, today) {
  if (!Array.isArray(intents) || !today) return null;
  const hit = intents.find((i) =>
    i && i.s === 'yes' && i.d === today &&
    ACTIONS[i.k] && cats.includes(ACTIONS[i.k].cat));
  if (!hit) return null;
  return ACTION_ECHOES_TODAY[ACTIONS[hit.k].cat] || null;
}

// /start do_science_4 → { key:'science-4', propose, confirm } | null
function getContentAction(payload) {
  const m = String(payload || '').match(/^do_(science|bseq)_(\d+)$/);
  if (!m) return null;
  const key = `${m[1]}-${m[2]}`;
  const act = ACTIONS[key];
  if (!act) return null;
  const teaser = TEASERS.find((t) => t.key === key) || {};
  return {
    key,
    title: teaser.title || '',
    emoji: teaser.emoji || '📖',
    propose: act.propose,
    confirm: ACTION_CONFIRMS[act.cat] || ACTION_CONFIRMS.insight,
  };
}

// ─────────────────────────────────────────────
// 추천 — 맥락 우선순위 풀에서 미노출 콘텐츠 선택
//   ① 어제 야식 → latenight 태그  ② β 낮음 → beta 콘텐츠
//   ③ 테스트 weakest 계수 매칭     ④ 전체 순환 (최근 노출 제외)
// ─────────────────────────────────────────────
function pickTeaser({ recentKeys = [], lateNight = false, lowBeta = false, weakest = null } = {}) {
  const pools = [];
  if (lateNight) pools.push(TEASERS.filter((t) => (t.tags || []).includes('latenight')));
  if (lowBeta) pools.push(TEASERS.filter((t) => t.coeff === 'beta'));
  if (weakest) pools.push(TEASERS.filter((t) => t.coeff === weakest));
  pools.push(TEASERS);
  for (const pool of pools) {
    const fresh = pool.filter((t) => !recentKeys.includes(t.key));
    if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  }
  // 전부 최근 노출됨 → 전체에서 랜덤 (이론상 도달 어려움: 후보 26 > 히스토리 14)
  return TEASERS[Math.floor(Math.random() * TEASERS.length)];
}

// 리캡에 덧붙일 HTML 라인 배열 (리캡은 parse_mode:'HTML')
function teaserHtmlLines(teaser) {
  return [
    '',
    '📚 <b>오늘의 한 장</b>',
    `${teaser.emoji} <b>${teaser.title}</b>`,
    `<i>${teaser.hook}</i>`,
  ];
}

// [자세히 보기] 버튼 — 라이브러리 딥링크로 해당 콘텐츠 상세가 바로 열림
function teaserKeyboard(teaser) {
  return {
    inline_keyboard: [[
      { text: '📖 자세히 보기', url: `${LIBRARY_URL}?item=${teaser.key}` },
    ]],
  };
}

module.exports = { TEASERS, ACTIONS, LIBRARY_URL, pickTeaser, teaserHtmlLines, teaserKeyboard, getContentAction, getIntentEcho, getActiveIntentEcho };
