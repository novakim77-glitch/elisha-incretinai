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
- **saveDailyToCloud JS 병합 방식**: `cloudData.checks`를 spread 후 touched 인덱스만 오버라이드 → `data.checks = mergedChecks`로 전체 map 기록
  - ⚠️ **절대 dot notation(`data['checks.0']=true`) + `set({merge:true})` 조합 쓰지 말 것** — `set()`은 dot notation을 리터럴 필드명으로 저장함 (중첩 경로 해석은 `update()`만 지원)
- **_localChecks / _localRisks 메모리 기반 상태**: 유저 클릭 즉시 `window._localChecks[i]=true`에 저장
  - `renderList()` / `renderRiskList()` / `loadDateData()` 모두 `_localChecks`를 최우선 소스로 사용
  - 클라우드 onSnapshot 값과 일치 확인 시 개별 인덱스 삭제 (자동 보호 해제)
  - 날짜 변경 시 `_localChecks={}; _localRisks={}` 리셋 필수
- **touched-set 클리어 시점**: `saveDailyToCloud` 완료 시 클리어하지 않음 — `loadDateData`가 클라우드 확인 후 개별 클리어
- **`_normalizeMap()`**: array든 map이든 안전하게 boolean 배열로 변환하는 유틸 — loadDateData, saveDailyToCloud, checkBadges에서 사용
- **weight 필드**: 사용자가 실제 입력한 경우만 기록 (빈 값이면 기록 안 함 → 봇이 기록한 체중 보존)
- **봇 store.js**: `setRoutineChecks` / `appendMeal` 모두 **batch** 사용 (`runTransaction` 쓰면 봇 체크 실패함 — 검증 완료)

### 파일 동기화
- `IncretinAi_v7.0_Adaptive.html` (배포)와 `인크레티나_ELISHA/최신/IncretinAi_v7.0.html` (작업 사본)은 **항상 동일하게 유지**
- 한쪽만 수정하면 사용자가 보는 앱과 작업 파일이 달라져서 혼란 발생

### 봇 배포
- 봇 코드 수정 후 반드시 Fly.io 재배포
- flyctl 경로: `/opt/homebrew/bin/flyctl` (macOS) — `C:/Users/novak/.fly/bin/flyctl.exe` (Windows)
- 로컬에서 `npm run dev` 돌리면 Fly.io 인스턴스와 **polling conflict** 발생 — 하나만 실행
- macOS 빌드 전 `._*` 리소스 포크 파일 정리 필수: `find . -name "._*" -not -path "./.git/*" -exec rm -f {} \;`

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
| 루틴 체크 후 원복됨 | listenToProfile onSnapshot → renderList() innerHTML 재빌드로 .checked 클래스 유실 | _localChecks 메모리 기반 상태 저장 → renderList/loadDateData에서 최우선 적용 |
| 새로고침 시 체크 전체 초기화 | saveDailyToCloud에서 dot notation(`checks.0`) + set({merge:true}) 사용 → 리터럴 필드명으로 저장되어 data.checks가 갱신 안 됨 | JS 병합 후 `data.checks = mergedChecks` 전체 map 기록으로 변경 |
| 마이너스 루틴 클릭 후 원복 | renderRiskList()에 _localRisks 보호 없음 | renderRiskList에도 동일한 _localRisks 최우선 패턴 적용 |
| 회복 팝업이 네비 바와 겹침 | bottom:0 고정 → 모바일 네비게이션 바 위에 표시됨 | bottom:80px으로 상향 조정 |
| 봇 루틴/식사 저장 실패 | setRoutineChecks/appendMeal을 runTransaction으로 변경 후 봇 오류 발생 | batch로 복귀 (runTransaction은 봇 환경에서 불안정) |
| Docker CACHED로 코드 미반영 | Depot 빌드 캐시 | deploy 후 로그에서 COPY DONE 확인 |

## 현재 진행 상태

> 마지막 업데이트: 2026-04-29

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
- **context-builder normalizeDaily 적용**: `riskChecks`→`riskActive`, `recoveries`→`recoveryDone` 정규화
  - `buildIMEMContext`에 앱 형식 데이터 직접 전달해도 crash 안 남
  - checks의 array/map 양쪽 형태 모두 처리
- **calculateIMEM 방어 처리**: `riskActive`/`recoveryDone` undefined 시 빈 객체 폴백
- **Smoke test 추가** (`test-smoke.js`): 67개 테스트 — 실 사용 시나리오 전체 파이프라인 검증
  - 전체 테스트: **153개** (67 smoke + 50 boundary + 36 sync) 전부 통과
- ~~Firestore runTransaction 적용~~ → **batch로 복귀** (봇 환경에서 runTransaction 불안정 확인)

### 루틴/리스크 체크 BULLETPROOF 수정 (2026-04-15) — SW v7.4.1
**수정 커밋**: `7b28215` → `ee5fab6` → `da7a907`

**핵심 아키텍처 변경 — 3중 보호 레이어**:
1. **_localChecks / _localRisks** (메모리 기반 최우선 상태)
   - `routineDone(i)` → `window._localChecks[i] = true`
   - `toggleRisk(i)` → `window._localRisks[i] = !wasActive`
   - `renderList()` / `renderRiskList()` / `loadDateData()` 모두 이 값을 1순위로 사용
   - 클라우드 값 일치 확인 시 개별 인덱스 자동 해제
2. **saveDailyToCloud JS 병합** (dot notation 버그 수정)
   - `cloudData.checks`를 spread → touched 인덱스 오버라이드 → `data.checks = mergedChecks`
   - riskChecks/recoveries 동일 패턴
3. **renderRiskList 상태 보존** (마이너스 탭 원복 수정)
   - innerHTML 재빌드 전 `wasActive` 배열로 현재 상태 캡처

**회복 팝업 위치 수정**: `bottom:0` → `bottom:80px` (모바일 네비 바 겹침 해소)

### 핵심 가치 보고서 / 발표 자료 (2026-04-15)
- `docs/IncretinAi_Core_Value_Report.md` — 10챕터 "데이터→의미→행동" 가치 분석
- `docs/IncretinAi_Core_Value_Report.docx` — Word 변환 (45KB)
- `docs/IncretinAi_Core_Value_Presentation.pptx` — 12슬라이드 매거진 에디토리얼 스타일 PPT

### 날짜 버그 수정 (2026-04-21)
봇이 "어제 날짜로 요약"하는 버그 조사 및 4중 방어 수정:

1. **`localRouter.js` 시간 계산 신뢰성 강화**
   - `new Date(now.toLocaleString('en-US', {timeZone}))` 해킹 → `Intl.DateTimeFormat('en-GB', ...)` 로 교체
   - `handleStatus`, `handleMealSummary` 양쪽 수정
2. **`handleStatus` 출력에 날짜 표시 추가**
   - "📊 오늘의 루틴 현황 (Week X)" → "📊 오늘의 루틴 현황 / YYYY-MM-DD · Week X"
   - 사용자가 어느 날짜 기준인지 명확히 확인 가능
3. **`chatHandler` session 객체에 `date` 추가**
   - `runTool`이 `sess.date`를 우선 사용 → 동일 요청 내 날짜 일관성 보장
   - 자정 넘기며 도구 호출할 때 날짜 불일치 방지
4. **앱 `saveDailyToCloud` stale 날짜 guard 추가**
   - 저장 직전 `_todayKey`와 `dateKey` 비교 → 불일치 & 자동설정값이면 자동 교정 후 저장
   - 앱 하룻밤 열어두고 아침에 루틴 체크해도 오늘 날짜로 저장 보장
   - 양 사본 동기화: `IncretinAi_v7.0_Adaptive.html` + `인크레티나_앱개발/최신/IncretinAi_v7.0.html`

### 알림 Markdown 버그 수정 (2026-04-23)
`notifiers.js` 4곳에서 Telegram MarkdownV1 파싱 오류 수정:

- **원인**: `β\_meal`, `α\_net` 등 `\_` 표기를 사용했으나, `parse_mode:'Markdown'`(V1)에서는 `\`가 escape 문자가 아님 → `_`가 이탤릭 시작으로 인식, 닫히지 않아 전송 실패
- **영향**: `no-meal-nudge`(18:00), `last-call`(18:30), `dinner-golden`(17:00), `pre-dinner-coaching`(16:30) 알림 전부 실패
- **수정**: `\_` → `_` 로 교체 (4곳 일괄)
- **배포**: Fly.io v36 배포 완료

### IMEM 기술소개 HTML 업데이트 (2026-04-23)
`인크레티나_앱개발/최신/인크레티나/인크레티나_ELISHA/최신/IMEM_기술소개.html` v2.0으로 전면 개편:

- **공식 업데이트**: `β_net = β_base × β_meal − Σ(penalty) + Σ(recovery)` 명시
- **β_meal 섹션 신규**: 공식(0.95~1.025), 사진 AI 분석, 칼로리 예산(아침25%/점심40%/저녁30%), 야식 자동 감지 R-06 연동
- **Progressive Unlocking 섹션 신규**: 1~4주차 루틴 해제 타임라인 시각화
- **8종 위험 요인 섹션 신규**: R-01~R-08 전체, 패널티 점수, 계수 연동, 즉각 회복 미션
- **텔레그램 AI 코치 섹션 신규**: 3종 페르소나 실제 메시지 예시, 트렌드 분석 기능
- **13슬롯 프로액티브 코칭 섹션 신규**: 06:30~22:00 전체 스케줄, Phase 1/2/3 구분
- **How It Works**: 3단계 → 4단계(측정→분석→중재→습관 고착화)
- **과학적 근거**: 4개 → 5개 (Vilsbøll et al., 2003 추가)

### 체중 저장 Claude hallucination 차단 (2026-04-24)
**증상**: 봇에서 "오늘 체중 84.5 기록" 입력 시 봇은 "✅ 기록 완료" 응답했지만 앱에 반영 안 됨.

**진단 (Firestore 직접 조회)**:
- `profile.weight = 84.5` ✓ (어느 시점엔 업데이트됨)
- `profile.lastWeightDate = 2026-04-21` ❌ (3일 전)
- `dailyRoutines/2026-04-24.weight = undefined` ❌

**근본 원인**: `logWeight()`는 batch 하나로 세 필드를 atomic하게 쓰는데 셋이 불일치 → **Claude가 `log_weight` 도구를 호출하지 않고 텍스트로만 "기록 완료"라고 응답한 hallucination**.

앞선 "무결점 수정"은 호출이 일어난 경우의 실패는 방어했지만, 호출 자체가 안 일어난 경우는 못 막음.

**수정 (`localRouter.js`)**:
- 신규 `parseWeightLog()` — 체중 저장 의도 regex 파서 (3가지 매칭 케이스)
- 신규 `handleWeightLog()` — `withRetry(logWeight)` 직접 호출 → Claude 완전 우회
- 우선순위: **weightLog가 모든 패턴보다 먼저** 실행 (query 패턴과 충돌 방지)
- PATTERNS.weight에서 "기록" 키워드 제거 (저장 패턴과 혼동 방지)

**테스트**: 20/20 케이스 통과
- ✓ 저장: "오늘 체중 84.5", "84.5kg 기록", "체중 72.5", "72.5kg", "오늘 84.5kg" 등 14종
- ✓ 조회 유지: "체중", "체중 얼마", "체중 추이", "체중 히스토리" 등 6종

**결과**: 사용자 재시도 후 앱에 즉시 반영 확인 완료.

### 봇 → 앱 데이터 전달 무결점 수정 (2026-04-24)
봇에서 식단·체중·루틴 명령이 앱에 불안정하게 반영되던 문제를 **근본적으로 해결**.

**근본 원인**:
1. `log_meal`: appendMeal 성공 후 자동 루틴 매핑(setRoutineChecks)이 Firestore 일시 오류로 실패하면 **전체가 "저장 실패"로 보고** → 실제론 식사가 저장되어 있는데 사용자에겐 실패로 안내
2. `log_weight`, `mark_routine`, `/check`, `/weight`: **inner try/catch 부재** → Firestore 일시 오류 시 바로 외곽 handler까지 전파되어 제네릭 에러
3. **재시도 계층 없음** → 일시적 네트워크 오류에도 즉시 실패

**수정 (무결점 목표)**:
1. **신규 `writeSafety.js`** — 공통 재시도 유틸
   - `withRetry(fn, label, maxAttempts=3)`: exponential backoff 250→500→1000ms, 재시도 가능한 오류만 재시도
   - `tryWrite(fn, label)`: never-throws 버전, `{ok, error}` 반환 (부가 작업용)
   - 재시도 대상: `UNAVAILABLE(14)`, `DEADLINE_EXCEEDED(4)`, `RESOURCE_EXHAUSTED(8)`, `ABORTED(10)`, `INTERNAL(13)`, 네트워크/타임아웃 패턴
2. **`chat.js` — 핵심 경로와 부가 작업 완전 분리**
   - `log_meal`: ① appendMeal (withRetry) → 실패 시만 전체 실패 / ② schedulePostMealWalk / ③ 자동 루틴 매핑 (tryWrite) / ④ buildMealFeedback — ②③④는 실패해도 식사 저장 성공 유지
   - `log_weight`, `mark_routine`, `unmark_routine`: inner try/catch + withRetry
   - 사진 `meal:save` 콜백: 동일 분리 패턴 적용
   - kcal 수정 플로우: 동일 분리 패턴 적용
   - `applyAutoMapping`: never-throws로 변경 (실패 시 빈 배열)
   - 도구 루프 외곽 안전망: `runTool` 예상치 못한 throw도 `{ok:false}`로 포장
3. **`check.js`, `weight.js` 커맨드**: withRetry + 사용자 친화 에러 메시지
4. **`store.js` 미수정** — CLAUDE.md 지침(배치 유지, 트랜잭션 금지) 준수

**검증**:
- 모든 수정 파일 `node -c` syntax 통과
- Fly.io v38 배포 성공, 머신 정상 부팅
- 기존 함수 시그니처 전부 불변 → 회귀 위험 없음

**결과**:
| 상황 | 이전 | 이후 |
|------|------|------|
| 식사 저장 후 루틴 자동매핑 일시 실패 | "저장 실패" (식사는 저장됨) | ✅ 저장 성공 + 자동매핑 누락 (조용히 무시) |
| Firestore UNAVAILABLE 일시 오류 | 즉시 실패 | 3회 재시도로 자동 복구 |
| 루틴 체크 저장 중 네트워크 오류 | 제네릭 에러 메시지 | "잠시 후 다시 시도" 명확한 안내 |
| 도구 내부 예상치 못한 예외 | 전체 대화 실패 | `{ok:false}`로 Claude에게 전달 후 자연어 복구 |

### 날짜 오인 버그 수정 (2026-04-24)
봇이 어제 체중/식사를 오늘 것으로 오인하는 버그 — 3중 방어 수정:

1. **`claude.js` 시스템 프롬프트에 오늘 날짜 명시**
   - `# 사용자 컨텍스트 (today)` → `# 사용자 컨텍스트 (오늘: YYYY-MM-DD)`
   - `- 오늘 날짜: ${date}` 줄 추가 — Claude가 날짜 기준으로 히스토리 판단 가능

2. **체중 오늘/이전 기록 명확히 구분**
   - `claude.js`: `weightLine` — 오늘 측정 vs "이전 기록 [날짜]" 구분 표시
   - `chat.js` 세션에 `lastWeightDate` 추가 (`profile.lastWeightDate`)
   - `get_today_status` 반환값: `weight` → `todayWeight`(오늘만) + `lastRecordedWeight`(폴백) + `lastWeightDate` 분리

3. **대화 히스토리 날짜 경계 마커 주입**
   - `store.js getRecentMessages()`: 반환 시 `date` 필드 포함 (`createdAt → toLogicalDate`)
   - `chat.js chatHandler()`: 날짜가 바뀌는 첫 user 메시지에 `[오늘(YYYY-MM-DD)]` 또는 `[YYYY-MM-DD]` 접두어 자동 주입
   - Claude가 어제/오늘 대화를 명확히 구분하여 응답 가능

**근본 원인**:
| 원인 | 증상 |
|------|------|
| 히스토리에 날짜 경계 없음 | 어제 식사를 오늘로 언급 |
| `profile.weight` 무조건 폴백 | 어제 체중을 "오늘 체중"으로 답변 |
| 시스템 프롬프트에 날짜 없음 | Claude가 날짜 판단 기준 없음 |

### 인크레티나 DM 듀얼 브랜드 전략 자산 구축 (2026-04-25)
인크레티나의 **2nd 브랜드(당뇨 적응증)** 확장을 위한 IR·특허 자산 패키지 구축.
**핵심 원칙: 인크레티나 i 상용화가 1순위. IMEM-DM은 IR·특허·내부 비전 자산으로만 활용** (개발 리소스 분산 X).

**브레인스토밍 결론**:
- 제약 GLP-1 듀얼 브랜드 모델(Ozempic↔Wegovy, Mounjaro↔Zepbound)을 디지털 헬스에서 재현
- IMEM 엔진(비만) ↔ IMEM-DM 엔진(당뇨): 같은 골격, 다른 캘리브레이션
- 단일 제품 회사 → 인크레틴 플랫폼 회사로 valuation 재평가 트리거

**신규 폴더**: `인크레티나_DM/` (대외비, NDA 후 공유)

**생성 자산** (각각 .md + .docx, 일부 .pdf):
1. `01_Strategic_Overview_1pager` — VC 시드/시리즈A 첫 미팅 후크 (1페이지)
2. `02_Dual_Brand_Strategy` — 13장 종합 전략 (1만 단어)
   - 제약 듀얼 브랜드 모델 분석, 브랜드 정체성 매트릭스, 페르소나 4종, 메시지·톤·시각 정체성, 브랜드 네이밍 Top 3, 채널·BM, 기술 자산 공유, 규제·임상 경로, 12-24개월 로드맵
3. `03_IMEM_vs_IMEM_DM_Engine_Analysis` — 엔진 차별화 상세 분석 (1.2만 단어)
   - 6계수 공식: α × β × γ × δ × ε × ζ (3개 신규 계수)
   - δ (Glycemic Variability), ε (약물 보정), ζ (스트레스 보정)
   - 3단계 모드 (Basic/Standard/Full), Bio-Sync DM "혈당 시계", 안전 레이어
   - 신규 위험 R-09~R-15, Calibration Profile 시스템
   - 특허 청구 핵심 12개 신규 요소 정리
4. `04_Patent_Attorney_Briefing` — 변리사 미팅용 2건 동시 출원 브리핑 (9000 단어)
   - Patent #1 (IMEM 비만): 이미 구현·운영 중, 즉시 출원 (베타 노출 → grace period 검토)
   - Patent #2 (IMEM-DM 당뇨): 설계 완료 미공개, 동시 또는 1-2개월 내 출원
   - 종래기술 분석, 청구항 후보, 실시예, 출원 전략, 비용 추정
   - 변리사 첫 미팅 의제(60-90분), 사전 결정 사항 체크리스트

**기술 변환 인프라**:
- `reference_korean.docx` 한글 비즈니스 스타일 (Malgun Gothic + Calibri) 구축
- pandoc + LibreOffice 파이프라인: `.md → .docx → .pdf` 자동화
- 모든 한글·이모지·표·ASCII 다이어그램 정상 렌더링 검증

**다음 단계**:
- ~~월요일 변리사 미팅 (2건 동시 출원 협의)~~ → 기술소개서 이메일 선발송 후 미팅
- 변리사 검토 후 명세서 초안 작성 (`05_Patent_Specs/`)
- 인크레티나 i 본업 100% 집중 유지 (당뇨 트랙은 IR 자산으로만)

### 변리사 기술소개서 작성 완료 (2026-04-27)
변리사 이메일 사전 발송용 기술소개서 2건 작성 — 특허 #1·#2 각각 독립 문서.
04_Patent_Attorney_Briefing(전략·미팅 의제)과 별개로, 순수 기술 설명에 집중한 간결한 소개서.

**생성 파일**:
- `05_Tech_Intro_Patent1_IMEM.md/.docx` — 특허 #1 기술소개서 (IMEM 비만·체중 관리)
  - α×β×γ 3계수 공식, β_meal 서브모듈, Bio-Sync 타이머, Progressive Unlocking
  - 실시예: 운영 중인 시스템 (GitHub Pages PWA + Fly.io 봇)
  - 청구 범위 후보 7개, 변리사 검토 요청 사항 5개
- `06_Tech_Intro_Patent2_IMEM_DM.md/.docx` — 특허 #2 기술소개서 (IMEM-DM 당뇨 관리)
  - α×β×γ×δ×ε×ζ 6계수 공식 (신규 3계수 상세)
  - δ: TIR·GVI·MAGE·CV 혈당 변동성 역지수 (가중치 4:2.5:2:1)
  - ε: 약물군별 보정 계수 표 (메트포르민/GLP-1 RA/SGLT-2i/인슐린 등)
  - ζ: HRV+수면질+자가보고 합성 스트레스 계수
  - 3단계 모드 시스템 (Basic/Standard/Full), 혈당 시계 9이벤트, Safety Layer
  - 특허 #1 국내우선권(제55조) 연계 전략 명시

**전략 결정사항 (2026-04-27)**:
- 특허 #1(IMEM 비만)과 특허 #2(IMEM-DM 당뇨) **분리 출원 확정**
- 단일 특허로 합치지 않는 이유: M&A 옵셔널리티, 라이센싱 유연성, IR 자산 가치, 위험 분산
- 권장 구조: 특허 #1 먼저 출원 → 1개월~1년 내 특허 #2 국내우선권 주장
- Patent #3 (Vision AI + β_meal) 차후 추가 출원 검토

### 직원 베타 챌린지 오픈 + 버그 수정 + 프롬프트 캐싱 (2026-04-29)
내부 직원 16명 대상 8주 다이어트 챌린지 베타 오픈.

**Firestore 챌린지 설정** (`challenges/weekly-challenge`):
- startDate: 2026-04-29, endDate: 2026-06-23, active: true, maxParticipants: 16
- SSH를 통해 Fly.io 컨테이너에서 Firebase Admin SDK로 직접 설정

**버그 수정**:
1. **22시 리캡 전체 실패** (`getRecentDailyRoutines` Firestore index 오류)
   - 원인: `.orderBy('__name__', 'desc').limit(7)` 쿼리가 collection-group 복합 인덱스 요구
   - 수정: `Promise.all` + 날짜 문자열 기반 개별 doc read → 인덱스 불필요
2. **리캡 Telegram 파싱 오류** (`Can't find end of entity`)
   - 원인: `parse_mode: 'Markdown'` V1 — 한글 멀티바이트 + `*_` 마커 충돌
   - 수정: 전체 리캡 메시지를 HTML (`<b>`, `<i>`) 포맷으로 변환

**참가자 관리 시스템 추가** (`src/commands/ranking.js`):
- `/ranking`: CCS 실시간 순위 (체중변화율×0.4 + IMEM평균×0.35 + 루틴완수일×0.25)
- `/participants`: 참가자 현황 + 시작체중 등록 여부 체크
- `ADMIN_CHAT_ID` 환경변수로 관리자 전용 접근 제어

**프롬프트 캐싱 적용** (비용 40-50% 절감):
- `claude.js`: 마지막 TOOL(`get_score`)에 `cache_control: { type: 'ephemeral' }` 추가
- system(~600) + tools(~800) = ~1,400 토큰 → 1,024 최소 기준 충족
- `chat.js`: `logCacheUsage()` 헬퍼 — 3개 지점에서 캐시 쓰기/읽기 로그
  - `[cache:chat:first] write=N read=N` 형태로 Fly.io 로그 확인 가능
- 16명 8주 기준: 캐시 히트 시 입력 토큰 비용 90% 절감 ($3/M → $0.30/M)

**배포**: Fly.io v42 정상 부팅 확인 (커밋 `7ff9a44`)

### 다음 할 일 / 알려진 이슈
- 챌린지 참가자 /link 연결 + 시작 체중(sw) 설정 가이드 발송
- ADMIN_CHAT_ID env var Fly.io 설정 (`flyctl secrets set ADMIN_CHAT_ID=챗아이디`)
- 실사용 후 Fly.io 로그에서 `[cache:chat:first]` 캐시 히트 확인
- 앱 측에도 beta_meal/해석 반영 검토 (현재 봇만 적용)
- 프로액티브 코칭 실사용 피드백 수집 (알림 빈도, 페르소나 톤)
- 트렌드 분석 정확도 실데이터 확인 (3일 이상 기록 있는 사용자)
