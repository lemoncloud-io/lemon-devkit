# lemon-fields

작성자: Claire <claire@lemoncloud.io>

`lemon-fields`는 `ts-transformer-keys`의 `keys<T>()`를 generated registry 방식으로 옮기는 도구이다.

기존 방식:

```ts
import { keys } from 'ts-transformer-keys';

export const USER_FIELDS = keys<UserModel>();
```

변경 후:

```ts
import { fieldKeys } from './generated/field-registry';

export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

- `migrate`: 기존 `keys<T>()` 호출을 `fieldKeys.<name><T>()`로 바꾼다.
- `gen`: TypeScript checker로 `<T>`의 field 목록을 읽고 `src/generated/field-registry.ts`를 만든다.
- `--check`: generated registry가 최신인지 CI에서 확인한다.
- `guard-common`: transformer spec의 `checkAllKeys` 안에 공통 모델 필드 검증을 삽입/갱신한다.
- runtime에서는 transformer 없이 generated TypeScript 파일만 사용한다.

## 빠른 시작

### 1. 설치

```sh
npm i --save-dev lemon-devkit
```

### 2. 먼저 변경될 내용을 확인

```sh
npx lemon-fields migrate --dry-run --report --update-tsconfig
```

이 명령은 source를 쓰지 않는다. 어떤 `keys<T>()`가 어떤 `fieldKeys.<name><T>()`로 바뀔지만 확인한다.

### 3. migration 적용

```sh
npx lemon-fields migrate --report --update-tsconfig
```

이 단계에서 기존 코드가 아래처럼 바뀐다.

```ts
// before
export const USER_FIELDS = keys<UserModel>();

// after
export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

`--update-tsconfig`를 함께 쓰면 migration 완료 후 `ts-transformer-keys/transformer` plugin도 제거한다.

### 4. registry 생성

```sh
npx lemon-fields gen --report
```

생성되는 파일은 기본적으로 아래 위치이다.

```txt
src/generated/field-registry.ts
```

생성 결과는 이런 형태이다.

```ts
export const fieldKeys = {
    userModel: <T extends object>() =>
        ["id", "name"] as Array<Extract<keyof T, string>>,
} as const;
```

### 5. 최신 상태 확인

```sh
npx lemon-fields --check
```

generated registry가 source와 다르면 exit code `1`로 실패한다. CI에서는 이 명령을 쓰면 된다.

### 6. test watch 전에 공통필드 guard 실행

```sh
npx lemon-fields guard-common --report
```

이 명령은 `src/**/*.spec.ts`에서 `checkAllKeys`를 찾고, 공통필드 검증 블록이 없으면 자동으로 넣는다.
`fieldKeys` base는 registry 기준으로 맞춘다.

개발자는 보통 `test:watch` 앞에 붙여두면 된다.

```json
{
  "scripts": {
    "test:watch": "lemon-fields guard-common && LS=1 jest --config=jest.config.json --watchAll"
  }
}
```

처음 실행하면 필요한 spec 파일이 업데이트된다.

```txt
[lemon-fields] guard-common — 3 guard(s), 3 file(s) updated.
```

이미 guard가 있으면 아무 파일도 고치지 않고 바로 test watch로 넘어간다.

```txt
[lemon-fields] guard-common — 0 guard(s), 0 file(s) updated.
```

`$` 포함 여부는 spec의 base field 변수에서 자동 판별한다. `CORE_FIELDS`를 쓰면 `$`를 포함하고, `['meta']`처럼 `$`가 없는 base를 쓰면 `$`를 제외한다. `_id` 필터도 감지한다.

## package.json 예시

```json
{
  "scripts": {
    "fields:migrate": "lemon-fields migrate --report --update-tsconfig",
    "fields:gen": "lemon-fields gen --report",
    "fields:check": "lemon-fields --check",
    "fields:guard-common": "lemon-fields guard-common --report",
    "test:watch": "lemon-fields guard-common && LS=1 jest --config=jest.config.json --watchAll",
    "build": "npm run fields:gen && tsc"
  }
}
```

`src/generated/field-registry.ts`는 source와 함께 commit 하는 것을 권장한다. 이 파일은 build 산출물처럼 보이지만, 실제 source가 import해서 사용하는 코드이다.

## 이후 개발할 때

새로운 field list가 필요하면 개발자가 직접 `fieldKeys.<name><T>()` 호출을 추가한다.

```ts
import { fieldKeys } from '../generated/field-registry';

export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

여기서 `userModel`이 registry key이다. `gen`은 이 이름을 다시 계산하지 않고 그대로 보존한다.

이름을 바꾸고 싶으면 generated 파일을 고치지 않는다. 호출 위치의 key를 바꾸고 다시 `gen`을 실행한다.

```ts
export const USER_FIELDS = fieldKeys.publicUser<UserModel>();
```

```sh
npx lemon-fields gen
```

## 이름 충돌 규칙

### `export const` 이름과 registry key는 별개

아래 코드에는 이름이 두 개 있다.

```ts
export const USER_FIELDS = fieldKeys.userModel<UserModel>();
//           ^^^^^^^^^^^               ^^^^^^^^^
//           TypeScript export 이름     lemon-fields registry key
```

`USER_FIELDS`는 TypeScript module export 이름이다. 파일이 다르면 같은 이름을 써도 바로 충돌하지 않는다.

```ts
// src/a.ts
export const USER_FIELDS = fieldKeys.userModel<UserModel>();

// src/b.ts
export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

다만 한 파일에서 둘 다 import 하거나 barrel export로 묶으면 TypeScript 일반 규칙에 따라 alias가 필요할 수 있다.

```ts
import { USER_FIELDS as A_USER_FIELDS } from './a';
import { USER_FIELDS as B_USER_FIELDS } from './b';
```

### registry key는 전역으로 본다

`fieldKeys.userModel`의 `userModel`은 generated registry의 key이다. 서로 다른 파일의 `UserModel`이 이름만 같아도 field 목록이 다르면 `gen`이 실패한다.

```ts
// src/a.ts
interface UserModel {
    id: string;
    name: string;
}
export const USER_FIELDS = fieldKeys.userModel<UserModel>();

// src/b.ts
interface UserModel {
    id: string;
    email: string;
}
export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

이 경우 `userModel` key가 서로 다른 field 목록을 가리키므로 모호하다.

```txt
duplicate registry name `userModel` with divergent field sets:
  - src/a.ts :: UserModel -> [id, name]
  - src/b.ts :: UserModel -> [id, email]
Hand-edit one of the call sites to a distinct name.
```

호출 위치의 key를 직접 분리한다.

```ts
// src/a.ts
export const USER_FIELDS = fieldKeys.adminUserModel<UserModel>();

// src/b.ts
export const USER_FIELDS = fieldKeys.customerUserModel<UserModel>();
```

같은 key가 같은 field 목록을 가리키는 것은 허용한다. 같은 field list를 여러 파일에서 같은 이름으로 재사용하는 경우는 모호하지 않기 때문이다.

## 실제 실행 예시: lemon-templates-api

아래는 `lemon-templates-api`에 local tarball을 설치하고 실제로 실행한 결과를 줄인 예시이다.

### 설치 확인

```sh
$ npm ls lemon-devkit typescript --depth=0
lemon-templates-api@0.26.215
├── lemon-devkit@0.0.9
└── typescript@4.7.4
```

`lemon-devkit`만 교체되고 consumer project의 TypeScript `4.7.4`는 유지되었다.

### migration dry-run

```sh
$ ./node_modules/.bin/lemon-fields migrate --dry-run --report --update-tsconfig
[lemon-fields] [dry-run] migrate — rewrote 15 site(s), 9 file(s).
  src/cores/abstract-services.spec.ts  keys<TestModel>() -> fieldKeys.testModel<TestModel>()
  src/cores/abstract-services.ts  keys<CoreModel>() -> fieldKeys.coreModel<CoreModel>()
  src/view/transformer.spec.ts  keys<Model>() -> fieldKeys.viewTransformerModel<Model>()
  src/modules/callback/model.ts  keys<CallbackHead>() -> fieldKeys.callbackHead<CallbackHead>()
  src/modules/callback/model.ts  keys<CallbackModel>() -> fieldKeys.callbackModel<CallbackModel>()
  src/modules/mock/model.ts  keys<MockModel>() -> fieldKeys.mockModel<MockModel>()
  src/modules/mock/model.ts  keys<TestModel>() -> fieldKeys.mockTestModel<TestModel>()
  src/modules/search/model.ts  keys<SearchModel>() -> fieldKeys.searchModel<SearchModel>()
  src/modules/search/model.ts  keys<SearchQueryModel>() -> fieldKeys.searchQueryModel<SearchQueryModel>()
  src/modules/search/model.ts  keys<SearchBatchModel>() -> fieldKeys.searchBatchModel<SearchBatchModel>()
[lemon-fields] would update tsconfig: removed ts-transformer-keys transformer plugin.
```

전체 결과는 15개 호출, 9개 파일이었다. 위 예시는 핵심 위치만 발췌했다.

`src/modules/mock/model.ts`의 `MockModel`은 `mockModel`로 생성된다. `Model`처럼 일반적인 이름도 path context가 이미 `model`로 끝나면 `mockModelModel`처럼 중복 suffix를 만들지 않는다.

### migration 적용

```sh
$ ./node_modules/.bin/lemon-fields migrate --report --update-tsconfig
[lemon-fields] migrate — rewrote 15 site(s), 9 file(s); wrote bootstrap stub.
[lemon-fields] updated tsconfig: removed ts-transformer-keys transformer plugin.
```

### registry 생성과 report

```sh
$ ./node_modules/.bin/lemon-fields gen --report
[lemon-fields] gen — 15 entries, wrote src/generated/field-registry.ts
[lemon-fields] report — 15 generated entries:
  callbackHead  src/modules/callback/model.ts#CallbackHead  fields(3): id, stereo, name
  callbackModel  src/modules/callback/model.ts#CallbackModel  fields(33): id, stereo, name, domain, clientIp, userAgent, state, parentId, parent$, no, target, qid, handler, result, requestedAt, responsedAt, $request, meta, hidden, optional, $, ns, type, sid, uid, gid, lock, next, createdAt, updatedAt, deletedAt, error, _id
  coreModel  src/cores/abstract-services.ts#CoreModel  fields(16): $, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error, id, _id
  mockModel  src/modules/mock/model.ts#MockModel  fields(18): name, aliasId, meta, id, $, ns, type, stereo, sid, uid, gid, lock, next, createdAt, updatedAt, deletedAt, error, _id
  mockTestModel  src/modules/mock/model.ts#TestModel  fields(23): name, count, extra, Model, $identity, $, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error, id, _id, _idx, _date
  searchModel  src/modules/search/model.ts#SearchModel  fields(17): id, name, $, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error, _id
  testModel  src/cores/abstract-services.spec.ts#TestModel  fields(21): name, test, extra, Model, $identity, $, ns, type, stereo, sid, uid, gid, lock, next, meta, createdAt, updatedAt, deletedAt, error, id, _id
```

`gen --report`는 generated registry를 열어보지 않아도 key, source 위치, type, field 목록을 바로 확인하기 위한 옵션이다.

출력이 길면 필요한 key만 확인하면 된다.

```sh
$ ./node_modules/.bin/lemon-fields gen --report | grep mockModel
  mockModel  src/modules/mock/model.ts#MockModel  fields(18): name, aliasId, meta, id, $, ns, type, stereo, sid, uid, gid, lock, next, createdAt, updatedAt, deletedAt, error, _id
```

### 최신 상태와 build 확인

```sh
$ ./node_modules/.bin/lemon-fields --check
[lemon-fields] ok — 15 entries up-to-date.

$ npm run build-ts
> lemon-templates-api@0.26.215 build-ts
> ttsc
```

위 project에서는 migration 후 `build-ts`가 통과했다. 일부 service spec 실패가 있었지만, field migration과 직접 관련된 transformer/mock/callback/view spec은 통과했다.

### common field guard 적용

```sh
$ ./node_modules/.bin/lemon-fields guard-common --dry-run --diff --report
[lemon-fields] [dry-run] guard-common — 3 guard(s), 3 file(s).
  src/view/transformer.spec.ts  checkAllKeys  $mock inserted: id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt
  src/modules/callback/transformer.spec.ts  checkAllKeys  $temp inserted: id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt
  src/modules/mock/transformer.spec.ts  checkAllKeys  $mock inserted: id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt
```

실제 적용:

```sh
$ ./node_modules/.bin/lemon-fields guard-common --report
[lemon-fields] guard-common — 3 guard(s), 3 file(s) updated.

$ ./node_modules/.bin/lemon-fields guard-common --report
[lemon-fields] guard-common — 0 guard(s), 0 file(s) updated.
```

삽입되는 guard는 기존 `notInModel`, `keys`, `alls`, `return` 로직을 바꾸지 않고 `checkAllKeys` 맨 앞에 들어간다.

```ts
const commons = fields.reduce<string[]>((L, a) => {
    if ($mock.includes(a)) L.push(a);
    return L;
}, []);
expect2(() => $mock?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
    'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
);
expect2(() => commons?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(
    'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt',
);
```

## CLI 옵션

공통 옵션:

- `--tsconfig <path>`: 기본값 `tsconfig.json`
- `--out <path>`: 기본값 `src/generated/field-registry.ts`
- `--include-spec`: spec 파일 포함. 기본값 true
- `--no-include-spec`: spec 파일 제외
- `--paths <glob>`: scan 대상 파일만 제한. 타입 해석 context는 전체 project를 유지

`gen` 옵션:

- `--check`: 파일을 쓰지 않고 drift 여부만 검사
- `--report`: 생성된 registry key, source 위치, field 목록 출력
- `--allow-legacy`: migration 중 남은 `keys<T>()`를 임시로 허용
- `--allow-empty`: 호출 위치가 없어도 실패하지 않고 bootstrap stub 생성

`migrate` 옵션:

- `--dry-run`: source/stub을 쓰지 않고 결과만 계산
- `--diff`: 변경될 source diff 출력. 보통 `--dry-run`과 함께 사용
- `--allow-skips`: 자동 처리 불가 위치를 실패 대신 skipped로 보고
- `--update-tsconfig`: 전체 migration 완료 후 `ts-transformer-keys/transformer` plugin 제거
- `--report`: rewrite 결과 요약 출력

`guard-common` 옵션:

- `--dry-run`: source를 쓰지 않고 삽입/갱신 결과만 계산
- `--diff`: 변경될 source diff 출력. 보통 `--dry-run`과 함께 사용
- `--paths <glob>`: 특정 spec 파일만 대상으로 제한
- `--target <name>`: 기본값 `checkAllKeys`
- `--report`: 삽입/갱신된 guard 위치와 expected 문자열 출력
- `--out <path>`: registry 기준 field 확인

## Common field guard

`guard-common`은 개발자가 `test:watch`를 실행할 때 transformer spec의 공통필드 검증을 자동으로 맞춰주는 명령이다.

기본 사용법:

```sh
npx lemon-fields guard-common --report
```

보통은 `package.json`의 `test:watch` 앞에 붙인다.

```json
{
  "scripts": {
    "test:watch": "lemon-fields guard-common && LS=1 jest --config=jest.config.json --watchAll"
  }
}
```

이렇게 해두면 동작은 단순하다.

- guard가 없으면 최초 1회 spec 파일에 자동 삽입
- guard가 이미 맞으면 no-op
- expected가 다르면 자동 갱신
- 그 다음 기존 `jest --watchAll` 실행

### `$` 포함 여부

개발자가 `$` 포함 여부를 직접 맞출 필요는 없다. `guard-common`이 현재 spec의 base field 변수를 보고 expected 문자열을 고른다.
`fieldKeys` base는 registry field를 사용한다.

예를 들어 `CORE_FIELDS`를 base로 쓰는 경우는 `$`를 포함한다.

```ts
const $node = filterFields(keys<Model>(), CORE_FIELDS);
```

삽입되는 expected:

```txt
$,id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt
```

반대로 `['meta']`처럼 `$`가 없는 base를 쓰면 `$`를 제외한다.

```ts
const $mock = filterFields(keys<Model>(), ['meta']);
const $temp = filterFields(keys<Model>(), ['meta']);
```

삽입되는 expected:

```txt
id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt
```

즉 repo마다 `$` 포함 여부를 사람이 맞추지 않아도 된다.
`filterFields(... _id 제외)`도 반영한다.

### test:watch에 연결

watch 시작 전에 한 번 실행하면 된다.

```json
{
  "scripts": {
    "test:watch": "lemon-fields guard-common && LS=1 jest --config=jest.config.json --watchAll"
  }
}
```

처음 실행하면 필요한 spec 파일을 고친다.

```txt
[lemon-fields] guard-common — 8 guard(s), 8 file(s) updated.
```

이후 실행은 no-op이다.

```txt
[lemon-fields] guard-common — 0 guard(s), 0 file(s) updated.
```

## 주의사항

### generated registry는 commit 필요

`src/generated/field-registry.ts`는 source와 함께 commit 한다.

이 파일이 없으면 아래 import가 깨진다.

```ts
import { fieldKeys } from './generated/field-registry';
```

CI에서는 아래 명령으로 최신 상태인지 확인한다.

```sh
npm run fields:check
```

### generic parameter는 자동 migration 대상이 아니다

아래 코드의 `T`는 실제 모델이 아니라 함수의 generic parameter이다.

```ts
import { keys } from 'ts-transformer-keys';

export function fieldsOf<T>() {
    return keys<T>();
}
```

`lemon-fields`는 build 전에 concrete field 목록을 파일로 써야 한다. 그런데 위 코드의 `T`는 호출될 때마다 달라질 수 있어서 field 목록을 확정할 수 없다.

이런 코드는 모델별 concrete 호출로 바꾼다.

```ts
export const USER_FIELDS = fieldKeys.userModel<UserModel>();
export const POST_FIELDS = fieldKeys.postModel<PostModel>();
```

자동 처리할 수 없는 위치를 보고만 받고 싶다면 아래 옵션을 쓴다.

```sh
npx lemon-fields migrate --allow-skips --report
```

### `--allow-legacy`는 임시 옵션이다

기본적으로 `gen`은 legacy `keys<T>()`가 남아 있으면 실패한다.

```ts
import { keys } from 'ts-transformer-keys';

export const USER_FIELDS = keys<UserModel>();
```

마이그레이션을 한 번에 끝내기 어려울 때만 임시로 허용할 수 있다.

```sh
npx lemon-fields gen --allow-legacy
```

다만 이 모드는 남아있는 `keys<T>()`의 이름을 그때그때 derive 한다. 최종 상태에서는 source에 이름이 고정되는 아래 형태가 더 안전하다.

```ts
import { fieldKeys } from './generated/field-registry';

export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

### property가 0개인 타입도 `[]`로 생성한다

`ts-transformer-keys`와 맞추기 위해 property가 0개인 타입은 skipped로 버리지 않고 빈 배열로 materialise 한다.

```ts
export const EMPTY = fieldKeys.empty<{}>();
export const UNION = fieldKeys.union<A | B>();
export const RECORD = fieldKeys.record<Record<string, unknown>>();
```

위와 같은 호출은 모두 generated registry에 `[]`로 기록된다.

실패로 보는 경우는 property가 0개인 상황이 아니라, TypeScript checker가 property 이름을 안정적으로 materialise 하지 못한 경우이다.

### 생성 실패/누락 케이스

| 케이스 이름 | 케이스 간단 설명 | error / throw 여부 | 예시 코드 |
| --- | --- | --- | --- |
| legacy leftover | 아직 `keys<T>()`가 남아 있으면 `gen`이 실패한다. 먼저 `migrate`를 돌린다. | `기본값: throw`<br/>`--allow-legacy: 허용` | `const FIELDS = keys<User>();` |
| divergent registry key | 같은 `fieldKeys.<name>`이 서로 다른 field set을 가리키면 실패한다. 이름을 분리해야 한다. | `throw` | `fieldKeys.userModel<User>();`<br/>`fieldKeys.userModel<UserSummary>();` |
| materialise failure | checker가 타입 property를 확정하지 못하면 실패한다. 타입을 더 구체적으로 만든다. | `throw` | `fieldKeys.userModel<T>();` |
| empty scan | scan 범위에 callsite가 하나도 없으면 실패한다. `--paths`와 `tsconfig`를 확인한다. | `기본값: throw`<br/>`--allow-empty: 허용` | `npx lemon-fields gen --paths 'src/user/**/*.ts'` |
| partial generation by `--paths` | 실패는 아니지만 일부 key만 생성된다. 최종 생성/CI에는 쓰지 않는다. | `throw 없음` | `npx lemon-fields gen --paths 'src/user/**/*.ts'` |
| scan blind spot | alias/wrapper 호출은 누락될 수 있다. 직접 호출만 안전하다. | `보통 throw 없음`<br/>`전체 누락 시 empty scan throw 가능` | `const fk = fieldKeys;`<br/>`fk.userModel<User>();` |

직접 호출만 안정적으로 scan 된다.

```ts
import { fieldKeys } from './generated/field-registry';

export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

다음 케이스들은 실패가 아니라 정상 동작이며 `[]`로 생성된다.

| 케이스 이름 | 케이스 간단 설명 | error / throw 여부 | 예시 코드 |
| --- | --- | --- | --- |
| empty object | property가 0개인 타입은 실패가 아니라 `[]`로 생성된다. | `throw 없음` | `fieldKeys.empty<{}>()` |
| union | 결과 property가 0개면 실패가 아니라 `[]`로 생성된다. | `throw 없음` | `fieldKeys.union<A | B>()` |
| record | key가 동적인 record도 실패가 아니라 `[]`로 생성된다. | `throw 없음` | `fieldKeys.record<Record<string, unknown>>()` |

### `--paths`는 scan 대상만 줄인다

`--paths`는 “어느 파일에서 `fieldKeys.<name>()` 호출을 찾을지”만 제한한다.

```sh
npx lemon-fields gen --paths 'src/modules/user/**/*.ts'
```

타입 해석에는 imported model/source가 계속 필요하다.

```ts
import { UserModel } from '../../models/user-model';

export const USER_FIELDS = fieldKeys.userModel<UserModel>();
```

위 코드를 스캔하려면 `src/modules/user/**/*.ts`만 지정해도 된다. 하지만 `UserModel`이 정의된 파일은 `tsconfig.json`의 `include` 안에 있어야 한다.

```json
{
  "include": ["src/**/*"]
}
```

즉 `--paths`는 작업 범위를 줄이는 옵션이고, TypeScript project 자체를 줄이는 옵션은 아니다.

### `--update-tsconfig`는 전체 migration 때만 사용

`ts-transformer-keys` 호출이 모두 `fieldKeys.<name>()`로 바뀌면 transformer plugin은 더 이상 필요하지 않다.

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "transform": "ts-transformer-keys/transformer"
      }
    ]
  }
}
```

전체 migration을 끝낸 뒤 아래처럼 정리한다.

```sh
npx lemon-fields migrate --update-tsconfig --report
```

`--update-tsconfig`는 `--paths`와 함께 쓰지 않는다. 일부 파일만 migration 한 상태에서 transformer plugin을 제거하면 아직 남아 있는 `keys<T>()` 호출이 깨질 수 있기 때문이다.

### TypeScript version

`lemon-fields`는 consumer project의 TypeScript checker를 사용한다.

`lemon-devkit`은 TypeScript `>=4.7 <6` 범위를 허용하므로, 기존 project가 쓰던 TypeScript version을 가능하면 그대로 유지한다.

## 어디서 무엇을 검사하나

쉽게 말해, 검사는 4번 한다.

| 단계 | 도구 | 무엇을 잡나 |
|---|---|---|
| Dev | `gen --report` | 생성 결과를 사람이 눈으로 확인 |
| CI | `gen --check` | source는 바뀌었는데 `gen`을 안 돌린 상태 |
| Runtime | `assertFieldRegistry` | 이미 생성된 registry 파일 손상/누락 |
| Spec | `guard-common` | transformer spec의 common field guard 누락 |

짧게 정리하면:

- `gen --report`: 사람이 눈으로 확인
- `gen --check`: CI가 `gen` 누락을 자동으로 차단
- `assertFieldRegistry`: 실행 중에 generated file 손상 여부 확인
- `guard-common`: spec의 `checkAllKeys`에 공통필드 검증이 없으면 자동 삽입

## 앱 시작 시 registry 검사

쉽게 말해, generated registry 파일이 안 깨졌는지 실행 초기에 한 번 확인하는 기능이다.

여기서 "앱 시작"은 보통 아래를 뜻한다.

- 일반 Node 서버: `app.listen()` 전
- Lambda: cold start 시점, 즉 `handler` 바깥

> **처음 켤 때**: `lemon-fields gen`을 한 번 다시 실행해야 한다. 예전 형식 registry에는 `fieldRegistryMeta`가 없어 `META_MISSING`이 날 수 있다.

`assertFieldRegistry`는 위 초기화 구간에서 한 번만 호출한다.

```ts
import { fieldKeys, fieldRegistryMeta } from './generated/field-registry';
import { assertFieldRegistry } from 'lemon-devkit';

// 서버 시작 전 / Lambda cold start 시점에 1번
assertFieldRegistry({ fieldKeys, fieldRegistryMeta });
```

`fieldRegistryMeta` 안의 핵심 값은 아래 3개다.

- `kind`: 이 파일이 임시 stub인지, 실제 생성 완료본인지
- `entryCount`: `fieldKeys` 안에 entry가 몇 개인지
- `checksum`: entry 이름과 field 목록 내용이 안 바뀌었는지

이 검사가 잡는 것:

- bootstrap stub을 그대로 commit한 경우
- `fieldRegistryMeta`가 없거나 깨진 경우
- generated file을 손으로 수정한 경우
- entry 함수가 깨진 경우

이 검사가 못 잡는 것은 하나다:

- source를 바꿨는데 `lemon-fields gen`을 다시 안 돌린 경우

이 경우는 CI의 `gen --check`가 잡는다.

예시 에러:

```txt
field registry validation failed:
  [CHECKSUM_MISMATCH] registry checksum does not match meta.checksum
```

### Runtime 오류 코드

자주 보게 될 코드는 아래 4개다.

| Code | 의미 |
|---|---|
| `META_MISSING` | `fieldRegistryMeta`가 없거나 shape가 잘못됨 |
| `BOOTSTRAP_STUB` | 아직 임시 stub 파일 상태라 `gen`이 더 필요함 |
| `ENTRY_COUNT_MISMATCH` | entry 개수가 맞지 않음 |
| `CHECKSUM_MISMATCH` | entry 내용이 손상되었거나 수동 수정됨 |

그 외 코드:

- `UNSUPPORTED_SCHEMA`: registry 형식 버전이 맞지 않음
- `NON_FUNCTION_ENTRY`: entry가 함수가 아님
- `ENTRY_EVAL_FAILED`: entry 함수 실행 중 에러
- `INVALID_FIELD_LIST`: entry가 `string[]`를 반환하지 않음
- `EMPTY_CONCRETE_REGISTRY`: concrete registry인데 entry가 0개

참고:

- field 하나만 손으로 지우면 보통 `CHECKSUM_MISMATCH`
- entry 하나를 통째로 지우면 `ENTRY_COUNT_MISMATCH`와 `CHECKSUM_MISMATCH`가 같이 날 수 있다

문제 목록만 받고 싶으면 `validateFieldRegistry()`를 쓰고, 문제 있으면 바로 실패시키고 싶으면 `assertFieldRegistry()`를 쓴다.

```ts
import { validateFieldRegistry } from 'lemon-devkit';

const result = validateFieldRegistry({ fieldKeys, fieldRegistryMeta });

if (!result.ok) {
    console.log(result.issues);
}
```

## 왜 예전에는 `ttsc`가 필요했나

예전 방식은 build할 때 특별한 변환기가 필요했다.

```ts
const FIELDS = keys<User>();
```

이 코드는 build 중에 transformer가 `keys<User>()`를 실제 field 목록으로 바꿔줘야 한다. 그래서 plain `tsc`만으로는 부족했고 `ttsc` 같은 도구가 필요했다.

지금 방식은 `gen`이 결과를 미리 generated file로 만들어 둔다.

```ts
const FIELDS = fieldKeys.user<User>();
```

쉽게 말해:

- 예전: build할 때 field 목록을 계산
- 지금: `gen` 할 때 한 번 계산해서 파일로 저장

그래서 migration이 끝나면 runtime과 build에서는 plain `tsc`로 충분하다.

### Migration 단계별 상태

| 단계 | 코드 모습 | 추가 도구 | 한 줄 설명 |
|---|---|---|---|
| Before migration | `keys<User>()` | `ttsc` 필요 | 아직 예전 방식 |
| During migration | `keys<User>()` + `fieldKeys.user<User>()` 혼용 | `ttsc` 유지 | 옮기는 중 |
| After migration | `fieldKeys.user<User>()` + generated registry | 불필요 | plain `tsc`만 쓰면 됨 |

### 언제 `ttsc`를 제거해도 되나

다음 4개가 모두 맞으면 `ttsc`·`ttypescript`·`ts-transformer-keys/transformer`를 제거해도 된다.

- 모든 `keys<T>()` 호출이 `fieldKeys.<name><T>()`로 바뀌었다
- `lemon-fields gen`으로 concrete registry를 commit했다
- `lemon-fields migrate --update-tsconfig`로 transformer plugin을 tsconfig에서 제거했다
- 프로젝트에 다른 custom transformer가 남아 있지 않다

예를 들어, repo 전체에서 `keys<` 검색 결과가 더 이상 없고 `gen` 결과도 커밋했다면 제거할 준비가 된 것이다.

## 자주 묻는 질문

**`compilerOptions.plugins`만 넣으면 왜 안 되나?**

`tsc`는 여기 있는 `plugins`를 IDE용으로만 보고, 실제 build 때 transformer를 실행하지 않는다. 그래서 `keys<T>()`가 변환되지 않아 보통 빈 배열이 남는다.

예:

```ts
const FIELDS = keys<User>(); // 기대: ['id', 'name'], 실제: []
```

**`--update-tsconfig` 후에도 `ttypescript`가 필요한 경우는?**

다른 custom transformer를 아직 쓰고 있으면 필요할 수 있다.

예: 같은 tsconfig에서 `ts-nameof`를 계속 쓰는 프로젝트

**`--allow-legacy`는 왜 임시 옵션인가?**

`--allow-legacy`는 migration 중에만 잠깐 쓰는 옵션이다. 이 상태에서는 이름이 임시로 만들어져 registry가 흔들릴 수 있다.

예: 같은 field 목록인데 호출 위치에 따라 다른 key 이름이 생길 수 있다.

## 검증된 동작

아래 핵심 동작은 자동 테스트로 확인했다.

- CLI 기본 동작: `--help`, 잘못된 옵션 처리
- migration 동작: `migrate --report`, `--dry-run`, `--diff`, `--update-tsconfig`
- generation 동작: `gen --report`, `gen --check`, output directory 생성
- scan 규칙: generated registry 재스캔 방지, `--paths`는 scan 대상만 줄임
- 이름 규칙: 이름 충돌 감지, `ModelModel` 같은 중복 suffix 방지
- 빈 타입 처리: property가 0개인 타입은 실패 대신 `[]` 생성
- meta/validation: `fieldRegistryMeta`, checksum, bootstrap meta 생성
- runtime validator: `assertFieldRegistry`와 `validateFieldRegistry`의 오류 검출
- common field guard: registry base, `$`, `_id` 필터를 반영하고 `checkAllKeys` guard 삽입/갱신

## 내부 파일 구조

어느 파일을 봐야 할지 빠르게 찾고 싶다면 아래만 보면 된다.

- `types.ts`: 공통 타입 모음. 옵션/반환값 shape가 궁금할 때
- `validate.ts`: runtime validator. `META_MISSING` 같은 오류 흐름을 보고 싶을 때
- `field-derive-name.ts`: registry key 이름 규칙. 자동 이름이 왜 그렇게 붙었는지 볼 때
- `field-migrate.ts`: `keys<T>()`를 `fieldKeys.<name><T>()`로 바꾸는 로직
- `field-gen.ts`: scan 후 concrete registry를 만드는 로직
- `field-guard-common.ts`: `checkAllKeys`의 common field guard를 삽입/갱신하는 로직
- `../bin/lemon-fields.ts`: CLI 시작점. `gen`, `migrate`, `--check`, `--report` 처리를 볼 때
