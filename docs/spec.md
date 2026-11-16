# agent-run-inspector — 요구사항

> 상태: v0.2.0 구현에 맞춰 정리 (2026-11-13). 화면 글과 CLI 도움말은 영어, 사용 설명은 `README.md`(영어)·`README.ko.md`(한국어). 화면 시안은 `docs/mockup.html`.
> 이 문서의 형식 조사는 이 기계의 실제 기록 파일을 **구조(키·타입·개수)만** 집계해서 얻었다. 메시지 본문은 옮기지 않았다.

## 0. 한 줄 요약

Claude Code 와 Codex CLI 가 이미 디스크에 남기는 실행 기록(JSONL)을 읽어, 오케스트레이터 → 하위 에이전트 → 호출(LLM·도구) 관계를 **로컬 브라우저에서 실시간 트리 + 막대 타임라인**으로 보여 주는 읽기 전용 도구. `npx github:th-yong/agent-run-inspector` 한 줄로 뜬다(공개 뒤 `npx agent-run-inspector`).

## 1. 목표 / 비목표

목표
- 지금 돌고 있는(또는 끝난) 세션에서 누가 누구를 불렀는지, 각 에이전트가 어떤 호출을 얼마나 오래·얼마나 많은 토큰으로 했는지, 어디서 실패했는지를 한 화면에서 본다.
- Claude Code 와 Codex CLI 둘 다. 에이전트 쪽에 아무것도 설치하지 않는다(훅·프록시 없음, 기록 파일만 읽음).
- 팀원이 설정 없이 `npx` 한 줄로 쓴다.

비목표는 §10 "넣지 않는 것".

## 2. 사용자 흐름

1. **실행**: 터미널에서 `npx github:th-yong/agent-run-inspector` (`/inspect` 슬래시 명령은 v0.3.0 뒤로 미룸).
   - 기록 폴더를 찾고(§5.1) 색인을 만든 뒤 `http://127.0.0.1:<port>/?t=<token>` 을 출력하고 연다: Orca 안이면 Orca 새 탭, 아니면 기본 브라우저(`--open=auto|orca|browser|none`, `--no-open` 으로 끔).
2. **세션 목록**(왼쪽 칸, 좁은 폭에서는 첫 화면)
   - 최근 수정순. 각 줄: 출처 배지(Claude Code / Codex), 제목(있으면), 프로젝트 이름(cwd 의 마지막 폴더), 시작 시각, 길이, 에이전트 수, 토큰 합계, 상태(진행 중 / 끝남 / 오류 있음).
   - 위쪽에 출처 필터(전체 · Claude Code · Codex), 기간(오늘 · 7일 · 30일), 검색(제목·프로젝트 이름만, 본문 검색 없음).
   - 진행 중인 세션은 맨 위에 고정, 점 하나가 천천히 깜빡인다.
3. **실행 화면**(세션을 고르면)
   - 머리: 세션 제목, 오른쪽에 "에이전트 N · 진행 중 M · $비용", 그 아래 프로젝트·모델들, 합계 띠(시간, 비용, 토큰, 모델 호출 수, 도구 호출 수, 오류 수). 합계 범위는 "실행 전체" 가 기본이고, 에이전트를 고르면 그 에이전트 + 하위 에이전트 합계로 바뀐다("전체로" 단추로 되돌림). 숫자가 바뀌면 250ms 동안 굴러 올라간다.
   - 본문은 탭 두 개: **그래프**(기본) | **타임라인**. 탭은 주소 `?tab=` 에 남는다.
3-1. **그래프 탭**(기본)
   - 에이전트 하나 = 카드 하나. 오케스트레이터 카드가 맨 위 가운데, 하위 에이전트 카드가 아래 단계로 갈라지고 둥글게 꺾인 선(양 끝 연결점)으로 잇는다. 선 색: 진행 중 = 강조색, 끝남 = 옅은 회색, 실패 = 빨강.
   - 감시 역할 에이전트(§4 `role: 'watcher'`)는 오케스트레이터 옆에 점선 테두리 카드 + 점선 가로선.
   - 카드: 모델 제공사 로고(§4 `provider`, §12) · 이름 · 모델(작게) · 상태 배지(진행 중 = 강조색 + 도는 원, 끝남 = 회색, 실패 = 빨강) / 한 줄 과제 설명(Agent 호출의 description) / 구분선 / **최근 호출 5개**(도구 종류 아이콘, 이름, 작은 막대, 걸린 시간 — 진행 중이면 막대가 흐르고 시간 자리에 "…") / 아래 "비용 · 걸린 시간" 과 "호출 N".
   - 새 호출은 목록 아래에 붙고, 5개를 넘으면 가장 오래된 줄이 위로 접히며 사라져 맨 위 "+n 이전 호출" 로 합쳐진다.
   - 에이전트가 끝나면 배지가 끝남/실패로 바뀌고 1.6초 뒤 카드가 한 줄(이름 · 배지 · 비용 · 시간 · 호출 수)로 접힌다. 접힌 카드를 누르면 다시 펼침. "끝난 에이전트 숨기기" 를 켜면 접힌 카드를 아예 숨긴다(진행 중인 하위가 있으면 안 숨김).
   - 새 하위 에이전트가 생기면 부모에서 선이 자라나고 카드가 아래에서 살짝 떠오르며 나타난다.
   - 카드를 누르면 합계 범위가 그 에이전트로 바뀌고, 오른쪽 상세 칸(360px)에 그 에이전트의 합계와 **전체** 호출 목록(최신 먼저)이 나온다. 호출을 누르면 그 아래에 호출 상세(4번과 같은 내용)를 펼친다. 주소 `?gsel=<agent>&gopen=<span>`.
   - 움직임은 150–300ms, 짧고 절제. `prefers-reduced-motion` 이면 모두 끔(바로 최종 상태).
3-2. **타임라인 탭**
   - 본문: 왼쪽 트리(세션 → 에이전트 → 하위 에이전트), 오른쪽 같은 줄에 시간축 막대. 에이전트 줄의 막대 칸에는 그 에이전트의 호출이 작은 막대로 늘어선다(LLM · 도구 색 구분, 오류는 빨강, 진행 중은 끝이 열린 막대).
   - 에이전트 줄을 펼치면 하위 에이전트 줄이 먼저 나오고, 그 아래 "<이름> 호출 N개 (LLM · 도구 · 오류)" 묶음 줄이 접힌 채로 나온다. 묶음을 펼치면 호출 줄이 시간순으로. 호출이 아주 많으면(>200) 같은 도구 연속 N회를 한 줄로 접는다.
4. **호출 상세**: 호출 줄을 누르면 그 줄 바로 아래에 펼친다 — 종류, 이름(도구 이름 / 모델), 시작·끝·걸린 시간, 토큰(입력·출력·캐시 읽기·캐시 쓰기·추론), 비용과 그 근거(보고값 / 단가표 / 모름), 상태, 오류 메시지, 입력·출력 미리보기(최대 2KB, 마스킹 모드면 길이만), 원본 파일 이름과 줄 번호(복사 버튼).
   - 주소에 상태가 남는다: `?s=<sessionId>&sel=<spanId>&open=<spanId>` — 새로고침·공유(같은 기계)해도 같은 화면.
5. **실시간**: 화면을 열어 둔 채로 에이전트가 일하면 새 호출·하위 에이전트가 1초 안에 붙는다(그래프 탭: 카드 등장·호출 줄 추가·오래된 줄 접힘·끝난 카드 접힘·합계 굴림, 타임라인 탭: 트리 줄 추가). 사용자가 위로 스크롤해 보고 있으면 자동 스크롤하지 않고 "새 호출 N개 ↓" 단추만 띄운다.
6. **빈 상태**: 기록 폴더를 못 찾으면 찾아본 경로 목록과 `--root` 사용법. 세션은 있는데 고른 기간에 없으면 "기간 넓히기" 단추.

## 3. 화면 규칙

- 1440 폭: 세션 목록 320px 고정 + 실행 화면. 트리 칸 360px, 나머지 시간축.
- 좁은 폭(≤ 760px): 목록과 실행 화면을 나눠서 한 번에 하나. 시간축 칸 대신 각 줄 이름 아래에 얇은 막대 한 줄. 합계 띠는 2줄로 접힘.
- 다크 모드: 시스템 설정을 따르고, 오른쪽 위 단추로 바꿀 수 있다(`?theme=dark|light`).
- 애니메이션: 진행 중 표시(점 깜빡임, 도는 원, 흐르는 막대)와 그래프 탭의 등장·접힘·숫자 굴림(150–300ms)만. `prefers-reduced-motion` 이면 끔.

### 3.1 그래프 배치 규칙 (카드가 많을 때)

근거(이 기계 실측, 2026-11-13): Claude Code 하위 에이전트 meta 37개 전부 `spawnDepth` 1, Codex 세션 553개 중 하위 1 · 손자 0. 실제로는 **깊이 1(오케스트레이터 → 하위 여러 개)** 이 거의 전부라서 배치는 그 경우에 맞추고, 손자는 드문 예외로만 처리한다.

- **단계별 가로 줄**: 깊이 0(오케스트레이터 + 감시) / 깊이 1 / (드물게) 깊이 2 … 를 위에서 아래로. 한 줄 안은 가운데 정렬, 카드 사이 18px, 단계 사이 40px. 한 줄 안 순서는 부모 순서 → 시작 순서.
- **넘치면 줄바꿈**: 가로 스크롤을 만들지 않는다. 한 단계가 폭을 넘으면 다음 줄로 감싼다(줄 사이 40px). 선은 "자식 줄 바로 위 틈" 높이에서 꺾으므로 가로선이 카드 위를 지나지 않는다(세로 줄기는 카드 뒤로 지나감).
- **손자는 따로 꾸미지 않는다**: 묶음 상자 없이 다음 줄에 일반 카드로 놓고, 선은 부모 카드에서 바로 잇는다.
- **화면 아래로 잘리면**: 첫 화면에서 아래 카드가 잘리면 그래프 아래쪽에 "아래에 에이전트 N개 (진행 중 M) ↓" 안내 단추를 고정해 두고, 누르면 스크롤한다.
- **많으면 축소**: 화면에 보이는 카드가 8개를 넘으면 카드 폭 248 → 216px(248 이면 1440 화면에서 하위 4개가 한 줄), 과제 설명 줄 숨김, 최근 호출 5 → 3개.
- **끝난 카드 접기**: 끝난 카드는 한 줄로 접히므로 오래 돈 실행에서도 진행 중인 카드가 위쪽에 크게 남는다. 그래도 많으면 "끝난 에이전트 숨기기".
- 상세 칸을 열면 그래프 영역이 360px 줄어들고 같은 규칙으로 다시 배치.
- **좁은 폭(≤ 760px)**: 그래프 대신 세로 목록. 카드를 깊이 우선 순서(부모 → 감시 → 자식들)로 한 줄씩, 깊이당 18px 들여쓰기 + 왼쪽 세로 꺾은 선(└). 선 SVG 는 그리지 않는다. 상세 칸은 목록 아래로.
- 숫자: 토큰은 1.2k / 3.4M, 비용은 $0.0123(4자리), 시간은 820ms / 12.4s / 3m 05s.
- 색만으로 구분하지 않는다: LLM 막대는 꽉 채움, 도구 막대는 옅은 채움 + 테두리, 오류는 빨강 + 위쪽 표식. 호출 줄 앞 글자(◆ LLM, ▪ 도구, ▲ 오류)로도 구분.

## 4. 공통 데이터 모델

어댑터는 원본 줄을 아래 형식으로 바꾼다. 서버와 화면은 이 형식만 안다.

```ts
type Source = 'claude-code' | 'codex';
type SpanKind = 'session' | 'agent' | 'llm' | 'tool';
type SpanStatus = 'running' | 'ok' | 'error' | 'cancelled' | 'unknown';

interface Tokens {
  input: number;        // 캐시 제외한 새 입력 (출처별 정의는 §5 표)
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;   // output 에 포함된 값이면 includedInOutput=true
  includedInOutput?: boolean;
}

interface RunSpan {
  id: string;              // 출처 안에서 유일 (예: cc:<sessionId>:<tool_use id>)
  parentId: string | null; // llm·tool 은 자기를 부른 agent, agent 는 부모 agent 또는 session
  sessionId: string;
  source: Source;
  kind: SpanKind;
  name: string;            // agent: 이름/타입, llm: 모델, tool: 도구 이름
  status: SpanStatus;
  start: number;           // epoch ms
  end: number | null;      // 진행 중이면 null
  startApprox?: boolean;   // 시작 시각을 추정했으면 true (§5 참고)
  model?: string;
  agentType?: string;      // 하위 에이전트 종류
  tokens?: Tokens;
  cost?: { usd: number | null; basis: 'reported' | 'priced' | 'unknown' };
  error?: { message: string; code?: string | number };
  ref: { fileId: string; line: number }; // 원본 위치 (fileId 는 색인 번호, 경로 아님)

  // --- 그래프·실시간 표시용 ---
  depth?: number;          // agent: 오케스트레이터 0, 하위 1, 손자 2 …
  role?: 'orchestrator' | 'worker' | 'watcher'; // watcher 는 기록에 표준 필드가 없어 설정(이름 규칙)으로만 붙임, 기본 없음
  task?: string;           // agent: 한 줄 과제 설명 (Claude Code Agent input.description / meta.description, Codex agent_nickname·role). 마스킹 대상
  provider?: 'anthropic' | 'openai' | 'google' | 'other'; // agent·llm: 모델 제공사 (아래 규칙)
  toolCategory?: 'search' | 'web' | 'db' | 'git' | 'shell' | 'file' | 'edit' | 'agent' | 'mcp' | 'other'; // tool: 브랜드가 없을 때의 범주 기호
  toolBrand?: string;      // tool: simple-icons slug (아래 규칙, 표는 brand-map.json). 있으면 범주 기호 대신 브랜드 아이콘
  command?: string;        // tool(Bash·exec): 명령 문자열 — 첫 단어로 브랜드 판별, 화면 표시는 마스킹 대상
  spawnsAgentId?: string;  // tool(Agent/spawn_agent): 이 호출로 생긴 agent span id
  lastActivity: number;    // 이 span(과 자식)의 마지막 줄 시각 — 진행 중 판정·정렬
  seq: number;             // 서버가 매기는 변경 번호. 화면은 seq 가 커질 때만 반영(SSE 재연결 시 Last-Event-ID)
}
// provider 규칙 (모델 이름을 소문자로, 'vendor/' 접두어는 떼고):
//   claude-* 또는 이름 안의 '-claude', opus·sonnet·haiku·fable 로 시작 → 'anthropic'
//   gpt-*, o1·o3·o4(-*), codex(-*) 로 시작                         → 'openai'
//   'gemini' 포함                                                   → 'google'
//   그 밖                                                            → 'other' (중립 기호: 빈 원)
// 표시: 그래프 카드 머리, 카드 안 "모델 응답" 줄, 상세 칸 호출 목록, 타임라인 에이전트 줄(모델 옆)·LLM 호출 줄, 호출 상세 '이름', 세션 목록(쓰인 제공사들).
// toolBrand 규칙 (대소문자 무시, 표 하나 = brand-map.json 의 tools[]: { slug, names[], cmds[] }):
//   1) MCP 도구 mcp__<server>__<tool> → <server> 를 names 와 비교 (예: mcp__github__*, mcp__notion__*, mcp__claude-in-chrome__*)
//   2) 그 밖 도구 → 이름 앞부분(github.pr → github, notion.page → notion)을 names 와 비교
//   3) Bash · exec · exec_command · shell → 명령 첫 단어(앞의 VAR=값 · sudo · env · time 건너뜀, 경로는 떼고)를 cmds 와 비교
//      (예: gh → github, git → git, docker → docker, kubectl → kubernetes, psql → postgresql, npm/npx → npm, python/pip → python, uv → uv, gcloud → googlecloud)
//   4) 맞는 게 없거나 simple-icons 에 아이콘이 없으면 → 지금의 범주 기호(읽기 · 쓰기 · 검색 · 웹 · 실행 · DB · 에이전트)
//   오류 난 호출은 브랜드와 관계없이 오류 기호.
// 세션 목록의 CC/CX 배지는 '도구'(Claude Code / Codex CLI) 표식으로 그대로 두고 툴팁에 "도구:" 를 밝혀 제공사 로고와 섞이지 않게 한다.
// 진행 중 호출은 end=null, status='running'. 끝날 예정 시각은 알 수 없으므로 막대는 "흐르는 막대"(진척도 없음)로 그린다.
// 토큰은 끝난 llm span 에만 있다(진행 중엔 미정) → 합계는 끝난 호출만 더하고, 화면 숫자는 그만큼 굴러 오른다.

interface SessionSummary {
  id: string; source: Source;
  title?: string; project: string; cwd?: string; branch?: string;
  start: number; end: number | null; lastWrite: number;
  status: SpanStatus; agentCount: number; callCount: number; errorCount: number;
  totals: Tokens & { usd: number | null };
  models: string[];
}
```

- 상세 본문(입력·출력 미리보기)은 `RunSpan` 에 넣지 않는다. 상세를 열 때 `GET /api/spans/:id/detail` 로 그때 원본 줄을 다시 읽어 잘라서 준다 → 메모리·전송량이 작고, 마스킹을 한 곳에서 처리한다.
- 합계는 화면이 아니라 서버가 span 트리에서 계산(부분합 캐시).

## 5. 어댑터

### 5.1 기록 폴더 찾기

| 출처 | 기본 | 덮어쓰기 |
|---|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` 가 있으면 그것, 없으면 `~/.claude/projects` | `--root <dir>` 반복 가능, 설정 파일 `~/.config/agent-run-inspector/config.json` 의 `claudeRoots[]` |
| Codex | `$CODEX_HOME/sessions` 또는 `~/.codex/sessions` | `--codex-root <dir>`, `codexRoots[]` |

- 한 기계에 설정 폴더가 여러 개일 수 있다(이 기계: `~/.claude` + 프로필 폴더 2개). 특정 도구(예: Orca) 경로를 코드에 박지 않는다. 대신 `ari roots add <dir>` 로 설정 파일에 더한다.
- 세션 목록에는 어느 폴더에서 왔는지 작은 표시(폴더가 2개 이상일 때만).

### 5.2 Claude Code (조사 결과)

파일
- 메인: `projects/<cwd 의 / 를 - 로 바꾼 이름>/<sessionId>.jsonl`
- 하위 에이전트: `projects/<…>/<sessionId>/subagents/agent-<agentId>.jsonl` + 같은 이름의 `agent-<agentId>.meta.json`
- 큰 도구 출력: `projects/<…>/<sessionId>/tool-results/*.txt` (`toolUseResult.persistedOutputPath` 가 가리킴)
- 백그라운드 작업 출력 `/private/tmp/claude-<uid>/<프로젝트>/<sessionId>/tasks/*.output` 은 위 subagents 파일로 가는 심볼릭 링크라 따로 읽지 않는다.

줄 종류(`type`): `assistant`, `user`, `system`(subtype `turn_duration` · `stop_hook_summary` · `compact_boundary` · `away_summary` · `informational`), `attachment`, `api-request`, `api-request-blob`, `api-request-shape`, `ai-title`, `cost-state`, `last-prompt`, `queue-operation`, `file-history-snapshot`/`-delta`, `mode`, `permission-mode`, `session-owner`, `agent-setting`, `pr-link`, `tools-used` 등. 쓰는 것은 아래 표의 것뿐, 나머지는 건너뛴다(모르는 `type` 도 오류 없이 건너뜀).

공통 필드: `uuid`, `parentUuid`, `timestamp`(ISO), `sessionId`, `cwd`, `gitBranch`, `version`, `isSidechain`(하위 에이전트 파일은 true), 하위 에이전트 파일 줄에는 `agentId`.

| RunSpan | Claude Code 원본 | 비고 |
|---|---|---|
| session | 메인 파일 1개 | 제목 = 마지막 `ai-title.aiTitle`, project = `cwd` 마지막 폴더 |
| llm | `type=assistant` 줄을 **`message.id` 로 묶은 것** | 한 응답이 내용 블록 하나당 한 줄로 나뉘어 저장되고(줄마다 `message.content` 길이 1), `message.usage` 는 같은 `message.id` 의 줄마다 **똑같이 반복**된다(조사: 4235줄 / 고유 2043개, 반복 2192줄 전부 동일). 반드시 `message.id` 로 중복 제거. |
| llm.model | `message.model` | 값 `<synthetic>` 은 실제 호출이 아님 → API 오류 표시용(`isApiErrorMessage`, `apiErrorStatus`, `error`) → 오류 표식만 남기고 토큰 0 |
| llm.start | `api-request` 줄 중 `id == assistant.requestRef` 인 줄의 `timestamp` | 조사: 4235줄 중 4228 연결, 연결되면 항상 assistant 보다 앞. 못 찾으면 바로 앞 줄 시각 + `startApprox` |
| llm.end | 같은 `message.id` 의 마지막 줄 `timestamp` | |
| llm.tokens | `message.usage.input_tokens` · `output_tokens` · `cache_read_input_tokens` · `cache_creation_input_tokens`(`cache_creation.ephemeral_5m_input_tokens`/`_1h_`) · `output_tokens_details.thinking_tokens` | `usage.iterations[]` 에 `type=advisor_message` 가 있으면 그 항목만 `model` 이 따로 있음(다른 모델) → 별도 llm 자식 span 으로 떼어 그 모델 단가로 계산 |
| llm.status | `message.stop_reason` (`end_turn`·`tool_use`·`stop_sequence`) → ok, API 오류 줄 → error | |
| tool | assistant `message.content[]` 의 `type=tool_use` (`id`, `name`, `input`) | `server_tool_use` 도 tool 로(서버 실행) |
| tool.end / 결과 | `type=user` 줄 `message.content[]` 의 `type=tool_result`, `tool_use_id` 로 연결 | 결과 줄 `timestamp` 가 end. 같은 줄 `toolUseResult`(도구별 구조) |
| tool.status | `tool_result.is_error` true → error, `toolUseResult.interrupted` true → cancelled | Bash 는 `toolUseResult.returnCodeInterpretation` 이 있을 수 있음 |
| agent (하위) | `tool_use.name == "Agent"` (`input.subagent_type`, `input.name`, `input.description`, `input.model`, `input.run_in_background`, `input.isolation`) | |
| agent ↔ 파일 | 결과의 `toolUseResult.agentId` → `subagents/agent-<agentId>.jsonl`; 거꾸로 `meta.json.toolUseId == tool_use.id` | 조사: meta 37/37 연결. `toolUseResult.status` 가 `async_launched`(36)·`completed`(1) 이면 파일 있음 |
| agent 메타 | `meta.json`: `agentType`, `name`, `description`, `model`, `spawnDepth`, `finished`, `stoppedByUser`, `worktreePath`/`worktreeBranch`, `toolUseId` | |
| agent.end | `meta.finished == true` 이면 하위 파일 마지막 줄 시각. 메인 파일의 `type=user` + `origin.kind == "task-notification"` 줄도 끝 신호 | `stoppedByUser` → cancelled |
| agent running | `finished` 없음 + 파일 최근 쓰기(기본 10분 이내) | 조사: finished 없는 3개 중 2개가 방금 쓰인 파일(진행 중), 1개는 사용자 중지 |
| 하위의 하위 | 하위 파일 안의 `Agent` tool_use 도 같은 규칙 | 이번 조사에서는 `spawnDepth` 1 만 관찰. 같은 `subagents/` 폴더에 모인다고 보고 `toolUseId` 로 부모를 찾는다(가정) |
| 팀원(teammate) | `toolUseResult.status == "teammate_spawned"` (`teammate_id`, `team_name`, `tmux_*`) | 조사: 15개 전부 subagents 파일 없음 → 별도 세션. 1차: 트리에 "외부 세션" 노드(이름·타입·시작)만, 같은 폴더에서 맞는 세션을 찾으면 링크(§11) |
| 세션 합계(보고값) | `type=cost-state`: `totalCostUSD`, `modelUsage.<model>.{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD}`, `totalDuration` | 있을 때만(조사: 3개 중 2개). 있으면 세션 합계 비용은 이 값(근거 `reported`) |
| 턴 길이 | `system/turn_duration.durationMs` | 참고 표시용 |
| 압축 | `system/compact_boundary` (`compactMetadata.preTokens`/`postTokens`) | 시간축에 세로 표식 |

### 5.3 Codex CLI (조사 결과)

파일: `sessions/YYYY/MM/DD/rollout-<시각>-<threadId>.jsonl`. 조사한 549개 파일의 `cli_version` 은 0.40 ~ 0.166 으로 넓게 섞여 있고 버전마다 줄 종류가 다르다. **모든 버전에 공통인 최소 집합으로 먼저 만들고, 새 버전 줄이 있으면 그것을 우선**한다.

줄 형태: `{ timestamp, type, payload }` (+ 새 버전은 `ordinal`, `metadata`). `type` 은 `session_meta`, `turn_context`, `response_item`(payload.type `message` · `reasoning` · `function_call` · `function_call_output` · `custom_tool_call` · `custom_tool_call_output` · `web_search_call` · `agent_message`), `event_msg`(payload.type `task_started` · `task_complete` · `turn_aborted` · `token_count` · `user_message` · `agent_message` · `item_completed` · `context_compacted` 등), `token_usage_record`(0.166), `world_state`, `compacted`.

| RunSpan | Codex 원본 | 버전 / 비고 |
|---|---|---|
| session | 첫 줄 `session_meta.payload`: `id`, `timestamp`, `cwd`, `cli_version`, `originator`, `model_provider`, `git.branch` | 전 버전. 첫 줄이 session_meta 가 아닌 파일 2개 → 목록에 "형식 모름" 으로만 |
| 모델 | `turn_context.payload.model` (턴마다) | 전 버전 |
| 턴(묶음) | `event_msg/task_started.turn_id` → `task_complete` 또는 `turn_aborted`(`reason`) | 0.107~. 턴은 별도 kind 로 만들지 않고 시간축 배경 띠로 표시 |
| tool | `response_item/function_call`·`custom_tool_call` (`name`, `call_id`) ↔ `*_output` (`call_id`) | 전 버전. 조사: 짝 맞음 7,500여 개 / 안 맞음 5 → 안 맞으면 running(최근) 또는 unknown |
| tool.start/end | 위 두 줄의 `timestamp` | 0.166: `event_msg/item_completed` 에 `started_at_ms`·`completed_at_ms`·`item.status`(completed/failed)·`item.exit_code`·`item.error.message`·`item.duration` 이 있음. item ↔ call_id 연결은 미확인(§11) → 연결되면 시간·상태를 이것으로 덮음 |
| tool.status | 0.166: `item.status == failed` 또는 `exit_code != 0` → error. 이전 버전: 구조로 알 수 있는 신호가 없음 → `unknown` | 이전 버전의 출력 본문을 파싱해서 종료 코드를 뽑지 않는다(본문을 해석하지 않는 원칙) |
| llm | `event_msg/token_count` 1개 = 응답 1회. end = 그 줄 시각, start = 바로 앞 사용자 입력·도구 출력 줄 시각(`startApprox`) | `payload.info.total_token_usage` 는 **누적값**이라 더하지 않는다. `last_token_usage` 를 쓰고, 누적값이 앞 줄과 같으면 중복으로 버린다 |
| llm.tokens | `last_token_usage.{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}` (+0.166 `cache_write_input_tokens`) | `cached_input_tokens` 가 `input_tokens` 에 포함되는지 미확인(§11) |
| llm (0.166) | `token_usage_record.payload` (`response_id`, `turn_id`, `usage`, `turn_token_usage`, `thread_token_usage`) 가 있으면 이것만 쓰고 token_count 는 무시 | 둘 다 더하면 두 배 |
| agent (하위) | 하위 스레드는 **별도 rollout 파일**. 그 파일 `session_meta.payload.parent_thread_id` (또는 `source.subagent.thread_spawn.{parent_thread_id, depth, agent_nickname, agent_path, agent_role}`) | 조사: 하위 파일 10개 전부 부모 파일을 같은 날짜 폴더에서 찾음 |
| agent ↔ 부모 호출 | 부모의 `function_call name == "spawn_agent"` (`call_id`). 0.166 은 `item_completed` 의 `item.type == SubAgentActivity` (`agent_thread_id`, `kind` started/completed) 로 정확히 연결 | SubAgentActivity 로 연결된 건 10개 중 1개뿐 → 나머지는 "부모의 spawn_agent 호출 중 하위 `session_meta.timestamp` 직전 것" 으로 짝지음(`startApprox`, 화면에 "추정 연결" 표시) |
| agent.end / running | 하위 파일의 마지막 `task_complete`/`turn_aborted`, 없으면 파일 최근 쓰기 기준 | |
| 오류 | `turn_aborted`(`reason`), 0.166 `item.error.message` | |
| 비용 | 기록에 비용 값 없음 → 단가표(§7) 또는 토큰만 | |

## 6. 실시간 갱신

- 서버가 색인할 때 파일마다 (크기, mtime, 읽은 바이트 위치, 마지막 줄 조각) 를 기억한다.
- 감시: `fs.watch(root, { recursive: true })` (macOS·Windows, Linux Node 22). 이벤트는 200ms 모아서 처리. `fs.watch` 가 실패하거나 Linux 구버전이면 2초 간격 `stat` 폴링으로 자동 전환.
- 바뀐 파일은 기억한 위치부터 끝까지만 읽는다(tail). 줄이 끝나지 않은 마지막 조각은 다음 번에 이어 붙임. 파일 크기가 줄었으면(교체·압축) 처음부터 다시.
- 새 줄 → 어댑터가 RunSpan **변경분**(추가·갱신) 을 낸다 → 열린 화면에 SSE 로 보낸다.
  - `GET /api/sessions/stream` : 세션 목록 변경 `{type:'session', summary}`
  - `GET /api/sessions/:id/stream` : `{type:'span', span}` / `{type:'totals', totals}` / 15초마다 `: ping`
  - 화면은 처음에 `GET /api/sessions/:id` 로 전체를 받고, 그 뒤 스트림 변경분만 합친다. 끊기면 `Last-Event-ID` 로 이어 받고, 서버가 그 사이를 못 주면 전체 다시 받기.
- 새 하위 에이전트 파일·Codex 하위 rollout 파일이 생기면(감시 폴더 안 새 파일) 부모 세션 스트림으로 바로 붙인다.
- 상한: 동시에 tail 하는 파일은 최근 24시간 안에 쓰인 것만. 목록용 색인은 첫 줄·마지막 줄 일부만 읽어 빠르게(전체 파싱은 세션을 열 때).

## 7. 비용 계산

- 우선순위: ① 기록에 있는 보고값(Claude Code `cost-state` 의 `costUSD`/`totalCostUSD`, 세션·모델 단위) → ② 단가표로 계산 → ③ 모름(토큰만 표시, 비용 칸 "—").
- 단가표는 패키지에 `prices.json`(모델 id → 입력·출력·캐시 읽기·캐시 쓰기 단가, 100만 토큰당 USD, `asOf` 날짜) 으로 넣고, 사용자가 `--prices <file>` 또는 설정 파일로 덮어쓴다. 모델 id 는 정확히 일치 → 접두어 일치 순으로 찾는다.
- 기본 단가표 값은 구현할 때 각 회사 공개 가격표에서 날짜와 함께 채운다(이 문서에 값을 적지 않는다). 모르는 모델은 ③.
- 화면은 비용 옆에 근거를 작게 표시: `보고` / `단가표 2026-11` / `—`. 합계에 ③이 섞여 있으면 "일부 모름" 표시.
- 하위 에이전트 span 의 보고값은 없으므로 하위 에이전트 비용은 언제나 ②.

## 8. 보안

실행 기록에는 고객사 데이터·비밀이 들어 있을 수 있다. 원칙: **화면에 보여 주는 것 외에 어디로도 보내지 않는다.**

- 바인딩: `127.0.0.1` 만(설정으로도 `0.0.0.0` 허용 안 함). 포트 기본 0(빈 포트 자동), `--port` 로 지정.
- 접속 토큰: 실행마다 무작위 토큰을 만들어 첫 주소 `?t=` 로 넘기고, 받으면 HttpOnly·SameSite=Strict 쿠키로 바꾼 뒤 주소에서 지운다. 쿠키 없는 요청은 401. (같은 기계의 다른 사용자·다른 웹페이지가 `127.0.0.1` 로 요청하는 것을 막음)
- `Host` 헤더가 `127.0.0.1:<port>` 또는 `localhost:<port>` 가 아니면 거절(DNS 재바인딩 방지). `Origin` 이 있으면 같은 출처만.
- CORS 헤더 없음. 응답에 `Content-Security-Policy: default-src 'self'; img-src 'self' data:; connect-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- 경로 순회 방지: 화면·API 는 파일 경로를 절대 받지 않는다. 세션·span 은 색인이 준 불투명 id 로만 찾는다. 서버 안에서 파일을 열 때도 `realpath` 가 등록된 기록 폴더 안인지 확인(심볼릭 링크로 밖을 가리키면 거절). 정적 파일은 패키지 `web/` 안에서 고정 목록으로만 제공.
- 읽기 전용: 기록 파일을 쓰거나 지우지 않는다.
- 외부 요청은 업데이트 확인 하나뿐: CLI 가 하루 한 번 `registry.npmjs.org/agent-run-inspector/latest` 에서 버전 번호만 받아 새 버전이면 stderr 에 한 줄 알린다(`src/update-check.js`, 결과는 설정 폴더 `update-check.json` 에 캐시, 2초 타임아웃, 실패는 조용히 무시). `--no-update-check`·`ARI_NO_UPDATE_CHECK`·`NO_UPDATE_NOTIFIER`·`CI` 로 끔. 화면 자산(글꼴·스크립트)은 전부 패키지 안에 넣는다. CDN·텔레메트리 없음. 브라우저 열기는 `open`/`xdg-open`/`start` 를 인자 배열로 실행(셸 문자열 아님).
- 마스킹: `--redact`(또는 화면 오른쪽 위 토글, 서버가 켜고 끄며 화면 혼자 끄지 못함)
  - 입력·출력 미리보기 → "(1,234자 숨김)" 처럼 길이만.
  - 도구 입력은 키 이름만, 값 숨김. 객체 **키 자체가 민감할 수 있다**(조사 중 파일 경로가 객체 키로 쓰인 경우를 봄) → 마스킹 모드에서 키도 경로처럼 보이면 숨김.
  - 세션 제목·프로젝트 이름도 숨기는 단계(`--redact=strict`): 화면 공유·캡처용.
- 로그: 서버 콘솔에는 주소·오류 종류만. 기록 본문을 콘솔·파일로 남기지 않는다.

## 9. 패키징 · 설치

- npm 패키지 `agent-run-inspector`, 실행 파일 `agent-run-inspector`(별칭 `ari`). Node ≥ 22(Node 20 은 2026-04 지원 종료), **런타임 의존성 0**(Node 내장 `http`·`fs`·`readline` 만), 빌드 단계 없음 → GitHub 에서 바로 설치해도 그대로 동작.
- 구성: `bin/cli.js`, `src/server/`(HTTP·보안·API), `src/index/`(색인), `src/live/`(감시·tail·SSE), `src/adapters/claude-code/`, `src/adapters/codex/`, `src/model/`(합계·가리기·상세), `src/cost.js`, `src/open.js`, `prices.json`, `brand-map.json`, `web/`(HTML·CSS·JS 그대로), `README.md`·`README.ko.md`. `package.json` 의 `files` 가 이것만 담는다(테스트·docs·scripts 제외).
- 실행 방법
  - 지금(공개 레포): `npx github:th-yong/agent-run-inspector` — 로그인 없이 누구나. npm 레지스트리 배포(`npx agent-run-inspector`)는 첫 배포 대기 중.
  - 나중(공개 결정 후): `npx agent-run-inspector`.
- 명령줄: `--port <n>`, `--no-open`, `--root <dir>`(반복), `--codex-root <dir>`, `--source claude|codex|all`, `--since 7d`, `--redact[=strict]`, `--prices <file>`, `--open[=auto|orca|browser|none]`, `--session <id>`, `--no-update-check`, `roots add|list|remove`, `service install|uninstall`, `open`.
- 서비스 모드(macOS, `src/service.js`): `ari service install` 이 LaunchAgent(`~/Library/LaunchAgents/io.github.th-yong.agent-run-inspector.plist`, `KeepAlive: Crashed` 만)를 등록하고 `node bin/cli.js --service` 를 로그인 때 띄운다. 고정 포트(기본 7317)와 고정 토큰은 `service.json`(0600)에서 서버가 직접 읽는다 — plist·인자·로그에 토큰 없음, 주소도 출력 안 함. 쿠키는 Max-Age 1년. `ari open` 은 토큰 주소로 다시 연다. npx 캐시 경로에서는 설치 거부. 기본 `ari` 실행은 그대로(실행마다 새 토큰, 세션 쿠키).
- macOS 앱(`src/macos/app.js`, `buildApp` in `src/service.js`): `ari service install` 이 `osacompile -l JavaScript -s -x` 로 stay-open applet 을 `~/Applications/Agent Run Inspector.app` 에 만든다(NSWindow + WKWebView, JXA). Info.plist `ARIServiceFile` 에 service.json 경로만 넣고, 실행마다 그 파일에서 포트·토큰을 읽어 `/?t=` 로 로그인 — 앱에 토큰 없음. 아이콘 `src/macos/AppIcon.icns`(스크립트가 그림), ad-hoc 재서명. 실패해도 서비스 설치는 성공(Chrome 설치 안내). uninstall 이 앱도 지움.
- Dock(`src/dock.js`): install 이 `defaults export` + PlistBuddy 로 persistent-apps 에서 앱 URL(`file:///…/Agent%20Run%20Inspector.app/`)을 찾고, 없을 때만 `defaults write … -array-add` + `killall Dock`. uninstall 은 그 항목만 Delete 후 `defaults import` + `killall Dock`. `--no-dock`.
- 버전: `GET /api/meta` → `{ version, latest }`(latest 는 서버의 일일 npm 확인 결과, 서비스는 6시간마다 다시 확인). 화면 머리에 `v0.x.y` 와 새 버전 배지. 앱 Info.plist 에 `CFBundleShortVersionString`.
- 메뉴 막대: 앱(`src/macos/app.js`)이 NSStatusItem 을 띄운다 — 10초마다 `/api/sessions`(service.json 쿠키)를 읽어 진행 중 수와 메뉴(진행 중 + 최근 5개, 누르면 창에서 `/?s=<id>`). 로그인 항목 LaunchAgent(`…agent-run-inspector.login`)가 `open -g -j <app> --args --background` 로 창 없이 띄운다. SwiftBar 연동은 없앰.
- 웹 앱 설치: `web/manifest.webmanifest` + `icon-32.png`(탭)·`icon-192.png`·`icon-512.png`(`scripts/build-app-icons.js` 로 그림). 이것들(`PUBLIC_FILES`)만 쿠키 없이 준다(브라우저가 manifest 를 자격 증명 없이 가져옴). Host·Origin 검사는 그대로 먼저.
- Claude Code 플러그인(덧붙임, **v0.3.0 뒤**로 미룸 — 아직 없음): 같은 레포에 `.claude-plugin/plugin.json` + `commands/inspect.md`(슬래시 명령 `/inspect` → `npx -y github:th-yong/agent-run-inspector --session $CLAUDE_SESSION_ID` 로 지금 세션을 바로 엶). 설치: `/plugin marketplace add th-yong/agent-run-inspector` → `/plugin install agent-run-inspector`. 핵심 기능은 CLI 쪽에만 있다.
- Codex: 플러그인 체계에 기대지 않는다. 터미널에서 같은 `npx` 명령.

## 10. 넣지 않는 것

- 에이전트를 조작하는 기능(멈춤·재시작·메시지 보내기). 읽기만 한다.
- 훅·프록시·SDK 계측. 기록 파일만 읽는다.
- 원격 접속·여러 사용자·로그인·클라우드 동기화·공유 링크.
- Claude Code·Codex 외 다른 도구(Cursor, Gemini CLI 등)와 어댑터 플러그인 체계.
- 기록을 DB 에 따로 저장하거나 내보내기(JSON 다운로드 포함). 필요하면 나중에.
- 본문 검색, 대화 전체 보기(채팅 재생). 상세는 미리보기 2KB 까지.
- 정확한 청구 금액 보장(단가표 기반 추정임을 화면에 밝힘).
- 알림·예산 경고.

## 11. 확인 못 한 것 (구현 때 검증)

1. Claude Code 하위의 하위 에이전트(spawnDepth ≥ 2) 파일 위치 — 이번 기록엔 깊이 1 만 있음.
2. Claude Code 팀원(`teammate_spawned`) 세션을 부모와 잇는 확실한 키. `teammate_id`·`team_name` 과 다른 세션 줄의 `agentName`·`teamName` 을 비교해 볼 것.
3. Codex `cached_input_tokens` 가 `input_tokens` 에 포함인지(포함이면 새 입력 = input − cached).
4. Codex 0.166 `item_completed.item.id` 와 `function_call.call_id` 의 관계.
5. Codex 하위 rollout ↔ `spawn_agent` 호출 시간 기반 짝짓기의 정확도(동시에 여러 개 띄울 때).
6. Codex 구버전(0.4x~0.6x) `token_count` 의 `info` 가 null 인 줄 처리.
7. 파일 회전·압축(Claude Code `compact_boundary` 이후 파일이 바뀌는지) 때 tail 위치 처리.

## 12. 제3자 자산

**브랜드 아이콘** — 출처 simple-icons (npm `simple-icons`) **15.22.0**, 라이선스 **CC0-1.0**. 쓰는 것만 path 를 뽑아 인라인(런타임 외부 요청 없음, simple-icons 를 의존성으로 넣지 않음 → 런타임 의존성 0 유지).

| 용도 | slug |
|---|---|
| 모델 제공사 | `claude`(anthropic), `openai`, `googlegemini`(google) |
| 코드·저장소 | `github`, `git` |
| 협업·문서 | `notion`, `figma`, `slack`, `linear`, `jira`, `atlassian`, `confluence`, `googledrive`, `googledocs`, `gmail`, `googlecalendar` |
| 클라우드·인프라 | `googlecloud`, `docker`, `kubernetes`, `postgresql`, `redis`, `vercel`, `supabase`, `sentry`, `stripe` |
| 런타임·패키지 | `npm`, `pnpm`, `yarn`, `nodedotjs`, `python`, `uv` |
| 브라우저 | `googlechrome` |
| **simple-icons 에 없음 → 범주 기호** | Microsoft Azure(`az`), AWS(`aws`), Playwright |

- 매핑 표: 레포 루트 `brand-map.json`(패키지에 포함, 원본 하나). 아이콘 path 와 테마별 색은 이 표와 simple-icons 에서 스크립트로 만들어 넣는다(손으로 고치지 않음).
- **그리지 않는 로고 (2026-11-16)**: 각 사 공개 브랜드 가이드라인을 확인한 결과, 로고 변형(여러 색 로고의 단색화·색 변경)·사용 허가·다른 로고와의 병렬 표시를 막는 곳은 `brand-map.json` 의 `noIcon.slugs` 에 넣고 범주 기호로 대신한다: OpenAI, Google 계열(Gemini·Gmail·Drive·Docs·Calendar·Cloud·Chrome), Figma, Slack, Python, Docker, PostgreSQL, Linear, Vercel, Atlassian·Jira·Confluence. 도구 판별(`names`·`cmds`)은 그대로 남는다. 근거는 `THIRD_PARTY_NOTICES.md`.
- **색 규칙**: 브랜드 고유색(simple-icons `hex`)을 **바꾸지 않는다**. 무채색(검정·회색, HSL 채도 < 0.25) 로고가 배경과 3:1 이 안 되면 글자색 단색(라이트 검정 / 다크 흰색 = 그 회사의 흑/백 버전)으로 그린다. 예: GitHub · Notion 은 다크에서 흰색. 채도 있는 색은 대비가 낮아도 그대로 둔다(예: 다크의 Sentry 진보라).
- **상표는 각 회사 소유.** 아이콘은 "어느 제공사 모델 / 어느 서비스 도구인가" 를 알아보게 하는 식별 용도로만 쓰고, 우리 도구의 로고·이름·홍보물에는 쓰지 않는다.
- **공개 배포 전 확인 필요**: 남은 아이콘 중 공개 가이드라인을 확인하지 못한 곳(Anthropic, Notion, pnpm, uv, Supabase, Sentry, Stripe, Node.js)은 `THIRD_PARTY_NOTICES.md` 에 표시해 두었다.
- **주의**: `openai` 아이콘은 simple-icons **16.0.0 에서 빠졌다**(최신 16.37.0 에는 없음, 15.22.0 까지 있음). 그래서 모든 아이콘을 15.22.0 에서 가져왔다. 빠진 이유(상표권자 요청 여부)를 공개 배포 전에 확인하고, (2026-11-16: OpenAI 는 중립 기호로 바꿨다.) 같은 이유로 Azure·AWS 처럼 이미 빠진 브랜드는 다른 출처에서 가져오지 않는다.
