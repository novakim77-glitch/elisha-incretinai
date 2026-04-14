# IncretinA i — 프로젝트 컨텍스트

> 새 대화를 시작할 때 Claude가 자동으로 읽는 파일입니다.
> 작업 후 "현재 진행 상태" 섹션을 업데이트해 주세요.

## 프로젝트 개요

**IncretinA i** — 인크레틴 호르몬 기반 대사 건강 관리 앱 + 텔레그램 AI 코치 봇.
IMEM(Incretin Metabolic Efficiency Model) v2.0의 α/β/γ 계수를 기반으로 10개 루틴 + 8개 위험 요인을 추적하고, 텔레그램 봇이 자연어 코칭·식사 기록·루틴 체크를 수행합니다.

## 아키텍처

### 앱 (PWA, GitHub Pages)
- **배포 파일**: `IncretinAi_v7.0_Adaptive.html` (루트) — 이것이 실제 사용자가 보는 파일
- **작업 사본**: `인크레티나_ELISHA/최신/IncretinAi_v7.0.html` — 변경 시 반드시 배포 파일과 동기화
- **GitHub Pages**: `novakim77-glitch/elisha-incretinai` 레포, master 브랜치
- Single-file HTML PWA (Firebase SDK inline, Chart.js inline)

### 텔레그램 봇 (Fly.io)
- **소스**: `apps/incretina-bot/src/`
  - `index.js` — grammY bot 엔트리, 명령어 라우팅
  - `claude.js` — Claude Sonnet 4.5 API 연동, 페르소나 3종, 도구 호출
  - `store.js` — Firestore 읽기/쓰기 (paths, setRoutineChecks, saveMealLog 등)
  - `commands/chat.js` — 자연어 대화 핸들러 (get_today_status, log_meal 등)
  - `commands/check.js` — /check 명령어 (루틴 토글)
  - `commands/_shared.js` — resolveUser, checksObjToArray
  - `commands/score.js` — /score 명령어 (IMEM 점수 조회)
  - `commands/weight.js` — /weight 명령어 (체중 기록)
  - `commands/predict.js` — /predict 명령어 (체중 예측)
  - `localRouter.js` — 로컬 라우터 (regex 한국어 의도 감지, Claude API 우회)
  - `scheduler.js` — 시간대별 알림 스케줄
  - `notifiers.js` — 텔레그램 푸시 알림 (리캡에 IMEM 해석 포함)
- **배포**: `flyctl deploy --app incretina-bot --ha=false` (Windows: `C:/Users/novak/.fly/bin/flyctl.exe`)
- **프레임워크**: grammY (Telegram Bot API)

### 공통 패키지
- `packages/imem-core/`
  - `schema.js` — Firestore paths, EVENT enum, SOURCE enum, _meta 헬퍼
  - `constants.js` — routine[], risks[] 정의
  - `index.js` — getUserWeek, getUnlockedRoutineIndices, 점수 계산
  - `calculate.js` — calculateIMEM (α/β/γ), computeBetaMeal, totalEfficiency
  - `meal-utils.js` — classifyMealType, calculateTargetCalories, analyzeMealDay, getMealBudget
  - `interpret.js` — interpretIMEM, interpretAlpha/Beta/Gamma/Score/Efficiency (쉬운 한국어 해석)
  - `context-builder.js` — Claude 도구 호출용 IMEM 컨텍스트 빌더

### 데이터베이스 (Firestore)
- `users/{uid}` — 프로필, telegramChatId, notifyPrefs
- `users/{uid}/dailyRoutines/{YYYY-MM-DD}` — checks(map), riskChecks(map), recoveries(map), weight, meals[], score, imem 계수
- `users/{uid}/events/{auto-id}` — Schema v2 이벤트 로그 (append-only)
- `linkCodes/{6자리코드}` — 텔레그램 연결용 임시 코드

## 핵심 규칙 (반드시 준수)

### 데이터 동기화
- **checks/riskChecks/recoveries는 map `{0:true, 1:false, ...}` 형태**로 저장. 배열로 쓰면 봇 데이터 덮어씀
- **saveDailyToCloud는 touched-set 방식**: `_userTouchedRoutines` Set에 담긴 인덱스만 저장, 나머지는 `merge:true`가 클라우드 값 보존
- **낙관적 UI 보호**: `_savePending` 플래그 + touched-set이 비어있지 않으면 `loadDateData`가 해당 인덱스를 덮어쓰지 않음. touched-set은 `saveDailyToCloud` 완료 후에만 클리어
- **`_normalizeMap()`**: array든 map이든 안전하게 boolean 배열로 변환하는 유틸 — loadDateData, saveDailyToCloud, checkBadges에서 사용
- **weight 필드**: 사용자가 실제 입력한 경우만 기록 (빈 값이면 기록 안 함 → 봇이 기록한 체중 보존)

### 파일 동기화
- `IncretinAi_v7.0_Adaptive.html` (배포)와 `인크레티나_ELISHA/최신/IncretinAi_v7.0.html` (작업 사본)은 **항상 동일하게 유지**
- 한쪽만 수정하면 사용자가 보는 앱과 작업 파일이 달라져서 혼란 발생

### 봇 배포
- 봇 코드 수정 후 반드시 Fly.io 재배포
- 로컬에서 `npm run dev` 돌리면 Fly.io 인스턴스와 **polling conflict** 발생 — 하나만 실행

### 코드 스타일
- 앱 HTML은 minified single-line JS (가독성보다 파일 크기 우선)
- 봇은 일반 Node.js 스타일

## 텔레그램 봇 페르소나 (3종)

1. **따뜻한 대사 코치** (`empathetic`) — 감정 공감 + 작은 실천 칭찬
2. **GLP-1 전문 임상의** (`clinical`) — IMEM 지표 + GLP-1 기전 + 과학적 식단 + 건기식 추천
3. **강인한 트레이너** (`driver`) — 짧고 강한 푸시 + 운동·식단 강조

변경: 텔레그램에서 "페르소나 변경" 입력 → InlineKeyboard 선택

## 주요 기능 목록

- 10개 루틴 체크 (Progressive Unlocking by week)
- 8개 위험 요인 + 회복 미션
- IMEM v2.0 실시간 계수 (α/β/γ) + β_meal 보정
- Bio-Sync Timer (골든타임 카운트다운)
- 체중 추이 차트 + 4주 예측
- 오늘의 식사 카드 (봇 사진 분석 + 채팅 텍스트 기록)
- IMEM β_meal 엔진 통합 (식사 데이터 → 실시간 IMEM 보정)
- 식사 피드백 시스템 (누적 칼로리, 다음 끼니 예산, 단백질 갭, 야식 경고)
- 끼니 자동 분류 (아침/점심/저녁/야식, 시간 기반)
- IMEM 계수 쉬운 해석 (숫자 → 한국어 평문 설명)
- 시간대 인식 + 위치 변경 명령어 (profile.timezone 기반)
- 로컬 라우터 (간단 질의 regex 처리, API 비용 절감)
- 멀티모델 폴백 (Sonnet → Haiku → 기본 메시지)
- 텔레그램 봇 연동 (코드 발급 → /link)
- 시간대별 텔레그램 알림 (06:30~22:00, 13개 슬롯)
- 프로액티브 코칭 Phase 1: 이벤트 기반 알림 (미완료 루틴, 야식 회복, 식사 미기록, 식후 산책)
- 프로액티브 코칭 Phase 2: 22시 리캡 트렌드 분석 (체중 연속 증가, IMEM 하락, 루틴 미스 연속)
- 프로액티브 코칭 Phase 3: 페르소나별 알림 톤 + 프리코칭 (11:00 점심 준비, 16:30 저녁 준비)
- 게이미피케이션 (XP, 레벨, 뱃지, 퀘스트)
- 대시보드 접기/펼치기 (차트·IMEM 상세)

## 과거 주요 버그 & 교훈

| 버그 | 원인 | 교훈 |
|------|------|------|
| 봇 루틴 체크가 앱에 안 보임 | app이 checks를 전체 map으로 덮어씀 → 봇 마크 삭제 | touched-set 방식 필수 |
| recoveries.forEach 터짐 | map으로 바꿨는데 .forEach 호출 남아있음 | _normalizeMap 통일 |
| checkBadges 무한루프 | .filter() on map object → TypeError → 반복 호출 | array/map 양쪽 처리 |
| 코드 발급 버튼 멈춤 | Firestore offline 큐잉, set() 미응답 | 8초 타임아웃 + enableNetwork |
| 앱 수정했는데 반영 안 됨 | 배포 파일이 아닌 작업 사본만 수정 | 두 파일 항상 동기화 |
| 해외에서 날짜가 하루 앞서감 | toLogicalDate가 KST 하드코딩 | 모든 호출에 profile.timezone 전달 필수 |
| 루틴 체크 후 원복됨 | freshClick 보호 2.5초 만료 후 onSnapshot이 stale 데이터로 DOM 덮어씀 | 시간 기반→상태 기반 보호 (_savePending + touched-set 완료 후 클리어) |
| Docker CACHED로 코드 미반영 | Depot 빌드 캐시 | deploy 후 로그에서 COPY DONE 확인 |

## 현재 진행 상태

> 마지막 업데이트: 2026-04-14

### 완료된 작업
- 대시보드 UX 개선 완료 (카드 재배치, 접기, 봇 상태 배너)
- saveDailyToCloud 클라우드 기반 병합 방식으로 최종 수정 완료
- 텔레그램 코드 발급 안정화 완료 (오프라인 차단, 토큰 갱신, 타임아웃)
- checkBadges 무한루프 + 회로 차단기 수정 완료
- 웹 브로셔 (brochure.html) 완료
- 로컬 라우터 + 멀티모델 폴백 구현 완료 (localRouter.js, claude.js)
- 남은 루틴 시간 기반 분류 수정 완료 (handleStatus: 완료/남은/놓친 구분)
- **IMEM beta_meal 엔진 통합** 완료 (commit `7962e71`)
  - meal-utils.js 신규 생성 (끼니 분류, 칼로리 목표, 식사 분석)
  - computeBetaMeal() : beta_meal = 0.95 + avgBetaScore * 0.075 (범위 0.95~1.025)
  - beta_net 공식 변경: beta_base * beta_meal - penalty + recovery
  - store.js: mealType 자동 태깅 + 야식(19시 이후) R-06 자동 활성화
  - chat.js: buildMealFeedback() 실시간 식사 코칭
  - localRouter: 식사 요약 템플릿 + beta_meal 표시
  - 하위 호환: 식사 없으면 beta_meal=1.0
- **IMEM 계수 쉬운 해석** 완료 (commit `a35a9e0`)
  - interpret.js: alpha/beta/gamma/점수/효율 한국어 평문 해석
  - 22시 리캡과 "점수" 조회에 해석 텍스트 표시
- **시간대 인식** 완료 (commit `5d966b9`, `0f33ea9`)
  - 모든 toLogicalDate() 호출에 profile.timezone 적용 (기본값 Asia/Seoul)
  - "시간대 베트남" 명령어로 timezone/위도 즉시 변경
  - 지원 지역: 한국, 베트남(호치민/하노이/다낭), 일본, 미국, 중국, 태국
  - store.js: updateUserLocation() 함수 추가
- **프로액티브 코칭 Phase 1** 완료
  - proactive.js: 식후 40분 산책 리마인더 (setTimeout 기반)
  - notifiers.js: 5개 조건 기반 알림 (missedPreload/Sequence/DinnerClose, lateNightRecovery, noMealNudge)
  - scheduler.js: 11개 → 13개 cron 슬롯 확장
- **프로액티브 코칭 Phase 2** 완료 — 22시 리캡 트렌드 분석
  - analyzeWeightTrend(): 3일 연속 체중 증가 감지
  - analyzeIMEMDrop(): 전일 대비 α/β/γ >0.1 하락 감지
  - analyzeRoutineMissStreak(): 동일 루틴 3일+ 연속 미완료 감지
  - store.js: getRecentDailyRoutines(uid, days) 추가
- **프로액티브 코칭 Phase 3** 완료 — 페르소나 반영 + 프리코칭
  - PERSONA_TONES: empathetic/clinical/driver별 메시지 톤 정의
  - getUserPersona(): botSettings에서 페르소나 읽기
  - 모든 알림(morning, lastCall, morningLight, lunchGolden, dinnerGolden, recap)에 페르소나별 메시지 적용
  - sendPreLunchCoaching(11:00): 점심 1시간 전 준비 가이드
  - sendPreDinnerCoaching(16:30): 저녁 준비 + 누적칼로리 기반 조언

### IMEM beta_meal 계수 상세
- 공식: beta_meal = 0.95 + avgBetaScore * 0.075
- 범위: 0.95 (최악) ~ 1.025 (최적), 중립점 avgBetaScore = 0.67
- 끼니 분류: 06:00-09:59 아침, 11:00-13:59 점심, 17:00-18:59 저녁, 19:00+ 야식
- 칼로리 목표: Mifflin-St Jeor BMR x 1.2 - 500 (최소 1200kcal)
- 끼니 예산: 아침 25%, 점심 40%, 저녁 30%, 간식 5%
- 피드백: 식사 기록 시 누적칼로리, 다음끼니 예산, 단백질갭, 매크로 불균형 경고, 야식 경고

### 스케줄러 시간표 (13개 슬롯)
```
06:30 morningLight     — 햇빛 노출 (페르소나)
06:35 lateNightRecovery — 어제 야식 회복 코칭
07:00 morningBriefing  — 모닝 브리핑 (페르소나)
11:00 preLunchCoaching  — 점심 프리코칭 (페르소나) [NEW]
11:30 lunchGolden      — 점심 골든타임 (페르소나)
11:35 missedPreload    — 프리로드 미완료
13:30 missedSequence   — 시퀀스 미완료
16:30 preDinnerCoaching — 저녁 프리코칭 (페르소나) [NEW]
17:00 dinnerGolden     — 저녁 골든타임 (페르소나)
18:00 noMealNudge      — 식사 미기록
18:30 lastCall         — 메타볼릭 스위치 (페르소나)
19:30 missedDinnerClose — 저녁 마감 미완료
22:00 dailyRecap       — 리캡 + 트렌드 분석 (페르소나)
```

### 안정성 보강 (2026-04-14)
- **공유 정규화 계층** (`normalize.js`): `normalizeProfile` + `normalizeDaily`
  - 문자열→숫자, cm/m 자동 감지, cw/weight/sw 폴백 체인
  - riskChecks/riskActive, recoveries/recoveryDone 필드명 통합 읽기
- **경계 테스트**: 50개 (test-boundary.js) + 36개 (test-sync-logic.js) = **86개 전체 통과**
- **수정된 CRITICAL 버그**:
  - riskChecks vs riskActive 필드명 불일치 → 봇 IMEM 페널티가 항상 0이던 버그
  - prediction.js h 단위 오류 (cm*100 = 17000)
  - context-builder.js profile.cw 항상 undefined
  - calculateTargetCalories BMR 10만대 산출 → 저녁예산 4만kcal
  - chatId 참조 오류 → 식사/루틴 저장 실패
- **PWA 캐시 자동 갱신** (SW v2.0):
  - `updateViaCache:'none'` + `{cache:'no-cache'}` + `visibilitychange` 체크
  - 배포 시 `APP_VERSION` 한 줄 변경으로 전 사용자 자동 업데이트
- **식단 코칭**: 봇 "식단" 질문 시 칼로리 분석 + 목표 대비 % + 행동요령 즉시 응답

### Phase 2 안정성 보강 (2026-04-14)
- **Firestore 트랜잭션 보호**: `appendMeal` + `setRoutineChecks` → `runTransaction` 적용
  - 동시 식사 기록 시 하나가 유실되는 race condition 방지
  - 동시 루틴 체크 시 check 누락 방지
- **context-builder normalizeDaily 적용**: `riskChecks`→`riskActive`, `recoveries`→`recoveryDone` 정규화
  - `buildIMEMContext`에 앱 형식 데이터 직접 전달해도 crash 안 남
  - checks의 array/map 양쪽 형태 모두 처리
- **calculateIMEM 방어 처리**: `riskActive`/`recoveryDone` undefined 시 빈 객체 폴백
- **Smoke test 추가** (`test-smoke.js`): 67개 테스트 — 실 사용 시나리오 전체 파이프라인 검증
  - 전체 테스트: **153개** (67 smoke + 50 boundary + 36 sync) 전부 통과

### 다음 할 일 / 알려진 이슈
- 앱 측에도 beta_meal/해석 반영 검토 (현재 봇만 적용)
- _source vs _meta.source 어트리뷰션 통일 검토 (test 파일에만 존재, 낮은 우선순위)
- 프로액티브 코칭 실사용 피드백 수집 필요 (알림 빈도, 페르소나 톤)
- 트렌드 분석 정확도 실데이터 확인 필요 (3일 이상 기록 있는 사용자)
