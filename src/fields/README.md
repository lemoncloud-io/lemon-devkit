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

## package.json 예시

```json
{
  "scripts": {
    "fields:migrate": "lemon-fields migrate --report --update-tsconfig",
    "fields:gen": "lemon-fields gen --report",
    "fields:check": "lemon-fields --check",
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

## 검증된 동작

테스트에서 확인한 내용:

- `lemon-fields --help` 출력
- 알 수 없는 flag 또는 값이 빠진 flag의 exit code `1`
- `migrate --report` 출력 형식
- `migrate --dry-run --diff --update-tsconfig`
- `gen --report` 출력 형식
- `gen --check` drift 감지와 exit code
- `--paths`가 scan 대상만 줄이고 imported model type context는 유지하는 동작
- `writeRegistry()`가 parent directory를 만들고 파일을 쓰는 동작
- npm publish 산출물에 이 README가 포함되는지 여부
- generated registry 파일 자체를 다시 scan하지 않는 동작
- 같은 registry key가 다른 field set을 가리킬 때 실패하는 동작
- `Model` 같은 generic type 이름에 path context를 붙이는 이름 생성 규칙
- path context가 이미 `model`로 끝나면 `mockModelModel`처럼 중복 suffix를 만들지 않는 규칙

## 내부 파일 구조

- `types.ts`: `GenOptions`, `GenResult`, `MigrateOptions`, `MigrateResult` 등 public contract
- `field-derive-name.ts`: legacy 호출에서 안정적인 registry 이름 생성
- `field-migrate.ts`: `keys<T>()`를 `fieldKeys.<name><T>()`로 rewrite
- `field-gen.ts`: migrated 호출을 스캔하고 concrete registry 생성
- `../bin/lemon-fields.ts`: CLI entry
