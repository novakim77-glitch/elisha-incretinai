# ELISHA / IncretinA i — Project Context

## What This Is
ELISHA is a digital health division within MIRACULUS (CRO, ₩35억/year revenue).
Core product: **IncretinA i (인크레티나 아이)** — an incretin-based weight management platform powered by **IMEM™** (Incretin Metabolic Efficiency Model).
Two tracks: **Synca** (consumer wellness, δ=1.0) and **SyncRx** (prescription DTx, δ<1.0).

## Core Formula
```
ΔWeight = f(BMR) × [α(Timing) × β(Sequence) × γ(Sensitivity)] × Compliance
β = β_pre(preload) × β_seq(meal sequence)
```
- **α** — meal timing vs circadian rhythm (golden time = sunrise~sunset)
- **β_pre** — preload: protein+fat 15-30min before meals → L-cell GLP-1 secretion
- **β_seq** — sequence: vegetables → protein → carbs + post-meal walk
- **γ** — incretin sensitivity (exercise, gut health, diabetes type)
- **δ** — drug history modifier (SyncRx only). δ=1.0 → Synca, δ<1.0 → SyncRx

## δ Modifier (SyncRx Off-Ramp)
```
δ = δ₁(drug type) × δ₂(duration) × δ₃(peak dose)
γ_offramp = γ_base × δ × (1 + recovery_bonus)
recovery_bonus = min((1/δ - 1), t × recovery_rate)
```

## Platform Architecture (3 pillars — NO feature overlap)
```
IncretinA i App = 나의 도구 (개인 대시보드)
├── IMEM 대시보드 (α·β·γ 실시간)
├── Bio-Sync Timer (골든타임 카운트다운)
├── 체중 기록 & 추이
└── 10단계 루틴 체크리스트

Telegram Bot = 나의 코치 (1:1 코칭)
├── 알림/리마인더 (프리로드, 골든타임, 식후 산책)
├── AI 코칭 대화 (Claude API + IMEM Context v2.0)
├── 프리로드 완료 체크 & β_pre 기록
├── 11 commands: /start /check /weight /score /golden /predict /report /persona /link /preload /challenge
└── Hybrid router: rule-based (timers) + LLM (Claude + IMEM Context)

Telegram Mini App = 우리의 광장 (콘텐츠 + 커뮤니티)
├── 📋 인크레틴 라이프 게시판 (6 categories, 97 contents)
├── 📸 사용자 인증 피드 & 레시피 공유
├── 🏆 챌린지 & 리더보드
└── 👥 커뮤니티 Q&A
```
RULE: App features NEVER go in Mini App. Mini App handles what the app can't: social, content discovery, community.

## Mini App Content Categories (IMEM-connected)
```
📋 인크레틴 라이프 게시판
├── 🥜 프리로드 (β_pre)      — 30종 ✅ DONE
├── 🥗 본식 순서 (β_seq)     — 20종 planned (순서 식단 + 외식 가이드)
├── 🏃 운동 가이드 (γ)       — 15종 planned (루틴 타이밍 매트릭스)
├── 💊 건기식 가이드 (γ+β)   — 12종 planned (복용 타이밍 매트릭스)
├── ☀️ 생체리듬 (α)          — 10종 planned (수면/햇빛/야식)
└── 🔬 인크레틴 과학          — 10종 planned (카드 뉴스/숏폼)
```
Every content card MUST have: ① IMEM coefficient tag ② Routine timing ③ Scientific evidence

## "천연 위고비" = β_pre
SNS trend "natural Wegovy" (eggs+olive oil before meals) is exactly IMEM's β_pre.
This is Synca's GTM hook. Preload recipes are the content foundation.
Products: Synca PreLoad™ shake (₩39K/mo), γ-Boost™ probiotic (₩49K/mo), Morning Ritual™ tea (₩29K/mo)

## Brand
- Colors: Deep Teal #1A6B68, Midnight Navy #0C2340, Precision Gold #C49A3C
- Fonts: Outfit (display), Inter (body), JetBrains Mono (data)
- Architecture: ELISHA (corp) → IMEM™ (tech) → Synca (wellness) / SyncRx (DTx)

## Tech Stack
- **App**: HTML/JS + Firebase Auth + Firestore (v3.1)
- **Bot**: Node.js + grammY + Firebase + Claude API (Sonnet)
- **Mini App**: React + Telegram WebApp API + shared Firestore
- **Shared module**: `packages/imem-core/` (7 source files, 28 tests)

## imem-core Module
```
packages/imem-core/src/
├── index.js → alpha.js → beta.js → gamma.js (δ-aware)
├── delta.js → biosync.js → score.js → prediction.js → constants.js
```
Key: `if (!drugHistory) δ=1.0` (Synca) `else δ<1.0` (SyncRx)

## Business Strategy
- ELISHA stays WITHIN MIRACULUS (CRO ₩35억 = valuation floor)
- 3-phase funding: ₩5~8억 (TIPS) → ₩10~15억 (strategic) → ₩20~30億 (Series A)
- Founder retains 77.9% after ₩44억 raised
- Spin-off trigger: MAU 50K or SyncRx IND filing

## Patent Portfolio
- **P-01** δ Modifier (specification drafted, 10 claims) — READY TO FILE
- **P-02** Off-Ramp System, **P-03** IMEM Base — design complete
- P-04~P-08: Bio-Sync, AI Coaching, Dual-Mode, App-Bot Sync, Appetite Prediction

## Key Documents (in docs/)
- `SESSION_LOG_IncretinAi.md` — full development log
- `MIRACULUS_Business_Strategy.docx` — 12ch strategy (742 para)
- `Synca_NaturalGLP1_Preload.docx` — preload research + revenue model
- `Synca_Preload_Recipes.docx` — 30 recipes (512 para)
- `Synca_TelegramBot_v2.docx` — bot v2.0 preload integration
- `IncretinAi_MiniApp_Content.docx` — Mini App content architecture (528 para)
- `P01_Delta_Modifier_Patent.docx` — patent specification

## Coding Conventions
- Firebase paths: `users/{uid}`, `users/{uid}/dailyRoutines/{date}`, `users/{uid}/preloadLogs/{date}`
- imem-core: pure JS, no deps, all functions return numbers. Tests: `node test/test.js`
- pptxgenjs: NO `#` in hex colors, use `RECTANGLE` not `ROUNDED_RECTANGLE`

## Current Priorities
1. P-01 patent filing
2. Telegram bot v1.0 MVP → v2.0 preload integration
3. Mini App content: fill β_seq (본식 순서) category next
4. TIPS application
5. "천연 위고비" content campaign for GTM
