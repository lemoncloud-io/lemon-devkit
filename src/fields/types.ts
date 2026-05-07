/**
 * `fields/types.ts`
 * - `lemon-fields` 마이그레이션/생성기에서 공유하는 공통 타입.
 *
 * **NOTE**
 * - `field-gen.ts`, `field-migrate.ts`, 테스트에서 같은 옵션/결과 타입을 쓰도록 분리함.
 * - 런타임 헬퍼는 각 구현 파일에 두고, 여기서는 타입만 관리한다.
 * - `ts-morph`, node API를 import 하지 않는다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 separated field public types.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

/**
 * type: `DerivationInput`
 * - legacy `keys<T>()` 호출 위치에서 registry property 이름을 만들기 위한 입력값.
 */
export interface DerivationInput {
    /** 프로젝트 기준 상대 경로. `/` 로 normalize 된 값 */
    relPath: string;
    /** generic argument 원문. ex) `UserModel`, `A & B` */
    typeArgText: string;
    /** 가장 가까운 변수/프로퍼티/함수명. 복합 타입 이름 생성에 이용됨 */
    enclosingContext?: string;
}

/**
 * type: `FieldSiteSkip`
 * - 자동 처리하지 못한 호출 위치.
 */
export interface FieldSiteSkip {
    /** 프로젝트 기준 상대 경로. `/` 로 normalize 된 값 */
    relPath: string;
    /** generic argument 원문. type arg가 없으면 빈 문자열 */
    typeArgText: string;
    /** CLI 출력용 짧은 사유 */
    reason: string;
}

/**
 * type: `FieldRewrite`
 * - `lemon-fields migrate`가 rewrite 한 legacy 호출 위치.
 */
export interface FieldRewrite {
    /** rewrite 된 프로젝트 기준 상대 경로 */
    relPath: string;
    /** source에 기록된 registry property 이름 */
    name: string;
    /** 원래 generic argument 원문 */
    typeArgText: string;
}

/**
 * type: `GenOptions`
 * - `lemon-fields gen`에서 사용하는 옵션.
 */
export interface GenOptions {
    /** tsconfig 경로. 절대경로 또는 cwd 기준 상대경로 */
    tsconfig: string;
    /** 생성할 registry 파일 경로. 절대경로 또는 cwd 기준 상대경로 */
    out: string;
    /** `*.spec.ts` 스캔 여부 */
    includeSpec: boolean;
    /** 스캔 대상 glob. 타입 해석은 전체 project를 로드한 상태로 수행함 */
    paths?: string[];
    /** 남아있는 legacy `keys<T>()`를 허용하고 임시 이름을 생성할지 여부 */
    allowLegacy: boolean;
    /** 호출 위치가 없어도 실패하지 않고 bootstrap stub을 반환할지 여부 */
    allowEmpty: boolean;
    /** 프로젝트 root. 기본값은 dirname(tsconfig) */
    cwd?: string;
}

/**
 * type: `RegistryEntry`
 * - 생성될 registry property 1개.
 */
export interface RegistryEntry {
    /** registry property 이름. migrated source에 기록된 이름을 그대로 보존함 */
    name: string;
    /** TypeScript checker가 해석한 field 이름 목록 */
    fields: string[];
    /** 호출 위치가 있는 프로젝트 기준 상대 경로 */
    relPath: string;
    /** generic argument 원문 */
    typeArgText: string;
    /** `gen --allow-legacy`로 legacy 호출에서 만들어진 entry 여부 */
    legacy: boolean;
}

/**
 * type: `GenResult`
 * - `runGen()` 실행 결과.
 */
export interface GenResult {
    /** `fieldKeys`로 render 될 concrete entry 목록 */
    entries: RegistryEntry[];
    /** 생성될 파일 전체 내용 */
    content: string;
    /** 기존 output 파일 내용. 파일이 없으면 undefined */
    existing?: string;
    /** `content !== existing` 이면 true */
    changed: boolean;
    /** 타입 property 이름을 materialise 하지 못한 호출 위치 */
    skipped: FieldSiteSkip[];
    /** 스캔 중 발견한 legacy `keys<T>()` 호출 위치 */
    legacyLeftovers: Array<Omit<FieldSiteSkip, 'reason'>>;
}

/**
 * type: `MigrateOptions`
 * - `lemon-fields migrate`에서 사용하는 옵션.
 */
export interface MigrateOptions {
    /** tsconfig 경로. 절대경로 또는 cwd 기준 상대경로 */
    tsconfig: string;
    /** 생성될 registry 파일 경로. 절대경로 또는 cwd 기준 상대경로 */
    out: string;
    /** `*.spec.ts` 스캔 여부 */
    includeSpec: boolean;
    /** 스캔 대상 glob. 타입 해석은 전체 project를 로드한 상태로 수행함 */
    paths?: string[];
    /** source 파일과 bootstrap stub을 쓰지 않고 변경 결과만 계산 */
    dryRun: boolean;
    /** 변경될 source diff를 결과에 포함할지 여부 */
    diff?: boolean;
    /** 자동 rewrite 불가 위치를 throw 대신 skipped로 보고할지 여부 */
    allowSkips: boolean;
    /** migration 완료 후 ts-transformer-keys transformer plugin을 tsconfig에서 제거할지 여부 */
    updateTsconfig?: boolean;
    /** 프로젝트 root. 기본값은 dirname(tsconfig) */
    cwd?: string;
}

/**
 * type: `FieldRegistryMeta`
 * - generated registry 파일에 함께 내보내는 메타데이터.
 */
export interface FieldRegistryMeta {
    /** `'concrete'`: 실제 entry가 있는 registry. `'bootstrap'`: 빈 stub. */
    kind: 'concrete' | 'bootstrap';
    /** 현재 값 1. 의미 변경 시 bump. */
    schemaVersion: 1;
    /** registry entry 개수. */
    entryCount: number;
    /** entry name+fields의 canonical JSON sha256 앞 16자. bootstrap은 빈 문자열. */
    checksum: string;
    generatedBy: 'lemon-fields';
}

/** validate 함수가 반환하는 issue code. */
export type IssueCode =
    | 'META_MISSING'
    | 'UNSUPPORTED_SCHEMA'
    | 'BOOTSTRAP_STUB'
    | 'ENTRY_COUNT_MISMATCH'
    | 'CHECKSUM_MISMATCH'
    | 'NON_FUNCTION_ENTRY'
    | 'ENTRY_EVAL_FAILED'
    | 'INVALID_FIELD_LIST'
    | 'EMPTY_CONCRETE_REGISTRY';

/**
 * type: `FieldRegistryValidationIssue`
 * - `validateFieldRegistry()`가 반환하는 개별 검증 issue.
 */
export interface FieldRegistryValidationIssue {
    code: IssueCode;
    message: string;
    /** 특정 entry key에 귀속되는 issue인 경우. */
    entryKey?: string;
}

/**
 * type: `FieldRegistryValidationResult`
 * - `validateFieldRegistry()` 반환값.
 */
export interface FieldRegistryValidationResult {
    ok: boolean;
    issues: FieldRegistryValidationIssue[];
}

/**
 * type: `MigrateResult`
 * - `runMigrate()` 실행 결과.
 */
export interface MigrateResult {
    /** rewrite 된 모든 호출 위치 */
    rewrites: FieldRewrite[];
    /** 자동 rewrite 하지 못한 호출 위치 */
    skipped: FieldSiteSkip[];
    /** source가 변경된 파일의 절대 경로 목록 */
    changedFiles: string[];
    /** bootstrap registry stub을 `out`에 썼으면 true */
    wroteStub: boolean;
    /** `--diff` 출력용 line diff */
    diffs?: string[];
    /** tsconfig plugin 정리가 수행되었거나 dry-run에서 수행 예정이면 true */
    updatedTsconfig?: boolean;
}

/**
 * type: `GuardCommonOptions`
 * - `lemon-fields guard-common`에서 transformer spec의 common field guard를 삽입/갱신하는 옵션.
 */
export interface GuardCommonOptions {
    /** tsconfig 경로. 절대경로 또는 cwd 기준 상대경로 */
    tsconfig: string;
    /** generated field registry 경로. 절대경로 또는 cwd 기준 상대경로 */
    out?: string;
    /** scan 대상 glob. 기본값은 spec 파일 glob */
    paths?: string[];
    /** 찾을 함수/변수명. 기본값은 `checkAllKeys` */
    targetName: string;
    /** source 파일을 쓰지 않고 변경 결과만 계산 */
    dryRun: boolean;
    /** 변경될 source diff를 결과에 포함할지 여부 */
    diff?: boolean;
    /** 프로젝트 root. 기본값은 dirname(tsconfig) */
    cwd?: string;
}

/**
 * type: `GuardCommonResult`
 * - `lemon-fields guard-common` 실행 결과.
 */
export interface GuardCommonResult {
    /** 삽입/갱신된 guard 목록 */
    guards: Array<{
        relPath: string;
        targetName: string;
        varName: string;
        expected: string;
        action: 'inserted' | 'updated';
    }>;
    /** source가 변경된 파일의 절대 경로 목록 */
    changedFiles: string[];
    /** 변경될 source diff */
    diffs?: string[];
}
