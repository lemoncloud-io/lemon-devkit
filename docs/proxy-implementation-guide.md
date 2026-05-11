---
type: guide
audience: ai-agent
tags:
  - backend-service
  - backend-proxy
  - manager-proxy
  - use-case
  - ai-agent
glossary:
  use-case: src/lib/<domain>/ 아래 비즈니스 흐름 단위. 항상 'use-case'로 쓴다 (UseCase/usecase 금지).
  manager-proxy: src/modules/<domain>/proxy.ts. 단일 도메인 atomic helper.
  backend-proxy: src/service/backend-proxy.ts. 요청 단위 컨테이너.
  pool: BackendProxy._<domain> 형태로 노출되는 use-case 묶음.
---

# BackendService / BackendProxy 구현 가이드 (AI Agent)

> 이 문서는 AI 에이전트가 새 기능을 구현·리뷰·디버깅할 때 따르는 절차서다.  
> 모든 결정은 **§3 결정 규칙**과 **§9 Do/Don't**으로 환원된다. 모호하면 그쪽으로 돌아간다.
> 새 기능의 비즈니스 로직은 **`proxy.md`나 `src/modules/<domain>/proxy.ts`가 아니라 `src/lib/<domain>/` use-case 모듈에 구현**한다.

---

## §0. 시작 전: 어디부터 읽을 것인가

| 작업 유형 | 읽는 순서 |
|---|---|
| 새 기능 구현 | §1 → §2 → §3 → §4 → §9 |
| 기존 코드 리뷰 | §3 → §9 → §10 |
| 버그 수정 | §3 (위치 결정) → §6 (메서드) → §9 |
| 개념 학습 | §10 → §5 → §7 |
| 빠른 룩업 | §11 (Task → Section) |

**경로 표기 약속**

- `<domain>`: 도메인 이름 (예: `chats`, `sockets`, `users`)
- `<use-case>`: use-case 파일/폴더 이름 (예: `send-chat`)
- `proxy.<domain>`: manager-proxy 인스턴스
- `proxy._<domain>`: use-case pool

---

## §1. 선조건 (PRECONDITION) — 만족 못하면 즉시 중단

유저가 다음 3가지를 제공했는지 확인한다. **하나라도 없으면 구현을 시작하지 말고 유저에게 요청한다.**

- [ ] **요구사항**: 비즈니스 흐름의 단계별 기술
- [ ] **Input**: 요청 파라미터 타입 또는 인터페이스 이름
- [ ] **Output**: 응답 타입 또는 인터페이스 이름

> **STOP 조건**: 위 3개가 모두 없을 때, "보통 이렇게 한다"로 추정해 시작하지 않는다.

---

## §2. 절차 (PROCEDURE)

### STEP 1. 파일 탐색 — 재사용 가능한 것을 먼저 식별

| 순서 | 파일 | 확인할 것 |
|---|---|---|
| 1 | `src/service/backend-proxy.ts` | 사용 가능한 manager-proxy, 기존 `_<domain>` pool |
| 2 | `src/modules/<domain>/proxy.ts` | 기존 helper (있으면 재사용) |
| 3 | `src/modules/<domain>/model.ts` | 필드 정의 (source of truth) |
| 4 | `src/lib/<domain>/` | 기존 use-case 목록 |

→ 객체 역할은 **§4 핵심 객체** 참고.

### STEP 2. SPEC.md 작성 — 구현 전 명세 고정

`src/lib/<domain>/SPEC.md` 또는 use-case 파일 상단 JSDoc에 작성한다.

- 기능 설명 1줄
- 비즈니스 STEP 목록 (§1 요구사항 기반)
- Input / Output 타입 명세
- 성공 시나리오 ≥ 1
- 실패 시나리오 (모델 없음, 권한 없음, validation 실패 등)

> **STOP 조건**: SPEC.md 없이 코드 작성을 시작하지 않는다.

### STEP 3. 책임 분리 — proxy vs use-case

기본값은 **use-case 모듈**. 새 기능의 비즈니스 로직은 항상 use-case에서 시작한다.  
`proxy.md`/`proxy.ts`는 전체 기능 흐름을 담는 곳이 아니라 use-case가 호출하는 atomic helper를 설명·구현하는 곳이다. 아래 표로만 예외를 결정한다.

| 판단 기준 | 위치 |
|---|---|
| 새 기능의 비즈니스 흐름 (`validate → resolve → fetch → authorize → execute → return`) | `src/lib/<domain>/<use-case>.ts` |
| 여러 use-case에서 반복 호출되는 atomic helper (`verifyJoin`, `makeChat`) | `src/modules/<domain>/proxy.ts` |
| ID 생성, counter 증가, 단일 model mutation | `src/modules/<domain>/proxy.ts` |
| 하나의 API 흐름 전체 (resolve → fetch → authorize → execute → return) | `src/lib/<domain>/<use-case>.ts` |
| 여러 manager를 순서 있게 조합 | `src/lib/<domain>/<use-case>.ts` |

→ 추가 결정 규칙은 **§3 결정 규칙** 참고.

### STEP 4. 비즈니스 로직을 STEP으로 정렬

유저 요구사항을 다음 6단계 틀에 맞춘다 (모든 단계가 항상 필요한 건 아님).

```
STEP.0  validate   — 필수 입력값·전제 조건 확인
STEP.1  resolve    — 요청 주체 및 의존 리소스 해소
STEP.2  fetch      — 대상 조회 및 존재·유효성 검증
STEP.3  authorize  — 권한·비즈니스 조건 검증
STEP.4  execute    — 핵심 상태 변경 수행
STEP.5  return     — 결과 가공 및 반환
```

→ 실제 코드 형태는 **§7 use-case 예시** 참고.

### STEP 5. types.ts 작성

`src/lib/<domain>/<use-case>/types.ts` 또는 `src/lib/<domain>/types.ts`.

```ts
export interface <UseCaseName>Input { ... }   // 유저 제공 Input
export interface <UseCaseName>Output { ... }  // 유저 제공 Output
export interface <UseCaseName>Options { ... } // 실행 주입값만 ($owner, throwable, useSession 등)
```

> **STOP 조건**: `Options`에 비즈니스 입력값을 넣지 않는다. 요청 파라미터는 `Input`에 둔다.

### STEP 6. use-case 구현

파일: `src/lib/<domain>/<use-case>.ts` 또는 `<use-case>/execute.ts`.

- 시그니처: `(proxy: BackendProxy, input: Input, options?: Options) => Promise<Output>`
- STEP 4의 순서를 주석으로 표시
- Storage 접근은 `proxy.<domain>.*`로만
- proxy helper가 있으면 그걸 쓴다. 없으면 §6의 `get/set/inc` 조합

#### STEP 6 내부 구현 절차

| # | 행동 | 참고 |
|---|---|---|
| 6.1 | 멱등성 판단 → 메서드 선택 (`get`/`set`/`inc`) | §6 |
| 6.2 | proxy helper 재사용 vs 신규 작성 결정 | §3 |
| 6.3 | §9 Do/Don't 위반 검사 | §9 |
| 6.4 | 위반 발견 시 해당 STEP으로 돌아가 수정 | — |

### STEP 7. 테스트 작성 및 실행

`execute.spec.ts` 또는 `<use-case>.spec.ts`. 다음을 모두 커버한다.

- input validation 실패 (필수 필드 누락)
- 주요 성공 흐름 (SPEC.md 성공 시나리오)
- 핵심 실패 흐름 (모델 없음, 권한 없음 — SPEC.md 실패 시나리오)
- 저장 반영 여부 (`guardProxy()` 종료 후 `service.$<domain>.find/retrieve`로 확인)

→ 상세 규칙은 **§8 테스트 규칙** 참고.

### STEP 8. Pool / Proxy 등록 및 API 연결

| # | 행동 |
|---|---|
| 8.1 | `src/lib/<domain>/index.ts`에 use-case를 pool로 등록 |
| 8.2 | 여러 API에서 재사용 시 `src/service/backend-proxy.ts`에 `_<domain>`으로 포함 |
| 8.3 | `src/modules/<domain>/api-*.ts`의 `guardProxy()` 안에서 use-case 호출 |

> controller는 얇게 유지: request 정규화 + use-case 진입점만.

### STEP LAST. 자기검증 게이트

→ **§9 자기검증 체크리스트**를 모두 통과해야 완료. 위반 시 해당 STEP으로 복귀.

---

## §3. 결정 규칙 (DECISION RULES)

### 3.1 기능을 어디에 둘 것인가

| 상황 | 위치 |
|---|---|
| 새 기능의 비즈니스 로직 | `src/lib/<domain>` use-case |
| 단순 조회 | `service.$<domain>` 또는 `proxy.<domain>.get/find` |
| `guardProxy()` 바깥에서 최종 저장 결과 확인 | `service.$<domain>.find/retrieve` |
| 단일 model 변경 | `proxy.<domain>.set/inc` |
| 단일 도메인 atomic helper | `src/modules/<domain>/proxy.ts` |
| 여러 manager를 순서 있게 조합 | `src/lib/<domain>` use-case |
| 여러 API/handler에서 같은 기능 호출 | use-case pool을 `BackendProxy`에 `_<domain>`으로 포함 |
| WebSocket agent처럼 한 곳에서만 호출 | use-case 직접 import 허용 |
| request/event parsing | `src/modules/<domain>/api-*.ts` 또는 event handler |

### 3.2 proxy helper 재사용 vs 신규 작성

| 판단 | 행동 |
|---|---|
| `proxy.<domain>.<helper>()` 시그니처가 이미 있다 | 그걸 쓴다. 재구현 금지 |
| 같은 atomic mutation이 이 use-case 이후에도 반복될 것 같다 | `ManagerProxy`에 helper 추출 후 사용 |
| 이 use-case에서만 쓰는 비즈니스 판단·분기·흐름이다 | use-case 파일 안에서 직접 구현 |
| 새 API 기능의 전체 흐름을 추가해야 한다 | `ManagerProxy`가 아니라 use-case를 만든다 |

### 3.3 Pool 포함 vs 직접 import

| 조건 | 선택 |
|---|---|
| 호출자가 이미 `BackendProxy`를 가짐 + 호출 지점 1~2곳 + 재사용 가능성 낮음 | **직접 import** (예: socket agent, migration) |
| 그 외 | **`BackendProxy._<domain>` pool 포함** (기본값) |

---

## §4. 핵심 객체 (CONCEPTS)

> 절차에 막혔을 때만 펼쳐 본다. 일반 흐름에는 §2가 충분하다.

### BackendService
- 위치: `src/service/backend-service.ts`
- 책임: 도메인 manager 생성, `createProxy(context)`로 `BackendProxy` 생성, `guardProxy()` 제공
- AI 읽는 기준: 등록된 `$<domain>` 목록 / 외부 API/SDK wrapper / `guardProxy()` 바깥 결과 확인용 `service.$<domain>.find/retrieve`

### BackendProxy
- 위치: `src/service/backend-proxy.ts`
- 책임: 요청 단위 실행 컨텍스트, manager-proxy 접근점, use-case pool 노출
- AI 읽는 기준: `proxy.<domain>` manager 목록 / `proxy._<domain>` pool 존재 여부 / **`guardProxy()` 안에서는 항상 `proxy.<domain>` 사용 (`service.$<domain>` 금지)**

### ManagerProxy
- 위치: `src/modules/<domain>/proxy.ts`
- 책임: 단일 도메인 model의 atomic 동작, `get/set/inc` 공통 + 도메인 helper
- 비책임: 새 기능의 전체 비즈니스 흐름, 여러 단계의 권한/존재 검증, 여러 manager 조합
- AI 읽는 기준: 새 helper 추가 전 기존 helper 존재 확인. 단일 model의 ID/조회/저장/counter 로직은 보통 여기. 기능 흐름은 `src/lib/<domain>/` use-case로 이동한다.

### ApiController
- 위치: `src/modules/<domain>/api-*.ts`
- 책임: path/query/body/event parsing, transformer 정규화, entrypoint 정책 해소, `guardProxy()` 시작, use-case 결과 반환
- AI 읽는 기준: 같은 도메인 기존 `api-*.ts` naming/패턴을 따른다. 긴 business flow는 controller에 두지 않는다.

### UseCase
- 위치: `src/lib/<domain>/`
- 책임: 여러 `proxy.*` 호출 조합, 권한/존재 검증, mutation, view 변환
- AI 읽는 기준: `types.ts`에서 계약 / `execute.ts`에서 STEP 순서 / `index.ts`에서 pool 등록.

### guardProxy()
- 위치: `src/cores/abstract-services.ts` (대개)
- 시그니처: `guardProxy<T>(context: NextContext, callback: (proxy: Proxy) => Promise<T>): Promise<T>`
- 동작: proxy 생성 → callback 실행 → 종료 시 `saveAllUpdates()` 자동 호출
- 규칙:
  - 안에서 읽기/쓰기는 `proxy.*`로 통일
  - 안에서 새 `BackendService` 생성 금지
  - 예외 시에도 `saveAllUpdates()` 1회 시도 후 throw 가능 (서비스 구현 확인)

---

## §5. 표준 사용 흐름

```ts
return this.service.guardProxy($ctx, async proxy => {
    const model = await proxy.test.get('A00001', {});
    await proxy.test.set('A00001', { name: 'updated name' });
    return model;
});
```

1. `guardProxy()`가 `NextContext`로 `BackendProxy` 생성
2. callback 안에서 `proxy.*`로 조회/수정
3. callback 종료 → `proxy.saveAllUpdates()`
4. 누적 변경사항 Storage 반영

---

## §6. ManagerProxy 메서드 (`get` / `set` / `inc`)

### 6.1 멱등성 → 메서드 선택

| 상황 | 사용 메서드 |
|---|---|
| 카운터·순번·tick 증가 (재시도 시 두 번 더해야 정상) | `inc()` |
| atomic claim (반환값 1로 선점 판별) | `inc()` + 반환값 검증 |
| upsert (없으면 기본값, 있으면 덮어쓰기) | `get({}) → set()` |
| 필드 덮어쓰기 (이미 조회된 모델 확정 상태) | `set()` |
| 반드시 있어야 하는 모델 조회 | `get(true)` |
| 없어도 되는 조회 | `get(false)` |

### 6.2 `get()`

```ts
await proxy.test.get('A00001', true);   // 없으면 throw
await proxy.test.get('A00001', false);  // 없으면 null
await proxy.test.get('A00001', {});     // 없으면 기본 모델로 시작
```

- `false`로 받으면 `null`일 수 있음. 바로 필드 대입 금지.
- `{}`로 받으면 read-modify-write 시작점으로 자연스럽게 이어짐.

### 6.3 `set()`

```ts
await proxy.test.set('A00001', { name: 'new name' });
```
- 부분 업데이트. 실제 Storage 반영은 `guardProxy()` 종료 시점.

### 6.4 `inc()`

```ts
const test = await proxy.test.inc('A00001', { count: 1 });
```
- 숫자 누적이 의도일 때. atomic counter 성격 있을 때.

### 6.5 도메인 helper 우선순위

1. 도메인 helper 있으면 helper 사용
2. 없으면 `get/set/inc` 조합
3. 같은 mutation 반복 → `ManagerProxy` helper로 추출
4. 여러 manager 묶는 흐름 → use-case로 분리

helper 예: `proxy.user.findOwner(...)`, `proxy.join.verifyJoin(...)`, `proxy.chat.makeChat(...)`, `proxy.connection.asModelId(...)`, `proxy.chat.trans.modelAsView(...)`.

helper 탐색 시 읽을 파일: `src/modules/<domain>/{proxy,model,transformer,views,api-*}.ts`

---

## §7. use-case 구현 패턴

### 7.1 계약 (`src/lib/core/index.ts`)

```ts
import type { BackendProxy } from '../../service/backend-proxy';

export type UseCase<I = any, O = any, P = void> = (
    proxy: BackendProxy,
    input: I,
    options?: P,
) => Promise<O>;

export type UseCasePool = Record<string, UseCase<any, any, any>>;
```

규칙:
- 첫 인자는 항상 `proxy`
- 둘째 인자는 business input
- 셋째 인자는 실행 옵션 (`$owner`, `useSession`, `throwable`, `current`, `validate`, `errScope`)
- Storage 접근은 `proxy.<domain>`으로만
- request body 도메인 값은 `input`, 실행 환경 값은 `options`

### 7.2 표준 예시 (`send-chat/execute.ts`)

```ts
const execute: UseCase<SendChatInput, SendChatOutput, SendChatOptions> = async (proxy, body, options) => {
    const { $owner, useSession = false, throwable = true } = options ?? {};
    const errScope = `sendChat(${body?.channelId ?? ''}/${body?.contentType ?? ''})`;

    // STEP.1 resolve owner
    const owner = $owner ?? (await proxy.user.getCurrentUser({ throwable }));
    if (!owner?.id) throw new Error(`@owner.id (string) is required - ${errScope}`);

    // STEP.2 get channel
    const $channel = await proxy.channel.get(body.channelId, false);
    if (!$channel?.id) throw new Error(`404 NOT FOUND - channel/${body.channelId} - ${errScope}`);

    // STEP.3 verify sender is member
    await proxy.join.verifyJoin($channel, owner, { throwable: true });

    // STEP.4 create chat message
    const $chat = await proxy.chat.makeChat($channel, $def, { $owner: owner, useSession });

    // STEP.5 transform to view
    return proxy.chat.trans.modelAsView({ ...$chat, channel$: $channel, owner$: owner });
};
```

작성 기준:
- 파일 1개 = use-case 1개
- 단계는 `STEP.1`부터 순서대로. validation/normalization은 `STEP.0`
- 에러 메시지에 `errScope` 포함 → spec 회귀 검증 용이
- 흐름이 한눈에: owner 해소 → 존재 → 권한 → mutation → view
- side effect / non-goal은 파일 상단 JSDoc에 짧게

### 7.3 Pool 등록 (`src/lib/<domain>/index.ts`)

```ts
import type { UseCasePool } from '../core';
import sendChat from './send-chat/execute';

export type { SendChatInput, SendChatOutput } from './send-chat/types';

export interface ChatUseCasePool extends UseCasePool {
    sendChat: typeof sendChat;
}

export const chatUseCases: ChatUseCasePool = { sendChat };
```

### 7.4 BackendProxy에 노출

```ts
import { chatUseCases, ChatUseCasePool } from '../lib/chats';

export class BackendProxy extends MyCoreProxy<ModelType, BackendService> {
    public readonly chat: ChatManagerProxy;
    public readonly _chat: ChatUseCasePool;

    public constructor(context: NextContext, service: BackendService) {
        super(context, service);
        this.chat = new ChatManagerProxy(this, service.$chat);
        this._chat = chatUseCases;
    }
}
```

규칙:
- pool 필드는 `_<domain>` (예: `_chat`, `_socket`, `_billing`)
- manager-proxy(`chat`)와 use-case pool(`_chat`)을 다른 이름으로 구분
- pool은 stateless. 요청별 상태는 `proxy/input/options`로 전달

### 7.5 직접 import (예외 경로)

```ts
import * as $sockets from '../../lib/sockets';

protected findConnection(proxy: BackendProxy, event: SocketEvent): Promise<any> {
    return $sockets.findConnectionModel(proxy, { event }, { validate: true, useSession: false });
}
```

→ 허용 조건은 §3.3 참고.

### 7.6 API/Handler 패턴

```ts
return this.service.guardProxy($ctx, async proxy => {
    const $owner = await proxy.user.findOwner({ isLocal, userId, errScope });
    return proxy._chat.sendChat(proxy, $body, { $owner, useSession: true });
});
```

- API/handler에 두는 것: parsing, normalization, entrypoint 정책, `guardProxy()` 시작, use-case 호출
- API/handler에 두지 않는 것: 긴 business flow, model mutation 상세, atomic helper, 반복 권한/존재 검증

---

## §8. 테스트 규칙

- use-case마다 `execute.spec.ts` 또는 `<use-case>.spec.ts`
- 커버: input validation, 주요 성공, 핵심 실패, 저장 반영
- error string은 `GETERR` 같은 헬퍼로 고정 검증
- `guardProxy()` 안에서 변경한 내용은 callback 이후 `service.$<domain>.find/retrieve`로 확인
- 기존 `BackendProxy` 메서드를 추출했다면 기존 통합 spec 유지 (회귀 방지)

---

## §9. Do / Don't

| Do | Don't |
|---|---|
| 새 기능 비즈니스 로직은 `src/lib/<domain>` use-case로 구현 | 새 기능 흐름을 `proxy.md`/`src/modules/<domain>/proxy.ts`에 구현 |
| `guardProxy()` 안 작업은 `proxy.*`로 | `guardProxy()` 안에서 `service.$<domain>`로 중간 상태 확인 |
| use-case는 `(proxy, input, options?)` 시그니처 | use-case 안에서 새 `BackendService` 생성 |
| model 필드는 `modules/<domain>/model.ts` 기준 | request body를 model 필드로 가정 |
| 여러 manager 조합은 `src/lib/<domain>` | `api-*.ts`에 긴 business flow 작성 |
| atomic helper는 `ManagerProxy` | 같은 mutation 로직을 use-case마다 복사 |
| pool은 `_<domain>`으로 노출 | manager-proxy와 같은 이름으로 pool 노출 |
| `options`에는 실행 주입값만 | `options`에 business input 필드 섞기 |

### 자기검증 체크리스트 (LAST 게이트)

- [ ] SPEC.md의 모든 시나리오가 spec에서 통과하는가?
- [ ] 새 기능 비즈니스 로직이 `src/lib/<domain>` use-case에 있는가?
- [ ] `guardProxy()` 내부 작업을 `proxy.*`로만 하고 있는가?
- [ ] use-case 시그니처가 `(proxy, input, options?)`인가?
- [ ] controller가 business flow를 직접 나열하지 않는가?
- [ ] atomic helper가 `ManagerProxy`에 있는가?
- [ ] pool은 `_<domain>`으로 노출하는가?
- [ ] `options`에 비즈니스 입력값이 섞여 있지 않은가?
- [ ] 저장 결과를 `guardProxy()` 종료 후 `service.$<domain>.find/retrieve`로 확인했는가?

위반 항목이 있으면 해당 STEP으로 돌아가 수정 후 spec 재실행.

---

## §10. Core 개념 요약

- `BackendService`는 모델 manager를 소유한다.
- `BackendProxy`는 요청 컨텍스트와 함께 각 manager의 proxy를 묶는다.
- 비즈니스 로직과 Storage 갱신은 `guardProxy()` 내부에서 처리한다.
- `guardProxy()` 종료 시 변경사항이 Storage에 반영된다.
- 여러 manager를 조합하는 반복 업무는 `src/lib/<domain>/` use-case로 분리한다.
- API/handler는 request 정규화와 `guardProxy()` 시작만 담당한다.

---

## §11. Task → Section 빠른 룩업

| 하려는 일 | 보는 곳 |
|---|---|
| 새 use-case 만들기 | §2 STEP 4~6, §7.1~7.2 |
| `get/set/inc` 어떤 걸 쓸지 | §6.1 |
| 코드 위치 결정 (proxy vs use-case) | §3.1, STEP 3 |
| Pool에 등록할지 직접 import할지 | §3.3 |
| Pool 등록 코드 형태 | §7.3, §7.4 |
| 테스트 케이스 빠짐 검사 | §8, STEP 7 |
| 리뷰/PR 자기검증 | §9 체크리스트 |
| guardProxy 동작 원리 | §4 guardProxy(), §5 |
| 도메인 helper 어디서 찾나 | §6.5 |

---

## §A. 프로젝트 구조 템플릿

```sh
src/
├── service/
│   ├── backend-service.ts      # BackendService: manager 소유, guardProxy 제공
│   └── backend-proxy.ts        # BackendProxy: 요청 단위 proxy + use-case pool
├── modules/
│   └── <domain>/
│       ├── api-<resource>.ts   # API/controller
│       ├── model.ts            # model 필드 source of truth
│       ├── proxy.ts            # ManagerProxy
│       ├── service.ts          # domain service 또는 helper
│       ├── transformer.ts      # request/view 변환
│       └── views.ts            # 응답 view 기준
└── lib/
    ├── core/
    │   └── index.ts            # UseCase 공통 타입
    └── <domain>/
        ├── README.md 또는 SPEC.md
        ├── index.ts
        └── <use-case>.ts 또는 <use-case>/execute.ts
```

평평한 구조 (간단한 use-case):
```sh
src/lib/sockets/
├── README.md
├── index.ts
├── types.ts
├── find-connection-model.ts
└── find-connection-model.spec.ts
```

폴더 구조 (use-case가 늘어날 때):
```sh
src/lib/chats/
├── SPEC.md
├── index.ts
└── send-chat/
    ├── types.ts
    ├── execute.ts
    └── execute.spec.ts
```

---

## §B. Reference Mapping

| 패턴 | 위치 | 읽을 포인트 |
|---|---|---|
| 원본 proxy 실행 모델 | `chatic-sockets-api/docs/backend-service-proxy.md` | `BackendService`, `BackendProxy`, `ManagerProxy`, `guardProxy()` 기본 |
| 직접 import형 use-case | `chatic-sockets-api/src/lib/sockets` | `findConnectionModel(proxy, { event }, options)` |
| Pool 포함형 use-case | `chatic-socials-api/src/lib/chats` | `chatUseCases`를 `BackendProxy._chat`에 할당 후 API에서 호출 |

---

## §C. 완료 기준 (DEFINITION OF DONE)

- [ ] 새 기능이 `guardProxy()` 실행 경계 안에서 동작
- [ ] 새 기능 비즈니스 로직이 `src/lib/<domain>` use-case 모듈에 구현됨
- [ ] Storage 접근은 `proxy.<domain>`으로 수행
- [ ] 반복 비즈니스 흐름은 `src/lib/<domain>` use-case로 분리
- [ ] `src/modules/<domain>/api-*.ts`는 request 정규화 + use-case 호출 중심으로 얇음
- [ ] 반복 사용 pool은 `BackendProxy`에 `_<domain>`으로 포함
- [ ] use-case input/output/options 타입이 가까운 파일에 존재
- [ ] 단위 spec과 필요한 통합 spec 통과
