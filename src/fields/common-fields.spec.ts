/**
 * `common-fields.spec.ts`
 * - common model field helper tests.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-27 added common field helper tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { expect2 } from 'lemon-core';

import {
    DEFAULT_COMMON_MODEL_FIELDS,
    assertCommonFields,
    checkCommonFields,
    formatCommonFields,
    sortCommonFields,
} from './common-fields';

const WITH_DOLLAR = '$,id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt';
const WITHOUT_DOLLAR = 'id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt';

describe('sortCommonFields', () => {
    it('should sort by length, then localeCompare', () => {
        expect2(() => sortCommonFields(['updatedAt', 'ns', '$', 'id', 'gid'])).toEqual([
            '$',
            'id',
            'ns',
            'gid',
            'updatedAt',
        ]);
    });
});

describe('formatCommonFields', () => {
    it('should format default common fields with `$`', () => {
        expect2(() => formatCommonFields()).toEqual(WITH_DOLLAR);
    });

    it('should format default common fields without `$`', () => {
        expect2(() => formatCommonFields(undefined, { exclude: ['$'] })).toEqual(WITHOUT_DOLLAR);
    });

    it('should format a provided field list with the common comparator', () => {
        expect2(() => formatCommonFields([...DEFAULT_COMMON_MODEL_FIELDS].reverse())).toEqual(WITH_DOLLAR);
    });
});

describe('checkCommonFields', () => {
    it('should pass when actual has all common fields', () => {
        expect2(() => checkCommonFields(DEFAULT_COMMON_MODEL_FIELDS)).toEqual({
            ok: true,
            expected: DEFAULT_COMMON_MODEL_FIELDS,
            actual: DEFAULT_COMMON_MODEL_FIELDS,
            missing: [],
            extra: [],
        });
    });

    it('should detect missing fields', () => {
        const actual = DEFAULT_COMMON_MODEL_FIELDS.filter(field => field !== 'meta');

        expect2(() => checkCommonFields(actual)).toEqual({
            ok: false,
            expected: DEFAULT_COMMON_MODEL_FIELDS,
            actual,
            missing: ['meta'],
            extra: [],
        });
    });

    it('should detect extra fields', () => {
        const actual = [...DEFAULT_COMMON_MODEL_FIELDS, 'newField'];

        expect2(() => checkCommonFields(actual)).toEqual({
            ok: false,
            expected: DEFAULT_COMMON_MODEL_FIELDS,
            actual: [
                '$',
                'id',
                'ns',
                'gid',
                'sid',
                'uid',
                'lock',
                'meta',
                'next',
                'type',
                'error',
                'stereo',
                'newField',
                'createdAt',
                'deletedAt',
                'updatedAt',
            ],
            missing: [],
            extra: ['newField'],
        });
    });

    it('should respect excluded fields', () => {
        expect2(() => checkCommonFields(DEFAULT_COMMON_MODEL_FIELDS, { exclude: ['$'] })).toEqual({
            ok: true,
            expected: DEFAULT_COMMON_MODEL_FIELDS.filter(field => field !== '$'),
            actual: DEFAULT_COMMON_MODEL_FIELDS.filter(field => field !== '$'),
            missing: [],
            extra: [],
        });
    });
});

describe('assertCommonFields', () => {
    it('should not throw when common fields match', () => {
        expect2(() => {
            assertCommonFields(DEFAULT_COMMON_MODEL_FIELDS);
            return 'ok';
        }).toEqual('ok');
    });

    it('should throw a stale message for missing fields', () => {
        const actual = DEFAULT_COMMON_MODEL_FIELDS.filter(field => field !== '$');
        const canon = [...DEFAULT_COMMON_MODEL_FIELDS, 'newField'];

        expect(() =>
            assertCommonFields(actual, {
                canon,
                entryName: 'viewTransformerModel',
                exclude: ['$'],
            }),
        ).toThrow(
            [
                '[common-fields] viewTransformerModel is stale.',
                '  expected: id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt,newField',
                `  actual:   ${WITHOUT_DOLLAR}`,
                '  missing:  newField',
                '  run `npm run fields:gen`',
            ].join('\n'),
        );
    });

    it('should include extra fields in a stale message', () => {
        expect(() =>
            assertCommonFields([...DEFAULT_COMMON_MODEL_FIELDS, 'newField'], { entryName: 'flows.Model' }),
        ).toThrow(
            [
                '[common-fields] flows.Model is stale.',
                `  expected: ${WITH_DOLLAR}`,
                '  actual:   $,id,ns,gid,sid,uid,lock,meta,next,type,error,stereo,newField,createdAt,deletedAt,updatedAt',
                '  extra:    newField',
                '  run `npm run fields:gen`',
            ].join('\n'),
        );
    });
});
