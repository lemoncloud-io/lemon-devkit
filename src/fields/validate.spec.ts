/**
 * `validate.spec.ts`
 * - runtime field registry 무결성 검증 테스트.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-21 added runtime validator tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { expect2 } from 'lemon-core';

import { FieldRegistryMeta } from './types';
import { assertFieldRegistry, validateFieldRegistry } from './validate';

//* 테스트용 최소 concrete registry를 만든다.
//* canonical: `["alpha",["a","b"]]\n["beta",["x"]]` → sha256 앞 16자
const makeMeta = (over: Partial<FieldRegistryMeta> = {}): FieldRegistryMeta => ({
    kind: 'concrete',
    schemaVersion: 1,
    entryCount: 2,
    checksum: computeChecksum({ alpha: () => ['a', 'b'], beta: () => ['x'] }),
    generatedBy: 'lemon-fields',
    ...over,
});

const makeFieldKeys = (): Record<string, () => string[]> => ({
    alpha: () => ['a', 'b'],
    beta: () => ['x'],
});

const computeChecksum = (fieldKeys: Record<string, () => string[]>): string => {
    const crypto = require('crypto');
    const canonical = Object.keys(fieldKeys)
        .sort()
        .map(k => JSON.stringify([k, fieldKeys[k]()]))
        .join('\n');
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
};

describe('validateFieldRegistry', () => {
    describe('pass cases', () => {
        it('should pass a valid concrete registry', () => {
            const result = validateFieldRegistry({ fieldKeys: makeFieldKeys(), fieldRegistryMeta: makeMeta() });

            expect2(() => result).toEqual({ ok: true, issues: [] });
        });
    });

    describe('fail cases — one issue at a time', () => {
        it('should fail META_MISSING when meta is undefined', () => {
            const result = validateFieldRegistry({ fieldKeys: makeFieldKeys(), fieldRegistryMeta: undefined });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: ['META_MISSING'],
            });
        });

        it('should fail META_MISSING when meta has wrong shape', () => {
            const result = validateFieldRegistry({ fieldKeys: makeFieldKeys(), fieldRegistryMeta: { kind: 'unknown' } });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: ['META_MISSING'],
            });
        });

        it('should fail UNSUPPORTED_SCHEMA when schemaVersion is not 1', () => {
            const result = validateFieldRegistry({
                fieldKeys: makeFieldKeys(),
                fieldRegistryMeta: { ...makeMeta(), schemaVersion: 2 as any },
            });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: ['UNSUPPORTED_SCHEMA'],
            });
        });

        it('should fail BOOTSTRAP_STUB when kind is bootstrap', () => {
            const result = validateFieldRegistry({
                fieldKeys: {},
                fieldRegistryMeta: {
                    kind: 'bootstrap',
                    schemaVersion: 1,
                    entryCount: 0,
                    checksum: '',
                    generatedBy: 'lemon-fields',
                },
            });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: ['BOOTSTRAP_STUB'],
            });
        });

        it('should fail ENTRY_COUNT_MISMATCH when key count differs from meta.entryCount', () => {
            const fk = makeFieldKeys();
            //* entry 하나를 통째로 삭제한다 (key 개수 ≠ meta.entryCount=2)
            const { alpha: _, ...withoutAlpha } = fk;
            const result = validateFieldRegistry({ fieldKeys: withoutAlpha, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: expect.arrayContaining(['ENTRY_COUNT_MISMATCH']),
            });
        });

        it('should fail CHECKSUM_MISMATCH only (no ENTRY_COUNT_MISMATCH) when a field is removed inside an entry', () => {
            //* entry 개수는 그대로(2개), 하지만 alpha의 field 하나를 삭제 → CHECKSUM_MISMATCH 단독
            const tampered: Record<string, () => string[]> = {
                alpha: () => ['a'], // 'b' 제거
                beta: () => ['x'],
            };
            const result = validateFieldRegistry({ fieldKeys: tampered, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: ['CHECKSUM_MISMATCH'],
            });
            //* ENTRY_COUNT_MISMATCH는 발화하지 않아야 한다
            expect(result.issues.find(i => i.code === 'ENTRY_COUNT_MISMATCH')).toBeUndefined();
        });

        it('should fail NON_FUNCTION_ENTRY when an entry is not a function', () => {
            const corrupted = { ...makeFieldKeys(), alpha: 'not-a-function' as any };
            const result = validateFieldRegistry({ fieldKeys: corrupted, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: expect.arrayContaining(['NON_FUNCTION_ENTRY']),
            });
            expect(result.issues.find(i => i.code === 'NON_FUNCTION_ENTRY')?.entryKey).toBe('alpha');
        });

        it('should fail ENTRY_EVAL_FAILED and not throw when entry function throws', () => {
            const throwing = {
                ...makeFieldKeys(),
                alpha: () => { throw new Error('corrupt entry'); },
            };
            const result = validateFieldRegistry({ fieldKeys: throwing, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: expect.arrayContaining(['ENTRY_EVAL_FAILED']),
            });
            expect(result.issues.find(i => i.code === 'ENTRY_EVAL_FAILED')?.entryKey).toBe('alpha');
        });

        it('should fail INVALID_FIELD_LIST when entry returns non-string array', () => {
            const invalid = {
                ...makeFieldKeys(),
                alpha: () => [1, 2, 3] as any,
            };
            const result = validateFieldRegistry({ fieldKeys: invalid, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: expect.arrayContaining(['INVALID_FIELD_LIST']),
            });
            expect(result.issues.find(i => i.code === 'INVALID_FIELD_LIST')?.entryKey).toBe('alpha');
        });

        it('should fail INVALID_FIELD_LIST when entry returns non-array', () => {
            const invalid = {
                ...makeFieldKeys(),
                alpha: () => 'not-an-array' as any,
            };
            const result = validateFieldRegistry({ fieldKeys: invalid, fieldRegistryMeta: makeMeta() });

            const codes = result.issues.map(i => i.code);
            expect(result.ok).toBe(false);
            expect(codes).toContain('INVALID_FIELD_LIST');
        });

        it('should fail EMPTY_CONCRETE_REGISTRY for concrete registry with 0 entries', () => {
            const emptyMeta = makeMeta({ entryCount: 0, checksum: computeChecksum({}) });
            const result = validateFieldRegistry({ fieldKeys: {}, fieldRegistryMeta: emptyMeta });

            expect2(() => ({ ok: result.ok, codes: result.issues.map(i => i.code) })).toEqual({
                ok: false,
                codes: expect.arrayContaining(['EMPTY_CONCRETE_REGISTRY']),
            });
        });
    });

    describe('multi-issue cases', () => {
        it('should collect all issues without short-circuit', () => {
            //* entry 하나를 삭제(ENTRY_COUNT_MISMATCH)하고, 남은 entry를 비함수로 오염(NON_FUNCTION_ENTRY)
            const corrupted: Record<string, any> = { alpha: 'not-a-function' };
            const result = validateFieldRegistry({ fieldKeys: corrupted, fieldRegistryMeta: makeMeta() });

            expect2(() => ({ ok: result.ok, count: result.issues.length >= 2 })).toEqual({ ok: false, count: true });
            expect(result.issues.find(i => i.code === 'ENTRY_COUNT_MISMATCH')).toBeDefined();
            expect(result.issues.find(i => i.code === 'NON_FUNCTION_ENTRY')).toBeDefined();
        });
    });
});

describe('assertFieldRegistry', () => {
    it('should not throw for a valid concrete registry', () => {
        expect(() =>
            assertFieldRegistry({ fieldKeys: makeFieldKeys(), fieldRegistryMeta: makeMeta() }),
        ).not.toThrow();
    });

    it('should throw with all issue codes in the message', () => {
        let message = '';
        try {
            assertFieldRegistry({ fieldKeys: makeFieldKeys(), fieldRegistryMeta: undefined });
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }
        expect(message).toContain('META_MISSING');
        expect(message).toContain('field registry validation failed');
    });

    it('should throw and include all codes when multiple issues exist', () => {
        const corrupted: Record<string, any> = { alpha: 'not-a-function' };
        let message = '';
        try {
            assertFieldRegistry({ fieldKeys: corrupted, fieldRegistryMeta: makeMeta() });
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }
        expect(message).toContain('ENTRY_COUNT_MISMATCH');
        expect(message).toContain('NON_FUNCTION_ENTRY');
    });
});
