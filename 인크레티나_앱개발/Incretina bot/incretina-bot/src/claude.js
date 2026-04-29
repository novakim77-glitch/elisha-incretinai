// Claude API integration — natural-language coaching for IncretinA i bot.
// Phase 3: Sonnet 4.6 with persona system + tool calling.
// Includes: timeout, auto-retry, error classification.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
const FALLBACK_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TURNS = 10; // history window per user

// Last-resort message when all AI models fail
const BASIC_FALLBACK_MSG = '죄송해요, AI 서버가 일시적으로 불안정해요.\n'
  + '직접 루틴을 확인하려면: /check\n'
  + '점수 확인: "점수" 또는 "현황" 입력\n'
  + '잠시 후 다시 말씀해 주세요!';

// ─────────────────────────────────────────────
// Client (singleton) — timeout + retries built-in
// ─────────────────────────────────────────────

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 45_000,   // 45 s per request
      maxRetries: 2,     // SDK auto-retries on 429/5xx (with back-off)
    });
  }
  return client;
}

/**
 * Validate that the API key is set and the client can be constructed.
 * Call once at boot; throws synchronously if key is missing.
 */
function validateClient() {
  getClient();
  console.log('\u2705 Anthropic client ready \u2014 model:', MODEL);
}

// ─────────────────────────────────────────────
// Error classification helper
// ─────────────────────────────────────────────

function classifyApiError(err) {
  const status = err?.status ?? err?.error?.status ?? 0;
  const msg = err?.message ?? '';

  if (status === 401 || /authentication|unauthorized/i.test(msg)) {
    return { userMsg: 'AI 서비스 인증에 문제가 있어요. 관리자에게 알려주세요.', logTag: 'AUTH_ERROR', retryable: false };
  }
  if (status === 403 || /permission|forbidden/i.test(msg)) {
    return { userMsg: 'AI 서비스 접근 권한에 문제가 있어요. 관리자에게 알려주세요.', logTag: 'PERMISSION_ERROR', retryable: false };
  }
  if (status === 429 || /rate.?limit|too.?many/i.test(msg)) {
    return { userMsg: '지금 요청이 많아요. 30초 후에 다시 말씀해 주세요.', logTag: 'RATE_LIMIT', retryable: true };
  }
  if (status === 529 || /overloaded/i.test(msg)) {
    return { userMsg: 'AI 서버가 일시적으로 바빠요. 잠시 후 다시 시도해 주세요.', logTag: 'OVERLOADED', retryable: true };
  }
  if (status >= 500 || /internal.?server|server.?error/i.test(msg)) {
    return { userMsg: 'AI 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.', logTag: 'SERVER_ERROR', retryable: true };
  }
  if (/timeout|timed?.?out|ECONNRESET|ENOTFOUND|fetch.?failed/i.test(msg)) {
    return { userMsg: 'AI 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요.', logTag: 'TIMEOUT', retryable: true };
  }
  if (status === 400 || /invalid|bad.?request/i.test(msg)) {
    return { userMsg: '요청 처리 중 문제가 생겼어요. 다시 한 번 말씀해 주세요.', logTag: 'BAD_REQUEST', retryable: false };
  }
  return { userMsg: 'AI 응답 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.', logTag: 'UNKNOWN', retryable: false };
}

const PERSONAS = {
  empathetic: `당신은 IncretinA i의 따뜻한 대사 코치입니다.
사용자의 감정을 먼저 인정하고, 작은 실천을 칭찬하며, 부드럽게 다음 행동을 제안합니다.
이모지는 절제해서 사용 (한 메시지에 1-2개). 짧고 친근한 문장으로 답하세요.
비난·압박 금지, "괜찮아요" "잘하고 있어요" 같은 긍정 언어를 자연스럽게 사용.`,

  clinical: `당신은 IncretinA i의 GLP-1 전문 임상의입니다.
α(타이밍)/β(시퀀스)/γ(감수성) IMEM 지표와 객관적 수치를 중심으로 답합니다.
GLP-1 분비촉진 기전(프리로드, 식이섬유, 단백질 우선 시퀀스, 저녁 마감 등)에 대한 근거 있는 한 줄 설명 + 구체적 권고를 제시합니다.
과학적 식단(저혈당지수, 단백질 1.2-1.6 g/kg, 식이섬유 25g+)과 생활습관(식후 보행, 수면 리듬)을 강조합니다.
필요 시 근거 기반 건강기능식품(이눌린, 사이리움, 베르베린, 오메가3, 마그네슘, 비타민D 등)을 적정 용량과 함께 추천합니다.
이모지 최소화, 의학 용어는 간결히 풀어 설명.`,

  driver: `당신은 IncretinA i의 강인한 트레이너입니다.
짧고 강한 문장으로 사용자를 밀어붙입니다. "오늘 한 번 더, 지금 바로." 같은 직설적 푸시.
변명·타협을 차단하고 즉각적인 행동을 끌어냅니다.
운동(스쿼트·런지·인터벌·근력)과 식단(단백질 확보, 정제탄수 배제, 수분)을 강하게 강조하세요.
문장은 3-5개 이내로 간결하게. 느낌표와 명령형을 적극 사용.`,
};

function systemPrompt(persona, ctx) {
  const base = PERSONAS[persona] || PERSONAS.empathetic;
  const date = ctx.date || '(날짜 미확인)';
  const week = ctx.week ?? '?';
  const unlocked = (ctx.unlocked || []).map((i) => i + 1).join(', ');
  const checked = Object.entries(ctx.checks || {})
    .filter(([, v]) => v)
    .map(([k]) => Number(k) + 1)
    .join(', ') || '없음';

  // 오늘 측정값 vs 이전 기록값을 명확히 구분
  let weightLine;
  if (ctx.weight != null) {
    weightLine = `${ctx.weight} kg (오늘 측정)`;
  } else if (ctx.profileWeight != null) {
    const lastDate = ctx.lastWeightDate ? ` [${ctx.lastWeightDate} 기록]` : ' (이전 기록)';
    weightLine = `${ctx.profileWeight} kg${lastDate} — 오늘 미측정`;
  } else {
    weightLine = '미기록';
  }

  return `${base}

# 사용자 컨텍스트 (오늘: ${date})
- 오늘 날짜: ${date}
- 현재 주차: Week ${week}
- 잠금 해제 루틴 (1-based): ${unlocked}
- 오늘 체크 완료 루틴: ${checked}
- 체중: ${weightLine}

# 도구 사용 규칙
- 사용자가 "X 했어", "Y 끝냈어" 같이 행동을 보고하면 바로 mark_routine 도구로 기록.
- 체중 숫자(예: "72.5", "오늘 73kg")를 말하면 log_weight 도구로 기록.
- 식사 텍스트 설명(예: "점심으로 제육볶음 먹었어 칼로리 알려줘")엔 먼저 추정 칼로리/매크로/β 평가를 대화로 답변. 그 다음 사용자가 "기록해줘", "저장해줘", "점심 기록" 등으로 명시 요청하면 log_meal 도구 호출.
- 점수/현황 질문엔 get_score 또는 get_today_status 사용.
- "남은 루틴", "뭐 남았어", "오늘 할 거" 같은 질문엔 get_today_status 호출 후 remaining 배열을 활용해:
  · 번호만 말하지 말고 반드시 {time} {icon} {title} — {action} 형식으로 각 항목 풀어서 설명.
  · critical:true 항목은 맨 앞에 "⚠️ 핵심" 표시하고 왜 중요한지(β 시퀀스/메타볼릭 스위치 등) 한 줄 코멘트 추가.
  · 남은 게 많으면 핵심 먼저 + 다음 시간대순으로 나열.
  · 마지막에 지금 당장 할 수 있는 1개를 추천.
- "체중 추이", "지난 일주일 체중", "변화" 같은 질문엔 get_weight_history(days) 호출 후 추세(증가/감소/유지)와 변화량을 짧게 요약.
- 도구로 기록한 후엔 한 줄로 짧게 확인 + 격려.
- 절대 사용자에게 슬래시 명령어(/check 등)를 쓰라고 안내하지 마세요. 봇이 직접 처리합니다.`;
}

// ─────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'mark_routine',
    description: '오늘 날짜의 플러스 루틴을 체크 처리합니다. 1-based 인덱스 배열로 전달.',
    input_schema: {
      type: 'object',
      properties: {
        indices: {
          type: 'array',
          items: { type: 'integer' },
          description: '체크할 루틴 번호 (1-10)',
        },
      },
      required: ['indices'],
    },
  },
  {
    name: 'unmark_routine',
    description: '오늘 날짜의 플러스 루틴 체크를 해제합니다.',
    input_schema: {
      type: 'object',
      properties: {
        indices: { type: 'array', items: { type: 'integer' } },
      },
      required: ['indices'],
    },
  },
  {
    name: 'log_weight',
    description: '오늘 체중을 kg 단위로 기록합니다.',
    input_schema: {
      type: 'object',
      properties: {
        kg: { type: 'number', description: '체중 (25-300 사이)' },
      },
      required: ['kg'],
    },
  },
  {
    name: 'get_today_status',
    description: '오늘 체크 현황과 체중을 조회합니다.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_weight_history',
    description: '최근 N일간의 체중 기록을 조회합니다 (체중 추이/변화 질문에 사용).',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '조회 일수 (1-60, 기본 7)' },
      },
    },
  },
  {
    name: 'log_meal',
    description: '텍스트로 설명한 식사를 앱에 기록합니다. 사용자가 "기록해줘", "저장해줘" 등으로 명시적으로 요청할 때만 호출.',
    input_schema: {
      type: 'object',
      properties: {
        menu: { type: 'string', description: '음식 요약 (예: 제육볶음 정식)' },
        kcal: { type: 'integer', description: '추정 칼로리' },
        kcalLow: { type: 'integer', description: '하한' },
        kcalHigh: { type: 'integer', description: '상한' },
        protein: { type: 'integer', description: '단백질 g (선택)' },
        fat: { type: 'integer', description: '지방 g (선택)' },
        carbs: { type: 'integer', description: '탄수 g (선택)' },
        hasVeg: { type: 'boolean', description: '채소 포함 여부' },
        hasProtein: { type: 'boolean', description: '단백질 포함 여부' },
        betaScore: { type: 'number', description: 'IMEM β 시퀀스 품질 0-1' },
        time: { type: 'string', description: 'HH:MM (선택, 미제공시 현재시각)' },
      },
      required: ['menu', 'kcal'],
    },
  },
  {
    name: 'get_meal_summary',
    description: '오늘 식사 기록 조회 + 칼로리 분석 + 코칭을 반환합니다. 사용자가 "오늘 뭐 먹었지", "식단", "식사 기록" 등을 물을 때 사용.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_score',
    description: '오늘 IMEM 점수(α/β/γ)를 계산해 반환합니다.',
    input_schema: { type: 'object', properties: {} },
    // ↓ 프롬프트 캐싱: 시스템 프롬프트 + 전체 도구 정의를 캐시
    // 캐시 히트 시 입력 토큰 비용 90% 절감 ($3/M → $0.30/M)
    // 캐시 최소 기준 1,024 토큰 — system(~600) + tools(~800) = ~1,400 토큰으로 충족
    cache_control: { type: 'ephemeral' },
  },
];

module.exports = {
  getClient,
  validateClient,
  classifyApiError,
  MODEL,
  MAX_TURNS,
  PERSONAS,
  systemPrompt,
  TOOLS,
  FALLBACK_MODEL,
  BASIC_FALLBACK_MSG,
};
