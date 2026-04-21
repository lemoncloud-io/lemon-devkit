/**
 * `fields/validate.ts`
 * - generated field registry의 runtime 무결성 검증 헬퍼.
 *
 * **NOTE**
 * - artifact integrity만 검증한다. source↔generated drift는 `gen --check`(CI) 책임.
 * - `ts-morph`, `fs`, `path`를 import 하지 않는다.
 * - 모든 issue를 모아서 한 번에 반환한다 (short-circuit 없음).
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-21 added runtime field registry validator.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as crypto from 'crypto';

import type {
    FieldRegistryMeta,
    FieldRegistryValidationIssue,
    FieldRegistryValidationResult,
    IssueCode,
} from './types';

export type { FieldRegistryMeta, FieldRegistryValidationIssue, FieldRegistryValidationResult, IssueCode } from './types';

export interface ValidateInput {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fieldKeys: Record<string, (...args: any[]) => any>;
    fieldRegistryMeta: unknown;
}

/** `fieldRegistryMeta`가 유효한 shape인지 확인 */
const isMeta = (v: unknown): v is FieldRegistryMeta =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as FieldRegistryMeta).kind === 'string' &&
    typeof (v as FieldRegistryMeta).schemaVersion === 'number' &&
    typeof (v as FieldRegistryMeta).entryCount === 'number' &&
    typeof (v as FieldRegistryMeta).checksum === 'string' &&
    (v as FieldRegistryMeta).generatedBy === 'lemon-fields';

const issue = (code: IssueCode, message: string, entryKey?: string): FieldRegistryValidationIssue =>
    entryKey !== undefined ? { code, message, entryKey } : { code, message };

const sha256First16 = (input: string): string =>
    crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);

/**
 * live registry에서 checksum 입력용 canonical string을 만든다.
 *
 * generator의 `canonicalEntries`와 동일한 규칙:
 * `Object.keys(fieldKeys).sort().map(k => JSON.stringify([k, fn()])).join('\n')`
 *
 * 실패한 entry는 canonical input에서 제외하고 별도 issue로 보고한다.
 */
const canonicalFromLiveRegistry = (
    fieldKeys: ValidateInput['fieldKeys'],
    issues: FieldRegistryValidationIssue[],
): string => {
    const pairs: string[] = [];
    for (const key of Object.keys(fieldKeys).sort()) {
        const fn = fieldKeys[key];
        if (typeof fn !== 'function') continue; // NON_FUNCTION_ENTRY가 이미 추가됨

        let result: unknown;
        try {
            result = fn();
        } catch (e) {
            issues.push(issue('ENTRY_EVAL_FAILED', `entry "${key}" threw on evaluation: ${e}`, key));
            continue;
        }

        if (!Array.isArray(result) || !result.every(x => typeof x === 'string')) {
            issues.push(
                issue('INVALID_FIELD_LIST', `entry "${key}" did not return string[], got: ${JSON.stringify(result)}`, key),
            );
            continue;
        }

        pairs.push(JSON.stringify([key, result as string[]]));
    }
    return pairs.join('\n');
};

/**
 * generated field registry의 artifact 무결성을 검증한다.
 *
 * 검증 범위:
 * - meta shape 존재 여부 / schemaVersion / kind
 * - entry count와 meta.entryCount 일치
 * - checksum 재계산 일치
 * - 각 entry가 callable하고 string[] 반환 여부
 * - concrete registry가 0 entry인 비정상 상태
 *
 * 검증 범위 외:
 * - source와 generated registry 간 drift (CI에서 `gen --check`로 보장)
 */
export const validateFieldRegistry = (input: ValidateInput): FieldRegistryValidationResult => {
    const issues: FieldRegistryValidationIssue[] = [];

    // meta shape 확인
    if (!isMeta(input.fieldRegistryMeta)) {
        issues.push(issue('META_MISSING', 'fieldRegistryMeta is missing or has invalid shape — run `lemon-fields gen` to regenerate'));
        return { ok: false, issues };
    }

    const meta = input.fieldRegistryMeta;

    // schemaVersion 확인
    if (meta.schemaVersion !== 1) {
        issues.push(issue('UNSUPPORTED_SCHEMA', `unsupported schemaVersion ${meta.schemaVersion}, expected 1`));
        return { ok: false, issues };
    }

    // bootstrap stub 확인
    if (meta.kind === 'bootstrap') {
        issues.push(issue('BOOTSTRAP_STUB', 'registry is a bootstrap stub — run `lemon-fields gen` to generate a concrete registry'));
        return { ok: false, issues };
    }

    const keys = Object.keys(input.fieldKeys);

    // 각 entry가 function인지 먼저 확인 (canonical 계산 전에 수집)
    for (const key of keys) {
        if (typeof input.fieldKeys[key] !== 'function') {
            issues.push(issue('NON_FUNCTION_ENTRY', `entry "${key}" is not a function`, key));
        }
    }

    // entry count 확인 (meta.entryCount vs 실제 key 개수)
    if (keys.length !== meta.entryCount) {
        issues.push(
            issue('ENTRY_COUNT_MISMATCH', `registry has ${keys.length} entries but meta.entryCount is ${meta.entryCount}`),
        );
    }

    // 0 entry concrete registry는 비정상 상태 (generator는 이 경우 bootstrap을 내므로)
    if (meta.kind === 'concrete' && keys.length === 0) {
        issues.push(issue('EMPTY_CONCRETE_REGISTRY', 'concrete registry has 0 entries — this is unexpected'));
    }

    // canonical 재계산 및 checksum 비교 (NON_FUNCTION_ENTRY가 있는 entry는 canonical에서 제외됨)
    const canonical = canonicalFromLiveRegistry(input.fieldKeys, issues);

    // ENTRY_EVAL_FAILED/INVALID_FIELD_LIST가 이미 있으면 checksum은 무의미할 수 있으나 계속 비교
    const computedChecksum = sha256First16(canonical);
    if (computedChecksum !== meta.checksum) {
        issues.push(
            issue('CHECKSUM_MISMATCH', `registry checksum mismatch — expected "${meta.checksum}", got "${computedChecksum}"`),
        );
    }

    return { ok: issues.length === 0, issues };
};

/**
 * 검증 실패 시 모든 issue를 합쳐 `Error`를 throw한다.
 *
 * 앱 bootstrap에서 한 번만 호출한다 — import side effect가 아님.
 */
export const assertFieldRegistry = (input: ValidateInput): void => {
    const result = validateFieldRegistry(input);
    if (!result.ok) {
        const summary = result.issues.map(i => `  [${i.code}] ${i.message}`).join('\n');
        throw new Error(`field registry validation failed:\n${summary}`);
    }
};
