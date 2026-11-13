# agent-run-inspector — 구현 계획서

> 상태: 초안 (2026-11-13). 입력: `docs/spec.md`(요구사항), `docs/mockup.html`(화면 시안), `brand-map.json`(레포 루트), `docs/demo.gif`.
> spec 과 이 계획이 다르면 **이 계획(사용자 결정 2026-11-13)** 이 우선이고, T38 에서 spec 을 맞춘다.

## 0. 확정된 결정 (2026-11-13)

1. 이름 `agent-run-inspector`, 짧은 명령 `ari`.
2. 공유: private 레포 + 팀원 collaborator 초대, `npx github:th-yong/agent-run-inspector` 로 실행. 공개·npm 배포는 나중.
3. 본문 미리보기 기본 표시, `--redact` / `--redact=strict` 로 가림.
4. 단가표: 공개 가격표에서 날짜(`asOf`)와 함께 `prices.json`, 사용자 덮어쓰기. Claude Code 는 기록의 보고값 우선.
5. 기록 폴더: `CLAUDE_CONFIG_DIR` · `~/.claude` · `CODEX_HOME` · `~/.codex` 기본, `--root` / `roots add` 로 추가. Orca 경로 하드코딩 금지.
6. teammate 세션은 1차에 "외부 세션" 노드로만.
7. 감시(watcher) 에이전트는 설정(이름 규칙)으로만, 기본 끔.
8. Orca 안에서 실행되면 Orca 내장 브라우저 탭으로 열기, 아니면 기본 브라우저(§4 확인 결과).
9. OpenAI 아이콘은 simple-icons 15.22.0 것을 유지. 공개 배포 전 브랜드 가이드 확인(메모만, T38 README 에 남김).
10. **화면 글 · CLI 도움말 · 콘솔 출력은 영어만**(1차, 한국어 선택 기능 없음). 문자열은 `web/strings.js`, `src/strings.js` 한 파일씩에 모으기만 하고 i18n 라이브러리는 넣지 않는다. 용어는 §1.1 용어표. spec·mockup 의 한국어는 내부 문서라 그대로 두고, 구현할 때 영어로 옮긴다.
11. **README 는 영어 기본 `README.md` + 한국어판 `README.ko.md`**. 두 파일 맨 위에 `English | 한국어` 서로 링크, 내용(설치·실행·옵션·보안·지원 범위·demo.gif) 같게 유지(T38 에서 테스트).

## 1. 기술 선택 (최소 의존)

| 항목 | 선택 | 이유 |
|---|---|---|
| 런타임 | Node, ESM(`"type": "module"`). 최소 버전은 §6-1 결정(추천 `>=22`) | `fs.watch` recursive(Linux 20+), `util.parseArgs`, `node:test` 내장. Node 20 은 2026-04 지원 종료 |
| 런타임 의존성 | **0** | `npx github:` 로 바로 실행, 공급망 위험 없음 |
| 개발 의존성 | **0** | 테스트 `node:test` + `node:assert`, 린트는 `node --check` 전 파일 + 금지 패턴 검사 스크립트(`scripts/lint.js`). eslint 는 넣지 않음 |
| 서버 | `node:http`, SSE 직접 구현 | 엔드포인트 7개 정도라 프레임워크 불필요 |
| 파일 감시 | `fs.watch(recursive)` + 200ms 묶음, 실패 시 2초 `stat` 폴링 | spec §6 |
| 웹 | **빌드 없음**: `web/index.html` + `web/*.js`(ES 모듈) + `web/app.css` | 시안이 이미 바닐라 JS(`render`, `cardHtml`, `drawEdges` …). 번들러·프레임워크 필요 없음 |
| 아이콘 | `scripts/build-icons.js` 가 simple-icons 15.22.0 에서 쓰는 것만 뽑아 `web/icons.js` 생성 → **생성물을 커밋** | `npx github:` 는 `prepare`/빌드 없이 돌아야 함 |
| 테스트 데이터 | 손으로 쓴 **합성 픽스처**(`test/fixtures/`), 실제 기록 복사 금지 | 보안·재현성 |

CSP 주의: spec §8 CSP(`default-src 'self'`)는 인라인 `<script>`·`<style>`·HTML 의 `style="…"` 속성을 막는다. 시안은 인라인 스크립트 1개 + 템플릿 문자열 안 `style="…"` 17곳(막대 `left/width`, 들여쓰기, 아이콘 색 변수). 이식할 때 스크립트는 모듈 파일로, 위치·폭은 렌더 뒤 `el.style.setProperty()`(CSSOM, CSP 허용) 또는 클래스로 바꾼다. **모든 UI 작업의 수용 기준에 "콘솔 CSP 위반 0".**

### 1.1 화면 용어표 (영어)

| 한국어(spec·mockup) | 영어(화면·CLI) |
|---|---|
| 진행 중 / 끝남 / 실패 / 취소 / 모름 | Running / Done / Failed / Cancelled / Unknown |
| 오케스트레이터 / 하위 에이전트 / 감시 | Orchestrator / Subagent / Watcher |
| 외부 세션(팀원) | External session |
| 모델 호출 / 도구 호출 / 오류 | Model call / Tool call / Error |
| 세션 / 에이전트 / 호출 | Session / Agent / Call |
| 그래프 / 타임라인 | Graph / Timeline |
| 합계 띠, 전체로 | Totals, Show all |
| 비용 근거: 보고 / 단가표 2026-11 / — , 일부 모름 | Reported / Priced (2026-11) / — , Partly unknown |
| 토큰: 입력 · 출력 · 캐시 읽기 · 캐시 쓰기 · 추론 | Input · Output · Cache read · Cache write · Reasoning |
| 가리기 / 엄격 가리기, (1,234자 숨김) | Redact / Strict redact, (1,234 chars hidden) |
| 끝난 에이전트 숨기기 | Hide finished agents |
| +n 이전 호출 / 새 호출 N개 ↓ / 아래에 에이전트 N개 (진행 중 M) ↓ | +n earlier calls / N new calls ↓ / N more agents below (M running) ↓ |
| 추정 연결 / 형식 모름 | Inferred link / Unknown format |
| 출처 필터 전체 · 오늘 · 7일 · 30일, 기간 넓히기 | All · Today · 7 days · 30 days, Widen range |
| 실행 기록을 찾지 못했어요 | No run logs found |
| 도구: (출처 배지 툴팁) | Tool: Claude Code / Codex CLI |

## 2. 영역

| 영역 | 범위 | 주요 폴더 |
|---|---|---|
| `core` | 패키지·CLI·설정·서버·보안·CI | `bin/`, `src/server/`, `src/config.js`, `.github/` |
| `adapter` | Claude Code·Codex 원본 → RunSpan, 픽스처 | `src/adapters/`, `test/fixtures/` |
| `model` | 공통 모델·분류 규칙·색인·집계·비용·상세·가리기 | `src/model/`, `src/index/`, `src/cost.js`, `prices.json` |
| `live` | tail·감시·SSE | `src/live/` |
| `web` | 화면 | `web/` |
| `integ` | Orca 열기·패키징·문서·종단 확인 | `src/open.js`, `README*.md` |

## 3. Git 작업 방식

- **main 은 늘 동작하는 상태.** 직접 커밋하지 않는다. 기존 main 의 docs 커밋 3개(`8d6c0fe`, `127ad0d`, `e201ffc`)는 이미 푸시돼 있으므로 그대로 둔다(히스토리 재작성 금지).
- **브랜치**: 작업마다 main 최신에서 분기, `<type>/<작업ID>-<짧은-이름>` (type: `feat` · `fix` · `chore` · `docs` · `test`). 아래 작업마다 적힌 브랜치 이름 그대로.
- **커밋**: Conventional Commits, **영어 제목**, 50자 안팎, 명령형(`feat(adapter): dedupe assistant lines by message.id`). 필요하면 본문에 이유. 한 커밋 = 한 논리 변경. 테스트와 구현은 같은 커밋 또는 `test:` → `feat:` 순.
  - scope 는 영역 이름(`core`·`adapter`·`model`·`live`·`web`·`integ`).
  - WIP·"fix typo" 류는 머지 전에 정리: `git commit --fixup <sha>` → `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main` (비대화식).
  - AI 공동 작성 표기(Co-Authored-By 등)는 넣지 않는다.
- **머지**: 브랜치를 최신 main 에 rebase → GitHub PR(제목 Conventional, 본문에 요약 · 테스트 방법 · 작업 ID) → CI 통과 → `gh pr merge --merge`(merge commit, no-ff) → 원격·로컬 브랜치 삭제. 결과는 semi-linear 그래프(main 위에 기능마다 한 덩어리). **squash 쓰지 않음.**
- **CI**: GitHub Actions `ci.yml` — push·PR 에서 (지원 최소 버전 · 현재 Active LTS, T01 에서 Node 릴리스 일정 확인) × ubuntu · macos, `npm test`(node:test) + `npm run lint`. T01 에 포함.
- **버전**: 의미 있는 묶음마다 SemVer 태그 + GitHub Release + `CHANGELOG.md`(Keep a Changelog). main 에 직접 커밋하지 않으므로 릴리스마다 `chore/release-vX.Y.Z` 브랜치(`package.json` version + CHANGELOG 의 Unreleased → 버전 절)를 PR 로 머지한 뒤 그 merge commit 에 태그.
  - `v0.1.0` — 서버 + 두 어댑터 + 실시간 API (T23 뒤, 화면 없이 API 로 확인 가능)
  - `v0.2.0` — 웹 UI 전체 (T36 뒤)
  - `v0.3.0` — Orca 열기 · 패키징 · 종단 확인 끝, 팀원 배포용 (T39 뒤)
- **역할**: 개발자는 브랜치에 커밋까지(로컬 수용 기준). 푸시·PR·CI 확인·머지·태그·Release·PR 캡처 첨부는 오케스트레이터. 그래서 각 작업 수용 기준은 "로컬"(개발자)과 "푸시 뒤"(오케스트레이터)로 나눴다. 화면 캡처는 개발자가 파일로 만들어 경로를 보고하고, 오케스트레이터가 PR 에 붙인다.
- 이 계획서 자체: 브랜치 `docs/plan`, 커밋 `docs: add implementation plan`.

## 4. Orca 열기 — 확인 결과 (2026-11-13, Orca 1.4.253)

계획 단계에서 실제로 시험했다(`127.0.0.1` 임의 포트 시험 서버 + `orca tab create`, 두 번).

- **감지**: Orca 터미널에는 `TERM_PROGRAM=Orca`, `ORCA_WORKTREE_ID`, `ORCA_CLI_BIN_DIR`(= `orca` 실행 파일 폴더)가 있다. 판단 규칙: `TERM_PROGRAM === 'Orca'` 또는 `ORCA_WORKTREE_ID` 존재 → `orca` 를 PATH 에서, 없으면 `$ORCA_CLI_BIN_DIR/orca` 에서 찾는다. `/Applications/...` 경로는 박지 않는다.
- **명령**: `orca tab create --url <url> --json` → `{"ok":true,"result":{"browserPageId":…}}`. 명령을 친 터미널의 worktree 브라우저에 새 탭으로 열리고, `orca tab list --json` 에서 `loaded:true`, 제목 정상. (`--split right` 로 옆에 나눠 열기도 가능)
- **실제로 열림**: 확인. 요청 `Host` 는 `127.0.0.1:<port>` 그대로 → Host 검사와 충돌 없음. 첫 시험에서 `?t=` → `Set-Cookie(HttpOnly; SameSite=Strict)` + 302 → 다음 요청에 쿠키 붙음 확인.
- **설계에 반영할 관찰**
  1. 내장 브라우저는 첫 주소를 **여러 번** 요청했다(두 번째 시험에서 `/?t=…` 2회 · `/` 2회, 모두 `sec-fetch-mode: navigate`; 첫 시험과 횟수가 달랐음). → 토큰은 1회용이 아니라 **실행 동안 유효**, 쿠키 없는 요청은 부작용 없는 401.
  2. 쿠키는 포트를 가리지 않는다. 두 번째 시험에서 첫 시험(다른 포트)이 남긴 같은 이름 쿠키가 첫 요청부터 붙어 왔다(Orca 기본 프로필은 쿠키가 남음). → 쿠키 이름 `ari_<port>` + 값을 실행 토큰과 비교, **이전 실행 쿠키는 401**. 실행마다 이름이 늘지 않고, 동시에 두 개 띄워도 서로 쿠키를 덮지 않는다.
  3. `/favicon.ico` 는 `sec-fetch-site: cross-site`, 쿠키 없이 왔다. → 파비콘은 `data:` URI 로 HTML 에 넣는다.
  4. 시험 탭은 바로 닫았다(`orca tab close --page …`).
- **대체 경로**: `orca` 를 못 찾음 · 종료 코드 ≠ 0 · `ok:false` · 5초 시간 초과 → 기본 브라우저(`open` / `xdg-open` / `cmd /c start`). 모두 `execFile` + 인자 배열, 셸 문자열 금지. `--no-open` 이면 아무것도 안 열고 주소만 출력.

## 5. 작업 목록

표기: **의존** = 먼저 머지돼야 할 작업(이 줄이 기준이고 §5.9 그림은 요약). 각 작업은 개발자 한 번(반나절 이하). 테스트는 모두 `node:test`(`npm test` 가 `test/**/*.test.js` 실행), 픽스처는 합성. 모든 작업의 로컬 공통 수용: `npm test` · `npm run lint` 통과.

### 5.1 골격 (core)

**T01 — 패키지 골격 · CI** · `core` · `chore/T01-scaffold` · 의존 없음
- 파일: `package.json`(name, `"type":"module"`, `engines.node`, `bin: { "agent-run-inspector": "bin/cli.js", "ari": "bin/cli.js" }`, `files`, scripts `test`/`lint`, 의존성 없음), `bin/cli.js`(진입점, `--version`), `scripts/lint.js`, `.github/workflows/ci.yml`, `.gitignore`, `.editorconfig`, `CHANGELOG.md`(Unreleased), `test/smoke.test.js`.
- `scripts/lint.js`: 모든 `.js` 에 `node --check` + 금지 패턴(`src/`·`web/` 에 외부 주소 리터럴 — 허용 목록만, `child_process.exec(` · `shell: true`, `web/` 의 `style="`, `strings.js` 밖 `web/`·`src/`·`bin/` 의 한글 리터럴).
- 테스트: `test/smoke.test.js`(`--version` 출력), `test/lint.test.js`(금지 패턴 샘플이 걸리는지).
- 로컬: `node bin/cli.js --version` 이 package 버전, dependencies/devDependencies 없음. 푸시 뒤: CI 4조합 통과.

**T02 — CLI 인자 · 설정 · 기록 폴더 찾기** · `core` · `feat/T02-cli-roots` · 의존 T01
- 파일: `bin/cli.js`, `src/config.js`, `src/roots.js`, `src/strings.js`(도움말·콘솔 문구, 영어), `test/cli.test.js`, `test/roots.test.js`.
- `util.parseArgs` 로 spec §9 옵션 전부(`--port --no-open --open --root(반복) --codex-root --source --since --redact[=strict] --prices --session --help`) + `roots add|list|remove`. 설정 파일 `~/.config/agent-run-inspector/config.json`(`XDG_CONFIG_HOME` 존중)에 `claudeRoots[] codexRoots[] watcherNamePatterns[] prices`.
- 기본 폴더: `$CLAUDE_CONFIG_DIR/projects` → 없으면 `~/.claude/projects`, `$CODEX_HOME/sessions` → `~/.codex/sessions`. 중복 제거는 `realpath` 기준.
- 로컬: 도움말·오류 문구 영어, 임시 HOME·환경변수로 각 경우 테스트, `roots add` 가 설정 파일만 바꾸고 기록 폴더는 건드리지 않음, 모르는 옵션은 도움말 + 종료 코드 2.

**T03 — 로컬 서버 · 접속 보안** · `core` · `feat/T03-server-security` · 의존 T01
- 파일: `src/server/http.js`, `src/server/auth.js`, `src/server/static.js`, `test/server-security.test.js`.
- 127.0.0.1 고정 바인딩(설정으로도 못 바꿈), 포트 0 기본 · `--port`. 실행마다 무작위 토큰(`crypto.randomBytes`). `?t=` → 쿠키 `ari_<port>`(HttpOnly, SameSite=Strict, Path=/, 값 = 토큰) + 302 로 주소에서 지움. 토큰은 실행 동안 재사용 가능(§4-1), 값이 다르면 401(§4-2).
- `Host` 가 `127.0.0.1:<port>` / `localhost:<port>` 아니면 거절, `Origin` 있으면 같은 출처만, CORS 헤더 없음, CSP · `nosniff` · `Referrer-Policy: no-referrer` 모든 응답에. 정적 파일은 `web/` 고정 목록만(경로 조립 없음), 파비콘은 `data:`.
- 로컬 테스트: 잘못된 Host(`evil.test:<port>`) 거절, 쿠키 없음 401, 값 다른 쿠키 401, `?t=` 두 번 요청해도 동작, 서버 두 개 동시 실행 시 서로 쿠키 안 덮음, `/../package.json`·`%2e%2e` 404, 응답 헤더 전부, 바인딩 주소가 127.0.0.1.

**T04 — 안전한 파일 접근 · fileId** · `core` · `feat/T04-safe-files` · 의존 T02
- 파일: `src/files.js`, `test/files.test.js`.
- 등록된 기록 폴더 안 파일만: `realpath` 후 폴더 안인지 확인, 밖을 가리키는 심볼릭 링크 거절. 파일은 불투명 `fileId`(색인 번호)로만 — API 는 기록 파일 경로를 받지도 내보내지도 않음. 읽기 전용(`'r'`), 쓰기 함수 없음. 줄 번호로 한 줄 다시 읽기(`readLineAt(fileId, line)`, 바이트 위치 색인).
- 로컬: 밖 링크 거절, 루트 자체가 링크면 실제 경로 기준 허용, 모르는 fileId 오류.

### 5.2 픽스처 · 모델

**T05 — Claude Code 합성 픽스처** · `adapter` · `test/T05-cc-fixtures` · 의존 T01
- 파일: `test/fixtures/claude-code/projects/<합성-프로젝트>/**`, `test/fixtures/README.md`(파일별로 덮는 경우 표), `test/fixtures-cc.test.js`.
- 덮을 것: 메인 + `subagents/agent-*.jsonl` + `.meta.json`(깊이 1·2), 같은 `message.id` 반복 줄(usage 반복), `api-request`/`requestRef`(있음·없음), `<synthetic>` 오류, `usage.iterations[advisor_message]`, `server_tool_use`, `is_error`·`interrupted`, `cost-state` 있음/없음, `teammate_spawned`, `compact_boundary`, `task-notification`, 진행 중(finished 없음), 사용자 중지, 모르는 `type`, 끝나지 않은 마지막 줄, 경로처럼 보이는 객체 키. 본문은 지어낸 짧은 문장 + 가리기 검사용 표식 문자열(`SECRET-MARKER-…`).
- 로컬: 모든 줄 JSON 파싱(끝나지 않은 줄은 의도된 예외로 표시), 실제 기록 복사 없음(표식 · 합성 id 형식 검사).

**T06 — Codex 합성 픽스처** · `adapter` · `test/T06-codex-fixtures` · 의존 T01
- 파일: `test/fixtures/codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, `test/fixtures/README.md`(Codex 절), `test/fixtures-codex.test.js`.
- 덮을 것: 구버전(0.4x, `info:null`) · 중간(0.107, `task_started/complete`·`turn_aborted`) · 0.166(`token_usage_record`, `item_completed`, `SubAgentActivity`, `cache_write_input_tokens`), 하위 rollout(`parent_thread_id` / `source.subagent.thread_spawn`, 다른 날짜 폴더 1개), 같은 시각 `spawn_agent` 2개, 첫 줄이 session_meta 아닌 파일, 짝 없는 call, 누적 token_count 중복.
- 로컬: T05 와 같은 검사.

**T07 — 구조 조사 스크립트** · `adapter` · `chore/T07-shape-scan` · 의존 T01
- 파일: `scripts/shape-scan.js`, `test/shape-scan.test.js`.
- `node scripts/shape-scan.js <root> [--source cc|codex] [--check <항목>]`: 실제 기록에서 **키 이름 · 타입 · 개수만** 집계(값·본문·경로 출력 금지, 경로처럼 보이는 키는 `<path-like>`). spec §11 확인용 항목(`--check depth2`, `teammate-keys`, `codex-item-id`, `codex-cached`, `codex-spawn-pairing`, `codex-info-null`, `cc-file-rotation`)을 숫자로 출력.
- 로컬: 픽스처에 돌려 출력에 표식 문자열·문자열 값이 없음.

**T08 — 공통 모델 · 분류 규칙** · `model` · `feat/T08-model-rules` · 의존 T01
- 파일: `src/model/types.js`(JSDoc: spec §4 `RunSpan`·`SessionSummary`·`Tokens`), `src/model/provider.js`, `src/model/tool-brand.js`, `src/model/tool-category.js`, `brand-map.json`(docs 에서 복사, 이후 원본은 이것), `test/model-rules.test.js`.
- provider 규칙(spec §4), toolBrand 규칙 1~4(MCP 서버명 · 이름 앞부분 · Bash 첫 단어, `VAR=값`·`sudo`·`env`·`time`·경로 건너뜀), 오류 호출은 브랜드 무시. 서버는 언제나 `brand-map.json` 기준 slug(`toolBrand`)와 `toolCategory` 를 **둘 다** 붙이고, 아이콘 유무는 화면이 판단한다(`web/icons.js` 에 slug 가 없으면 범주 기호, T24·T29).
- 로컬: 규칙마다 표 테스트, `microsoftazure`·`amazonwebservices`·`playwright` 도 slug + category 둘 다 붙음.

### 5.3 Claude Code 어댑터 (adapter)

공통: `src/adapters/claude-code/`. 입력은 (fileId, 줄 번호, 파싱된 줄) 흐름, 출력은 RunSpan 추가·갱신 목록. 줄 단위로 상태를 쌓는 **증분 파서**(T21 tail 이 같은 함수를 씀). 모르는 `type` 은 조용히 건너뜀. 각 작업 테스트에 "한 줄씩 넣은 결과 = 한 번에 넣은 결과" 포함.

**T09 — CC 세션 · LLM 호출** · `adapter` · `feat/T09-cc-session-llm` · 의존 T05, T08
- 파일: `src/adapters/claude-code/index.js`, `src/adapters/claude-code/llm.js`, `test/cc-llm.test.js`.
- session(제목 = 마지막 `ai-title`, project = cwd 마지막 폴더, branch), llm = `message.id` 로 묶기(usage 한 번만), start = `api-request.id == requestRef` 줄 · 못 찾으면 앞 줄 + `startApprox`, end = 같은 id 마지막 줄, 토큰 매핑(캐시 5m/1h 합, thinking → reasoning), `<synthetic>` → error·토큰 0, advisor iteration → 별도 llm 자식(그 모델), provider 붙이기.
- 로컬: 반복 줄 픽스처에서 토큰 한 번만, advisor 자식 모델 다름, 증분 = 일괄.

**T10 — CC 도구 호출** · `adapter` · `feat/T10-cc-tools` · 의존 T09
- 파일: `src/adapters/claude-code/tools.js`, `test/cc-tools.test.js`.
- `tool_use`/`server_tool_use` ↔ `tool_result`(tool_use_id), end = 결과 줄, status(`is_error` → error, `interrupted` → cancelled, 결과 없음 → running), Bash `command`, toolBrand·toolCategory, `compact_boundary` 표식, `turn_duration` 참고값.
- 로컬: 진행 중 도구 `end:null, status:'running'`, 오류·취소, Bash 첫 단어 브랜드.

**T11 — CC 하위 에이전트 · 팀원** · `adapter` · `feat/T11-cc-subagents` · 의존 T10, T07
- 파일: `src/adapters/claude-code/agents.js`, `test/cc-agents.test.js`.
- `Agent` tool_use → agent span(`agentType`, `task`, model, `spawnsAgentId`), `toolUseResult.agentId` / `meta.toolUseId` 로 하위 파일 연결, meta(`finished`, `stoppedByUser` → cancelled, `spawnDepth` → depth), running = finished 없음 + 최근 10분 쓰기, 끝 신호 `task-notification`. 하위 파일 안 `Agent` 도 같은 규칙(같은 `subagents/`, toolUseId 로 부모 — 가정). `teammate_spawned` → `external:true` agent 노드(이름·타입·시작만, 다른 세션과 잇지 않음).
- 검증: shape-scan `depth2`·`teammate-keys` 를 실제 기록에 돌려 **개수·키 이름만** 보고(spec §11-1, §11-2).
- 로컬: 깊이 1·2 트리 모양, 진행 중/끝남/중지, 외부 노드.

### 5.4 Codex 어댑터 (adapter)

**T12 — Codex 세션 · 도구 호출** · `adapter` · `feat/T12-codex-session-tools` · 의존 T06, T07, T08
- 파일: `src/adapters/codex/index.js`, `src/adapters/codex/tools.js`, `test/codex-tools.test.js`.
- `session_meta`(첫 줄 아니면 "Unknown format" 요약만), `turn_context.model`, 턴 띠(`task_started` → `task_complete`/`turn_aborted`), `function_call`·`custom_tool_call` ↔ `*_output`(call_id), 짝 없음 → running(최근)/unknown, 0.166 `item_completed` 로 시간·상태 덮기, 구버전 status `unknown`(본문 파싱 금지).
- 검증: shape-scan `codex-item-id`(spec §11-4) 보고.
- 로컬: 세 버전 각각, 형식 모름 파일이 오류 없이.

**T13 — Codex LLM · 토큰** · `adapter` · `feat/T13-codex-llm-tokens` · 의존 T12
- 파일: `src/adapters/codex/llm.js`, `test/codex-llm.test.js`.
- `token_count` 1개 = llm 1회, `last_token_usage`, 누적값이 앞과 같으면 버림, `info:null` 건너뜀, start = 앞 입력/도구 출력 줄(`startApprox`), 0.166 `token_usage_record` 있으면 그것만, `cache_write_input_tokens`, reasoning(`includedInOutput`).
- 검증: shape-scan `codex-cached`(`input ≥ cached` 성립 개수, §11-3), `codex-info-null`(§11-6). 결정을 코드 주석과 보고에.
- 로컬: 0.166 두 배 집계 없음, 중복 token_count 버림.

**T14 — Codex 하위 에이전트** · `adapter` · `feat/T14-codex-subagents` · 의존 T13
- 파일: `src/adapters/codex/agents.js`, `test/codex-agents.test.js`.
- 하위 rollout → agent span(depth, nickname → name, role → task), 연결: `SubAgentActivity.agent_thread_id` → 없으면 부모 `spawn_agent` 중 하위 `session_meta.timestamp` 직전 것(`startApprox`, 화면 "Inferred link"), 같은 시각 여러 개면 순서대로 하나씩 소비, end/running. threadId → 파일 색인으로 다른 날짜 폴더의 부모도 찾음.
- 검증: shape-scan `codex-spawn-pairing`(시각 차이 분포, §11-5).
- 로컬: 동시 2개가 각각 다른 호출에, 다른 날짜 폴더 부모.

### 5.5 색인 · 집계 · 비용 · 가리기 (model)

**T15 — 색인 · 세션 요약** · `model` · `feat/T15-index-scan` · 의존 T04, T11, T14
- 파일: `src/index/scan.js`, `src/index/summary.js`, `test/index.test.js`.
- 루트를 걸어 세션 파일 찾기(CC 메인 / Codex rollout, 하위 파일은 부모에 붙임), 목록용 빠른 요약(앞·뒤 몇 KB 만), `--since`·`--source` 필터, 루트 2개 이상이면 출처 폴더 표시 값. 세션 열 때 전체 파싱 + 메모리 캐시.
- 로컬: 픽스처 루트 요약 스냅샷, 합성 세션 1,000개(테스트가 임시 폴더에 생성) 목록 1초 이내.

**T16 — 세션 API** · `model` · `feat/T16-sessions-api` · 의존 T03, T15
- 파일: `src/server/api.js`, `test/api.test.js`.
- `GET /api/sessions`, `GET /api/sessions/:id`(spans + totals 자리), `GET /api/roots`(찾아본 폴더 — 빈 상태 표시용, 기록 파일 경로는 아님). 쿠키 필수, 불투명 id 만.
- 로컬: 픽스처 루트로 JSON 스냅샷, 응답에 기록 파일 경로 없음.

**T17 — 집계** · `model` · `feat/T17-totals` · 의존 T16
- 파일: `src/model/totals.js`, `test/totals.test.js`.
- span 트리 부분합 캐시(토큰·비용·모델 호출·도구 호출·오류·에이전트 수·시간), 끝난 llm 만, 에이전트 선택 시 하위 포함, 바뀐 span 의 조상만 다시 계산.
- 로컬: 손 계산 합계와 일치, 증분 = 전체 재계산.

**T18 — 비용 · 단가표** · `model` · `feat/T18-prices` · 의존 T17
- 파일: `prices.json`, `src/cost.js`, `test/cost.test.js`.
- `prices.json`: 모델 id → 입력·출력·캐시 읽기·캐시 쓰기(100만 토큰당 USD) + `asOf`·`source` 주소. **값은 이 작업에서 각 회사 공개 가격 페이지를 보고 채운다(계획서에 숫자 없음).** 대상: 픽스처·기록에 나오는 Anthropic·OpenAI 모델.
- 찾기: 정확히 → 가장 긴 접두어. 우선순위: CC `cost-state` 보고값(`reported`) → 단가표(`priced`) → `unknown`. 하위 에이전트는 언제나 단가표. `--prices` / 설정으로 병합 덮어쓰기. unknown 섞이면 `partial:true`.
- 로컬: 세 근거, 덮어쓰기, 접두어, 모르는 모델.

**T19 — 호출 상세 · 가리기** · `model` · `feat/T19-detail-redact` · 의존 T16
- 파일: `src/model/detail.js`, `src/model/redact.js`, `src/server/api.js`, `test/redact.test.js`.
- `GET /api/spans/:id/detail`: fileId·줄 번호로 원본 줄 다시 읽어 미리보기 최대 2KB(UTF-8 경계 보존), 오류 메시지, 원본 파일 **이름**과 줄 번호.
- 가리기(서버에서만): `--redact` → 미리보기는 `{hidden:true,length}`(화면이 "(1,234 chars hidden)"), 도구 입력은 키 이름만 + 경로처럼 보이는 키 숨김, task·command 숨김. `--redact=strict` → 제목·프로젝트·브랜치·cwd 도. `POST /api/redact`(쿠키 + 같은 출처), 화면 혼자 못 풂. 모든 응답 직렬화 지점에 한 함수로.
- 로컬: 모드별로 목록·세션·상세 응답에 `SECRET-MARKER` 가 없음(전수).

**T20 — 감시 에이전트 역할** · `model` · `feat/T20-watcher-role` · 의존 T15
- 파일: `src/model/roles.js`, `test/roles.test.js`.
- 설정 `watcherNamePatterns[]`(기본 빈 배열 = 끔) 에 이름이 맞는 agent → `role:'watcher'`, 최상위 → `orchestrator`, 나머지 `worker`.
- 로컬: 기본 설정 watcher 0, 패턴 설정 시 붙음.

### 5.6 실시간 (live)

**T21 — tail · 파일 감시** · `live` · `feat/T21-tail-watch` · 의존 T15
- 파일: `src/live/tail.js`, `src/live/watch.js`, `test/tail.test.js`, `test/watch.test.js`.
- 파일마다 (크기, mtime, inode, 읽은 위치, 끝나지 않은 조각). 바뀌면 위치부터, 크기 감소 또는 inode 변경이면 처음부터(spec §11-7 대비). `fs.watch(recursive)` + 200ms 묶음, 오류·미지원이면 2초 폴링(테스트는 폴링 강제 옵션). tail 대상은 최근 24시간 파일만. 새 하위 파일·하위 rollout 은 부모 세션에.
- 검증: shape-scan `cc-file-rotation`(압축 전후 파일이 바뀌는지, spec §11-7) 보고.
- 로컬: 반 줄씩 써도 한 줄, 잘림, 교체, 새 파일, 폴링 모드(임시 폴더).

**T22 — SSE 스트림** · `live` · `feat/T22-sse` · 의존 T17, T19, T21
- 파일: `src/live/sse.js`, `src/server/api.js`, `test/sse.test.js`.
- `GET /api/sessions/stream`(`session`), `GET /api/sessions/:id/stream`(`span` · `totals`), `seq` 단조 증가 = `id:`, `Last-Event-ID` 이어 받기(세션별 버퍼), 버퍼 밖이면 `resync`, 15초 `: ping`, 끊기면 정리. 가리기 적용.
- 로컬: 픽스처 복사본에 줄 덧붙이면 1초 안에 이벤트, 이어 받기, resync, 가리기 모드 스트림에 표식 없음.

**T23 — 서버 조립 · 종료 처리** · `core` · `feat/T23-serve` · 의존 T18, T20, T22
- 파일: `bin/cli.js`, `src/app.js`, `test/serve.test.js`.
- 설정 → 색인 → 서버 → 감시 → 주소 출력(`http://127.0.0.1:<port>/?t=<token>`), `--session <id>` 면 그 세션 주소. Ctrl+C 에 감시·SSE 정리. 콘솔엔 주소·오류 종류만.
- 로컬: 자식 프로세스로 띄워 쿠키 흐름·API·SSE 시나리오, 콘솔 출력에 표식 없음, SIGINT 로 깨끗이 종료. 푸시 뒤: `chore/release-v0.1.0` → **`v0.1.0`**.

### 5.7 웹 UI (web)

공통 로컬 수용(모든 web 작업): **화면 글은 영어**(§1.1, 문자열은 `web/strings.js` 에서만 — lint 가 다른 파일 한글 검사), 1440 · 390 폭 × 라이트 · 다크 캡처 파일(시안과 비교, 경로 보고), 콘솔 CSP 위반 0 · 오류 0, `prefers-reduced-motion` 에서 움직임 없음, 외부 요청 0(네트워크 기록). 순수 함수(포맷·배치·상태 병합)는 `node:test`. 순수 함수가 없는 작업(T29·T30·T31·T34·T36)의 테스트는 이 캡처 + 콘솔 확인이다. 화면 확인은 `aside` 로 픽스처 루트 서버를 열어서. 푸시 뒤: 오케스트레이터가 캡처를 PR 에 첨부.

**T24 — 브랜드 아이콘 생성** · `web` · `feat/T24-icons` · 의존 T08
- 파일: `scripts/build-icons.js`, `web/icons.js`(생성물, 커밋), `test/icons.test.js`.
- 스크립트: 임시 폴더에 `npm pack simple-icons@15.22.0`(의존성으로 넣지 않음) → `brand-map.json` slug 만 path·hex 추출 → spec §12 색 규칙(3:1, 채도 ≥0.25 면 밝기 최대 0.25 이동, 아니면 글자색, OpenAI 는 두 테마 글자색). 생성물 머리에 "generated, do not edit" + 버전 + CC0. `hasIcon(slug)` 내보냄.
- 로컬: azure·aws·playwright 는 생성물에 없음, 모든 색 대비 3:1 이상(계산 테스트), 두 번 돌려도 같은 결과.

**T25 — 화면 뼈대 · 상태 · 테마** · `web` · `feat/T25-web-shell` · 의존 T23
- 파일: `web/index.html`, `web/app.css`, `web/app.js`, `web/strings.js`, `web/api.js`(fetch + SSE, seq 병합, resync), `web/state.js`(주소 `?s ?tab ?sel ?open ?gsel ?gopen ?theme`), `web/format.js`(1.2k/3.4M, $0.0123, 820ms/12.4s/3m 05s), `src/server/static.js`(목록 추가), `test/web-format.test.js`, `test/web-state.test.js`.
- 시안 CSS 토큰(라이트·다크), 시스템 설정 + 테마 단추, 2열(목록 320px + 실행 화면) / ≤760px 한 번에 하나.
- 로컬: 공통 + 새로고침 시 주소 상태 복원.

**T26 — 세션 목록 · 빈 상태** · `web` · `feat/T26-session-list` · 의존 T25, T24
- 파일: `web/session-list.js`, `web/app.css`, `test/web-session-filter.test.js`.
- 출처 배지(툴팁 "Tool: …"), 제목·프로젝트·시작·길이·에이전트 수·토큰·상태·제공사 아이콘, 진행 중 고정 + 점 깜빡임, 출처·기간 필터, 제목·프로젝트 검색, 출처 폴더 표시, 빈 상태(찾아본 폴더 + `--root` 안내, "Widen range"), 목록 SSE.
- 로컬: 공통 + 필터·검색 조합 테스트.

**T27 — 실행 머리 · 합계 띠 · 탭** · `web` · `feat/T27-run-header` · 의존 T26
- 파일: `web/run-header.js`, `web/app.css`, `test/web-roll.test.js`(굴림 보간 함수).
- 제목, "N agents · M running · $cost", 프로젝트·모델, 합계 띠(시간·비용과 근거 `Reported`/`Priced (2026-11)`/`—`·"Partly unknown"·토큰·모델 호출·도구 호출·오류), 범위 전환("Show all"), 숫자 굴림 250ms, Graph | Timeline 탭(`?tab=`), 좁은 폭 2줄.
- 로컬: 공통.

**T28 — 그래프 배치 계산** · `web` · `feat/T28-graph-layout` · 의존 T25
- 파일: `web/graph-layout.js`(순수 함수: span 트리 + 폭 → 카드 좌표 · 연결선 path), `test/graph-layout.test.js`.
- spec §3.1: 단계별 줄, 가운데 정렬, 18 · 40, 넘치면 줄바꿈(가로 스크롤 없음), 꺾는 높이 = 자식 줄 위 틈, 손자 일반 카드, 감시 카드는 오케스트레이터 옆, 보이는 카드 > 8 이면 216px · 설명 숨김 · 최근 3개, 상세 칸 열리면 폭 −360, 접힌 카드 높이, ≤760 이면 세로 목록 순서(깊이 우선, 부모 → 감시 → 자식).
- 로컬: 하위 1·4·12개, 손자, 감시, 상세 열림, 좁은 폭 스냅샷 + "가로선이 카드와 겹치지 않음".

**T29 — 그래프 카드 (정적)** · `web` · `feat/T29-graph-cards` · 의존 T27, T28, T20
- 파일: `web/graph.js`, `web/card.js`, `web/app.css`.
- 카드(제공사 로고 · 이름 · 모델 · 상태 배지 / 과제 / 최근 호출 5개 · 브랜드·범주 아이콘 · 막대 · 시간 · 진행 중 흐르는 막대 / 비용·시간 · 호출 N), "+n earlier calls", 선 색(진행 중·끝남·실패), 감시 카드 점선, 외부 세션 노드, 끝난 카드 한 줄 모양 + 눌러 펼침, "Hide finished agents"(진행 중 하위 있으면 안 숨김), "N more agents below (M running) ↓".
- 로컬: 공통(픽스처 세션 정적 렌더).

**T30 — 그래프 실시간 움직임** · `web` · `feat/T30-graph-motion` · 의존 T29
- 파일: `web/graph.js`, `web/card.js`, `scripts/replay-fixture.js`(픽스처를 임시 폴더로 복사해 줄을 시간차로 덧붙임 — 픽스처만 대상).
- 새 호출 줄 추가·5개 넘으면 가장 오래된 줄 접힘, 끝나면 1.6초 뒤 카드 접힘, 새 카드 떠오름 · 선 자라남, 150–300ms, reduced-motion 이면 최종 상태 바로.
- 로컬: 공통 + 재생 스크립트로 데모 GIF 같은 흐름.

**T31 — 그래프 상세 칸 · 호출 상세 부품** · `web` · `feat/T31-graph-detail` · 의존 T29, T19
- 파일: `web/agent-panel.js`, `web/call-detail.js`(호출 상세 부품 — T34 가 재사용), `web/app.css`.
- 카드 누르면 합계 범위 전환 + 오른쪽 360px 상세 칸(합계 + 전체 호출 최신 먼저), 호출 누르면 아래에 호출 상세(종류·이름·시작·끝·시간·토큰 5종·비용과 근거·상태·오류·입력/출력 미리보기 — 가리기면 길이만·원본 파일 이름과 줄 번호 + 복사), `?gsel&gopen`. 좁은 폭에서는 목록 아래.
- 로컬: 공통 + 가리기 모드 상세에 표식 없음.

**T32 — 타임라인 (줄 · 막대)** · `web` · `feat/T32-timeline-rows` · 의존 T27
- 파일: `web/timeline.js`, `web/timeline-scale.js`(순수: 시간 → 위치, 눈금), `test/timeline-scale.test.js`.
- 왼쪽 트리(360px) + 시간축(눈금·자), 에이전트 줄의 호출 막대(LLM 꽉 채움, 도구 옅은 채움 + 테두리, 오류 빨강 + 위 표식, 진행 중 끝 열림), 앞 글자 ◆ ▪ ▲, 좁은 폭은 이름 아래 얇은 막대, 위치는 CSSOM.
- 로컬: 공통.

**T33 — 타임라인 (묶음 · 접기 · 표식)** · `web` · `feat/T33-timeline-groups` · 의존 T32
- 파일: `web/timeline.js`, `web/timeline-group.js`(순수: 연속 같은 도구 접기), `test/timeline-group.test.js`.
- 펼치면 하위 먼저 → "Calls N (model · tool · error)" 묶음 → 호출 줄, >200 이면 같은 도구 연속 접기, Codex 턴 띠, 압축 세로 표식.
- 로컬: 공통 + 호출 1,000개 합성 세션에서 펼침·스크롤 끊김 없음.

**T34 — 타임라인 호출 상세 펼침** · `web` · `feat/T34-call-detail` · 의존 T33, T31
- 파일: `web/timeline.js`(T31 의 `web/call-detail.js` 재사용).
- 호출 줄 누르면 바로 아래 펼침, `?s&sel&open`, 새로고침·같은 기계 공유 시 복원.
- 로컬: 공통.

**T35 — 실시간 화면 반영** · `web` · `feat/T35-live-ui` · 의존 T30, T34
- 파일: `web/app.js`, `web/api.js`, `web/timeline.js`, `test/web-merge.test.js`(seq 병합).
- 두 탭에 SSE 변경분, 위로 스크롤 중이면 자동 스크롤 없이 "N new calls ↓", 재연결 표시, resync 시 전체 다시.
- 로컬: 재생 스크립트로 새 호출 1초 안(두 탭 각각), 스크롤 위치 유지.

**T36 — 가리기 토글 · 다크 · 390 마무리** · `web` · `feat/T36-redact-dark-narrow` · 의존 T35
- 파일: `web/redact-toggle.js`, `web/app.css`, `web/graph.js`.
- 오른쪽 위 Redact 토글(`POST /api/redact`, 서버 상태 표시), Strict 표시, 다크 전 화면 점검, 390 폭 그래프 → 세로 목록(18px 들여쓰기 + └, 선 SVG 없음), 색 외 구분(글자·채움·표식), 키보드 포커스.
- 로컬: 공통 + 390 폭 모든 화면 가로 스크롤 없음. 푸시 뒤: `chore/release-v0.2.0` → **`v0.2.0`**.

### 5.8 Orca 열기 · 패키징 · 종단 확인 (integ)

**T37 — 브라우저 열기 (Orca 우선)** · `integ` · `feat/T37-open-orca` · 의존 T23
- 파일: `src/open.js`, `bin/cli.js`, `test/open.test.js`.
- §4 그대로: 감지 → `orca`(PATH → `$ORCA_CLI_BIN_DIR`) `tab create --url <u> --json`, `execFile` 인자 배열, 5초 시간 초과, `ok:true` 확인, 실패면 기본 브라우저. `--no-open`, `--open=orca|browser|none`.
- 로컬: `execFile` 주입 단위 테스트(성공·ok:false·없음·시간 초과·비 Orca), Orca 안에서 실제로 탭이 열리고 쿠키 흐름이 되는지 + §4 관찰 1~3 재확인(결과 보고, 시험 탭은 닫음).

**T38 — 패키징 · README(영·한) · 문서 맞추기** · `integ` · `docs/T38-packaging-readme` · 의존 T36, T37
- 파일: `README.md`(영어, 기본), `README.ko.md`(한국어), `test/readme-parity.test.js`, `package.json`, `docs/spec.md`.
- `package.json` `files`(bin, src, web, prices.json, brand-map.json, README 두 개, LICENSE 있으면). README 두 파일 맨 위 `English | 한국어` 서로 링크, 같은 내용: 한 줄 설명, `docs/demo.gif`, 설치·실행(collaborator 초대 수락 → `gh auth login` 또는 git 자격 증명 → `npx github:th-yong/agent-run-inspector`), `ari` 별칭(`npm i -g github:…` 뒤), 옵션 표, 보안 원칙, 가리기, 지원 범위(Claude Code · Codex CLI 버전대, 넣지 않는 것), 단가표 근거·덮어쓰기, 상표 고지 · OpenAI 아이콘 메모, Orca 열기. spec 맞추기(§0·§2·§9 실행 명령, 화면 글 영어, Node 최소 버전).
- 로컬:
  - **두 README 의 절 구성이 같다** — `test/readme-parity.test.js` 가 머리글(`#`~`###`) 개수·단계 순서, 코드 블록 개수, 이미지(`demo.gif`)·`npx …` 명령 줄이 같은지 비교(CI 에서도 돌아 한쪽만 바뀌면 실패), 맨 위 언어 링크가 서로를 가리킴.
  - **깨끗한 환경**: 체크아웃 밖 빈 임시 폴더 + 빈 npm 캐시(`--cache <임시>`)에서 `npx git+file://<레포>#<브랜치> --no-open` 과 `npm pack` 결과 tarball 로 각각 뜸(빌드·prepare 없음). tarball 에 test·fixtures·docs·scripts 없음. `npx` 가 bin 2개 중 패키지 이름과 같은 `agent-run-inspector` 를 실행하는지 확인.
- 푸시 뒤(오케스트레이터): 빈 환경에서 `npx github:th-yong/agent-run-inspector#<브랜치> --no-open` 이 뜨는지.

**T39 — 실제 기록 종단 확인** · `integ` · `test/T39-e2e-real` · 의존 T38
- 파일: `scripts/e2e-check.js`(API 로 개수·시간·통과 여부만 집계), 결과는 보고에만(커밋하지 않음).
- 이 기계의 실제 기록(모든 기본 루트 + `roots add` 한 폴더)으로: 목록 개수, 세션 열기 시간, 진행 중 세션 실시간 반영(새 호출 1초 안), CC·Codex 각 버전대 세션이 오류 없이 열림, 비용 근거 분포, `--redact`·`strict`, Orca 탭 열기.
- 보고는 **개수·시간·통과 여부만**(본문·제목·경로 옮기지 않음). 문제는 `fix/T39-…` 브랜치로 따로.
- 푸시 뒤: CHANGELOG 정리 → `chore/release-v0.3.0` → **`v0.3.0` + GitHub Release**(팀원 배포용).

**T40 — (선택) Claude Code `/inspect` 플러그인** · `integ` · `feat/T40-cc-plugin` · 의존 T39 · **§6-2 결정 후**
- 파일: `.claude-plugin/plugin.json`, `commands/inspect.md`, `test/plugin-manifest.test.js`.
- `npx -y github:th-yong/agent-run-inspector --session $CLAUDE_SESSION_ID`. 부를 때마다 서버가 새로 떠 남는 문제 → 이미 떠 있는 서버 재사용(설정 폴더에 포트·pid 기록, 살아 있으면 그 주소로 열기) 또는 마지막 화면이 닫히고 N분 뒤 종료 중 하나를 정한다.

### 5.9 의존 요약 · 병렬

```
T01 ─┬─ T02 ─ T04 ───────────────────────────┐
     ├─ T03 ─────────────────────────────┐   │
     ├─ T05 ─ T09 ─ T10 ─ T11 ───────────┼───┼─ T15 ─┬─ T16 ─┬─ T17 ─ T18 ─┐
     ├─ T06 ─ T12 ─ T13 ─ T14 ───────────┼───┘       │       └─ T19 ───────┤
     ├─ T07 (T11·T12 에 필요)             │           ├─ T20 ───────────────┤
     └─ T08 ─ T24                         └ (T16)     └─ T21 ─ T22 ─────────┴─ T23 ─┬─ T25 ─ T26 ─ T27 ─┬─ T29 ─ T30 ─────┐
                                                                                    │       └─ T28 ────┘   └─ T31 ─┐       │
                                                                                    │                  T32 ─ T33 ─ T34 ─ T35 ─ T36 ─┐
                                                                                    └─ T37 ──────────────────────────────────────── T38 ─ T39 ─ (T40)
```
- 동시에 돌릴 수 있는 묶음: {T02, T03, T05, T06, T07, T08} → {CC T09–T11 · Codex T12–T14 · T24} → {T16–T19, T20, T21} → T23 뒤 {T26–T27 · T28}, {T29–T31 · T32–T33}, T37 은 T23 뒤 언제든.
- 같은 파일을 만지는 작업(`src/server/api.js`: T16·T19·T22, `bin/cli.js`: T02·T23·T37, `web/timeline.js`: T32–T35, `web/graph.js`: T29·T30·T36)은 순서대로 머지하고 뒤 작업은 rebase 후 시작.

## 6. 결정 (2026-11-13, 사용자 부재 중 추천안으로 확정 — 바꾸려면 알려 주면 됨)

1. **Node 최소 버전 (T01 시작 전 필요)**: spec 은 ≥20 이지만 Node 20 은 2026-04 지원 종료. 추천: `engines >=22`(지원 중인 가장 오래된 LTS), CI 는 22 + 그때의 Active LTS(T01 에서 확인).
2. **`/inspect` 플러그인(T40)**: spec §9 에는 있고 브리프 순서에는 없다. 추천: v0.3.0 뒤 선택 작업, 서버 재사용 방식으로.
3. **private 레포 main 보호 규칙**: GitHub 무료 플랜 private 레포는 브랜치 보호(필수 CI)를 못 쓸 수 있다. 추천: 못 쓰면 "CI 통과 후 머지" 를 오케스트레이터 규칙으로만.
4. **Orca 탭 위치**: 확인한 기본 동작은 "명령을 친 터미널의 worktree 브라우저에 새 탭". 추천: 새 탭 그대로, `--split right` 는 넣지 않음.
