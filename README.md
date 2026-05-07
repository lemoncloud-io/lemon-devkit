# lemon-devkit

local develop kit for [lemon-core](https://github.com/lemoncloud-io/lemon-core)

## Usage

- required to install seperately `lemon-core` in advance.

```sh
# STEP.1 install `lemon-devkit`
npm i --save-dev lemon-devkit
```

----------------

## lemon-fields

`ts-transformer-keys`의 `keys<T>()`를 generated registry 방식으로 교체하는 CLI 도구이다.

- `migrate`: 기존 `keys<T>()` 호출을 `fieldKeys.<name><T>()`로 변환
- `gen`: TypeScript checker로 field 목록을 읽고 `src/generated/field-registry.ts` 생성
- `--check`: generated registry가 source와 같은지 확인
- `guard-common`: transformer spec의 `checkAllKeys` 안에 공통 모델 필드 검증 자동 삽입/갱신

### 적용 순서

#### 1. project `package.json`에 script 추가

```json
{
  "scripts": {
    "fields:migrate": "lemon-fields migrate --report --update-tsconfig",
    "fields:gen": "lemon-fields gen --report",
    "fields:check": "lemon-fields --check",
    "fields:guard-common": "lemon-fields guard-common --report"
  }
}
```

#### 2. migration 명령어 실행

```sh
npm i --save-dev lemon-devkit@0.0.12
npm run fields:migrate
npm run fields:gen
npm run fields:guard-common
```

- `npm i --save-dev lemon-devkit@0.0.12`: project에 `lemon-devkit` 0.0.12를 dev dependency로 설치
- `npm run fields:migrate`: 기존 `keys<T>()` 호출을 `fieldKeys.<name><T>()`로 변환하고 `ts-transformer-keys` transformer plugin 제거
- `npm run fields:gen`: TypeScript checker로 field 목록을 읽어 `src/generated/field-registry.ts` 생성
- `npm run fields:guard-common`: transformer spec의 `checkAllKeys`에 공통 모델 필드 검증 삽입/갱신

#### 3. test와 build에 추가

기존 project의 `build`나 `test:watch`가 이미 있으면 명령 전체를 바꾸지 말고 앞에 `npm run fields:gen &&` 또는 `npm run fields:guard-common &&`만 붙인다.

```json
{
  "scripts": {
    "build": "npm run fields:gen && tsc",
    "test:watch": "npm run fields:guard-common && LS=1 jest --config=jest.config.json --watchAll"
  }
}
```

CI에는 `npm run fields:check`를 추가하는 것을 권장한다.

`src/generated/field-registry.ts`는 source가 직접 import하는 파일이므로 commit 대상이다.

자세한 사용법은 [lemon-fields README](src/fields/README.md)를 참고한다.

----------------

## VERSION INFO

| Version   | Description
|--         |--
| 0.0.6     | optimized `loadProfile()` w/o async.
| 0.0.4     | initial release.
