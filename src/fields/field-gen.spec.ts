/**
 * `field-gen.spec.ts`
 * - temp fixture project 기준의 field registry 생성 테스트.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added field registry generator tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { expect2, GETERR } from 'lemon-core';

import { GenOptions, bootstrapStub, canonicalEntries, renderRegistry, runGen, writeRegistry } from './field-gen';

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        target: 'es2017',
        module: 'commonjs',
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        declaration: false,
        outDir: 'dist',
    },
    include: ['src/**/*'],
    exclude: ['node_modules', '**/*.spec.ts'],
});

const TS_TRANSFORMER_KEYS_STUB: Record<string, string> = {
    'node_modules/ts-transformer-keys/package.json': JSON.stringify({
        name: 'ts-transformer-keys',
        main: 'index.js',
    }),
    'node_modules/ts-transformer-keys/index.js': `exports.keys = () => [];`,
    'node_modules/ts-transformer-keys/index.d.ts': `export function keys<T>(): Array<Extract<keyof T, string>>;`,
};

//* temp fixture project를 파일 단위로 빠르게 조립한다.
const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-fields-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return root;
};

const baseOpts = (root: string, over: Partial<GenOptions> = {}): GenOptions => ({
    tsconfig: path.join(root, 'tsconfig.json'),
    out: 'src/generated/field-registry.ts',
    includeSpec: true,
    allowLegacy: false,
    allowEmpty: false,
    cwd: root,
    ...over,
});

interface FixtureOptions {
    withLegacyKeys?: boolean;
    withRegistry?: boolean;
    gen?: Partial<GenOptions>;
}

//* runGen 테스트용 기본 fixture.
//* - registry stub, legacy keys stub 여부를 옵션으로 토글한다.
const instance = (files: Record<string, string>, options: FixtureOptions = {}) => {
    const root = makeTmpProject({
        'tsconfig.json': TSCONFIG,
        ...(options.withRegistry === false ? {} : { 'src/generated/field-registry.ts': bootstrapStub() }),
        ...(options.withLegacyKeys ? TS_TRANSFORMER_KEYS_STUB : {}),
        ...files,
    });

    const run = (over: Partial<GenOptions> = {}) => runGen(baseOpts(root, { ...(options.gen ?? {}), ...over }));
    const runErr = (over: Partial<GenOptions> = {}) => {
        try {
            run(over);
            return '';
        } catch (e) {
            return GETERR(e);
        }
    };

    return { root, run, runErr };
};

//* 결과를 한눈에 비교하기 위한 summary projection.
const entryNames = (res: ReturnType<typeof runGen>): string[] => res.entries.map(e => e.name).sort();
const fieldMap = (res: ReturnType<typeof runGen>): Record<string, string[]> =>
    Object.fromEntries(
        [...res.entries].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, fields }) => [name, [...fields]]),
    );
const legacyTypeMap = (res: ReturnType<typeof runGen>): Record<string, { fields: string[]; legacy: boolean }> =>
    Object.fromEntries(
        [...res.entries]
            .sort((a, b) => a.typeArgText.localeCompare(b.typeArgText))
            .map(({ typeArgText, fields, legacy }) => [typeArgText, { fields: [...fields], legacy }]),
    );
const renderView = (out: string): string[] => {
    //* fieldKeys 블록 한정. 첫 번째 `} as const;`(fieldKeys 닫힘)에서 수집을 멈춘다.
    const result: string[] = [];
    for (const line of out.split('\n')) {
        if (
            line.includes('AUTO-GENERATED') ||
            line.includes('// source:') ||
            line.includes(': <T extends object>() =>') ||
            line.includes('as Array<Extract<keyof T, string>>') ||
            line === '} as const;'
        ) {
            result.push(line);
        }
        if (line === '} as const;') break;
    }
    return result;
};
const isBootstrapStub = (out: string): boolean => out.includes('export const fieldKeys = {} as Record<');

const EMPTY_SCAN_ERROR =
    'no `fieldKeys.<name><T>()` call sites found. If this is expected, pass `--allow-empty`; otherwise check `--include-spec` and `--paths`.';

describe('renderRegistry', () => {
    const SAMPLE_ENTRIES = [
        { name: 'userModel', fields: ['id', 'name'], relPath: 'src/a.ts', typeArgText: 'UserModel', legacy: false },
        { name: 'adminModel', fields: ['id', 'role'], relPath: 'src/b.ts', typeArgText: 'AdminModel', legacy: false },
    ];

    it('should pass registry rendering with header and sorted entries', () => {
        //* full string 전체를 보는 대신, 핵심 line만 남겨 결과 shape를 바로 읽게 만든다.
        const out = renderRegistry(SAMPLE_ENTRIES);

        expect2(() => renderView(out)).toEqual([
            '// AUTO-GENERATED by lemon-devkit `lemon-fields` — do not edit manually.',
            '    // source: src/b.ts#AdminModel',
            '    adminModel: <T extends object>() =>',
            '        ["id", "role"] as Array<Extract<keyof T, string>>,',
            '    // source: src/a.ts#UserModel',
            '    userModel: <T extends object>() =>',
            '        ["id", "name"] as Array<Extract<keyof T, string>>,',
            '} as const;',
        ]);
    });

    it('should pass concrete meta with correct kind, entryCount and 16-char hex checksum', () => {
        const out = renderRegistry(SAMPLE_ENTRIES);
        const metaMatch = out.match(/export const fieldRegistryMeta = (\{[\s\S]*?\}) as const;/);
        const meta = metaMatch ? JSON.parse(metaMatch[1]) : null;

        expect2(() => ({
            kind: meta?.kind,
            schemaVersion: meta?.schemaVersion,
            entryCount: meta?.entryCount,
            checksumLength: meta?.checksum?.length,
            checksumIsHex: /^[0-9a-f]{16}$/.test(meta?.checksum ?? ''),
            generatedBy: meta?.generatedBy,
        })).toEqual({
            kind: 'concrete',
            schemaVersion: 1,
            entryCount: 2,
            checksumLength: 16,
            checksumIsHex: true,
            generatedBy: 'lemon-fields',
        });
    });

    it('should pass checksum reproducibility — generator and runtime canonical must match', () => {
        //* generator의 canonicalEntries와 runtime이 같은 방식으로 canonical을 만들어야 한다.
        //* 여기서는 live registry를 시뮬레이션해서 canonical string이 동일한지 검증한다.
        const out = renderRegistry(SAMPLE_ENTRIES);
        const metaMatch = out.match(/"checksum":\s*"([0-9a-f]{16})"/);
        const generatedChecksum = metaMatch?.[1] ?? '';

        //* runtime canonical 재계산: Object.keys(fieldKeys).sort().map(k => JSON.stringify([k, fn()]))
        const liveRegistry: Record<string, () => string[]> = {
            userModel: () => ['id', 'name'],
            adminModel: () => ['id', 'role'],
        };
        const runtimeCanonical = Object.keys(liveRegistry)
            .sort()
            .map(k => JSON.stringify([k, liveRegistry[k]()]))
            .join('\n');
        const genCanonical = canonicalEntries(SAMPLE_ENTRIES);

        expect2(() => ({ match: genCanonical === runtimeCanonical })).toEqual({ match: true });

        //* checksum 재계산
        const runtimeChecksum = createHash('sha256').update(runtimeCanonical).digest('hex').slice(0, 16);

        expect2(() => ({ checksumMatch: generatedChecksum === runtimeChecksum })).toEqual({ checksumMatch: true });
    });

    it('should pass stable checksum regardless of input scan order', () => {
        //* 입력 순서가 달라도 canonical form이 동일 → 동일 checksum.
        const reversed = [...SAMPLE_ENTRIES].reverse();
        const out1 = renderRegistry(SAMPLE_ENTRIES);
        const out2 = renderRegistry(reversed);

        const cs1 = out1.match(/"checksum":\s*"([0-9a-f]{16})"/)?.[1];
        const cs2 = out2.match(/"checksum":\s*"([0-9a-f]{16})"/)?.[1];

        expect2(() => ({ same: cs1 === cs2 && cs1 !== undefined })).toEqual({ same: true });
    });
});

describe('bootstrapStub', () => {
    it('should pass bootstrap stub typing', () => {
        const out = bootstrapStub();

        //* compile 가능한 최소 shape이 포함되는지 확인한다.
        expect2(() => ({
            hasHeader: out.includes('AUTO-GENERATED by lemon-devkit'),
            hasFieldKeys: out.includes('export const fieldKeys = {} as Record<'),
            hasMeta: out.includes('export const fieldRegistryMeta'),
        })).toEqual({ hasHeader: true, hasFieldKeys: true, hasMeta: true });
    });

    it('should pass bootstrap stub meta shape', () => {
        const out = bootstrapStub();
        //* eval 없이 JSON 파싱으로 meta shape 검증한다.
        const metaMatch = out.match(/export const fieldRegistryMeta = (\{[\s\S]*?\}) as const;/);
        const meta = metaMatch ? JSON.parse(metaMatch[1]) : null;

        expect2(() => meta).toEqual({
            kind: 'bootstrap',
            schemaVersion: 1,
            entryCount: 0,
            checksum: '',
            generatedBy: 'lemon-fields',
        });
    });
});

describe('writeRegistry', () => {
    it('should pass nested registry file writing', () => {
        const root = makeTmpProject({});
        const out = path.join(root, 'src/generated/deep/field-registry.ts');

        writeRegistry(out, 'export const fieldKeys = {} as const;\n');

        expect2(() => ({ exists: fs.existsSync(out), content: fs.readFileSync(out, 'utf8') })).toEqual({
            exists: true,
            content: 'export const fieldKeys = {} as const;\n',
        });
    });
});

describe('runGen', () => {
    //* 정상 생성 케이스.
    describe('basic generation', () => {
        it('should pass a simple migrated call site', () => {
            const fx = instance({
                'src/model.ts': `export interface UserModel { id: string; name: string; age: number }`,
                'src/index.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { UserModel } from './model';
                    export const FIELDS = fieldKeys.userModel<UserModel>();
                `,
            });

            const res = fx.run();

            expect2(() => ({ changed: res.changed, entries: res.entries }), 'changed,entries').toEqual({
                changed: true,
                entries: [
                    {
                        name: 'userModel',
                        fields: ['id', 'name', 'age'],
                        relPath: 'src/index.ts',
                        typeArgText: 'UserModel',
                        legacy: false,
                    },
                ],
            });
        });

        it('should pass intersection type resolution across imported interfaces', () => {
            const fx = instance({
                'src/model.ts': `
                    export interface A { a: string; shared: number }
                    export interface B { b: string; shared: number }
                    export interface C { c: string }
                `,
                'src/index.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { A, B, C } from './model';
                    export const FIELDS = fieldKeys.abcMix<A & B & C>();
                `,
            });

            const res = fx.run();

            expect2(() => fieldMap(res)).toEqual({ abcMix: ['a', 'shared', 'b', 'c'] });
        });

        it('should pass distinct registry names for the same interface', () => {
            const fx = instance({
                'src/model.ts': `export interface Model { id: string; x: number }`,
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const A = fieldKeys.alpha<Model>();
                `,
                'src/b.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const B = fieldKeys.bravo<Model>();
                `,
            });

            const res = fx.run();

            expect2(() => fieldMap(res)).toEqual({
                alpha: ['id', 'x'],
                bravo: ['id', 'x'],
            });
        });

        it('should pass identical duplicate registry names when the field set is the same', () => {
            const fx = instance({
                'src/model.ts': `export interface Model { id: string; x: number }`,
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const A = fieldKeys.same<Model>();
                `,
                'src/b.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const B = fieldKeys.same<Model>();
                `,
            });

            const res = fx.run();

            expect2(() => fieldMap(res)).toEqual({ same: ['id', 'x'] });
        });

        it('should pass aliased registry imports', () => {
            const fx = instance({
                'src/model.ts': `export interface Model { id: string }`,
                'src/index.ts': `
                    import { fieldKeys as lemonFieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const FIELDS = lemonFieldKeys.modelA<Model>();
                `,
            });

            const res = fx.run();

            expect2(() => entryNames(res)).toEqual(['modelA']);
        });

        it('should pass generated registry self-skip', () => {
            const fx = instance({
                'src/generated/field-registry.ts': `
                    export const fieldKeys = {
                        stale: <T extends object>() => ['a', 'b'] as Array<Extract<keyof T, string>>,
                    } as const;
                `,
                'src/model.ts': `export interface Model { id: string }`,
                'src/index.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const FIELDS = fieldKeys.modelB<Model>();
                `,
            });

            const res = fx.run();

            expect2(() => entryNames(res)).toEqual(['modelB']);
        });

        it('should pass spec-file inclusion when includeSpec=true', () => {
            const fx = instance({
                'src/model.ts': `export interface Model { id: string }`,
                'src/a.spec.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    describe('scan', () => {
                        it('should pass inline spec call', () => fieldKeys.specModel<Model>());
                    });
                `,
            });

            const res = fx.run();

            expect2(() => entryNames(res)).toEqual(['specModel']);
        });

        it('should pass spec-file exclusion when includeSpec=false', () => {
            const fx = instance({
                'src/model.ts': `export interface Model { id: string }`,
                'src/a.spec.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    describe('scan', () => {
                        it('should pass inline spec call', () => fieldKeys.specModel<Model>());
                    });
                `,
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Model } from './model';
                    export const PROD = fieldKeys.prodModel<Model>();
                `,
            });

            const res = fx.run({ includeSpec: false });

            expect2(() => entryNames(res)).toEqual(['prodModel']);
        });
    });

    //* throw로 중단되는 케이스.
    describe('error cases', () => {
        it('should fail legacy leftovers by default', () => {
            const fx = instance(
                {
                    'src/model.ts': `export interface Model { id: string }`,
                    'src/a.ts': `
                        import { keys } from 'ts-transformer-keys';
                        import { Model } from './model';
                        export const FIELDS = keys<Model>();
                    `,
                },
                { withLegacyKeys: true },
            );

            expect2(() => fx.runErr()).toEqual(
                [
                    'found 1 legacy `keys<T>()` call site(s); run `lemon-fields migrate` first or pass `--allow-legacy`:',
                    '  - src/a.ts :: keys<Model>()',
                ].join('\n'),
            );
        });

        it('should pass legacy leftovers only when --allow-legacy is enabled', () => {
            const fx = instance(
                {
                    'src/model.ts': `export interface UserModel { id: string }`,
                    'src/a.ts': `
                        import { keys } from 'ts-transformer-keys';
                        import { UserModel } from './model';
                        export const FIELDS = keys<UserModel>();
                    `,
                },
                { withLegacyKeys: true },
            );

            const res = fx.run({ allowLegacy: true });

            expect2(() => ({ names: entryNames(res), legacyLeftovers: res.legacyLeftovers })).toEqual({
                names: ['userModel'],
                legacyLeftovers: [{ relPath: 'src/a.ts', typeArgText: 'UserModel' }],
            });
        });

        it('should fail divergent registry names across different models', () => {
            const fx = instance({
                'src/model.ts': `
                    export interface Mine { a: string; b: string }
                    export interface Ours { x: string; y: string }
                `,
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Mine } from './model';
                    export const A = fieldKeys.same<Mine>();
                `,
                'src/b.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { Ours } from './model';
                    export const B = fieldKeys.same<Ours>();
                `,
            });

            expect2(() => fx.runErr()).toEqual(
                [
                    'duplicate registry name `same` with divergent field sets:',
                    '  - src/a.ts :: Mine -> [a, b]',
                    '  - src/b.ts :: Ours -> [x, y]',
                    'Hand-edit one of the call sites to a distinct name.',
                ].join('\n'),
            );
        });

        it('should fail divergent local types even when the type text is the same', () => {
            const fx = instance({
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    interface LocalModel { id: string; a: string }
                    export const A = fieldKeys.same<LocalModel>();
                `,
                'src/b.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    interface LocalModel { id: string; b: string }
                    export const B = fieldKeys.same<LocalModel>();
                `,
            });

            expect2(() => fx.runErr()).toEqual(
                [
                    'duplicate registry name `same` with divergent field sets:',
                    '  - src/a.ts :: LocalModel -> [id, a]',
                    '  - src/b.ts :: LocalModel -> [id, b]',
                    'Hand-edit one of the call sites to a distinct name.',
                ].join('\n'),
            );
        });

        it('should fail empty scan by default', () => {
            const fx = instance(
                {
                    'src/a.ts': `export const value = 1;`,
                },
                { withRegistry: false },
            );

            expect2(() => fx.runErr()).toEqual(EMPTY_SCAN_ERROR);
        });

        it('should pass empty scan only when --allow-empty is enabled', () => {
            const fx = instance(
                {
                    'src/a.ts': `export const value = 1;`,
                },
                { withRegistry: false },
            );

            const res = fx.run({ allowEmpty: true });

            expect2(() => ({ entries: res.entries, bootstrapStub: isBootstrapStub(res.content) })).toEqual({
                entries: [],
                bootstrapStub: true,
            });
        });
    });

    //* 조용히 누락되거나 일부만 생성되는 케이스.
    describe('omission cases', () => {
        it('should pass partial generation by --paths without pretending completeness', () => {
            const fx = instance({
                'src/models/user.ts': `export interface UserModel { id: string; name: string }`,
                'src/models/post.ts': `export interface PostModel { id: string; title: string }`,
                'src/modules/user/fields.ts': `
                    import { fieldKeys } from '../../generated/field-registry';
                    import { UserModel } from '../../models/user';
                    export const USER_FIELDS = fieldKeys.userModel<UserModel>();
                `,
                'src/modules/post/fields.ts': `
                    import { fieldKeys } from '../../generated/field-registry';
                    import { PostModel } from '../../models/post';
                    export const POST_FIELDS = fieldKeys.postModel<PostModel>();
                `,
            });

            const res = fx.run({ paths: ['src/modules/user/**/*.ts'] });

            //* user module만 scan 했으므로 postModel은 빠지는 게 정상이다.
            expect2(() => fieldMap(res)).toEqual({ userModel: ['id', 'name'] });
        });

        it('should pass direct calls and silently omit alias blind spots', () => {
            const fx = instance({
                'src/model.ts': `export interface UserModel { id: string; name: string }`,
                'src/direct.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { UserModel } from './model';
                    export const DIRECT = fieldKeys.directModel<UserModel>();
                `,
                'src/alias.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { UserModel } from './model';
                    const fk = fieldKeys;
                    export const ALIAS = fk.userModel<UserModel>();
                `,
            });

            const res = fx.run();

            //* 현재 scanner는 direct property call만 잡는다.
            expect2(() => entryNames(res)).toEqual(['directModel']);
        });

        it('should fail with empty scan when every call site is hidden behind a blind spot', () => {
            const fx = instance({
                'src/model.ts': `export interface UserModel { id: string; name: string }`,
                'src/alias.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    import { UserModel } from './model';

                    const fk = fieldKeys;
                    export const ALIAS = fk.userModel<UserModel>();
                `,
            });

            expect2(() => fx.runErr()).toEqual(EMPTY_SCAN_ERROR);
        });
    });

    //* property가 0개인 타입은 실패가 아니라 정상 `[]` 생성이다.
    describe('empty-property cases', () => {
        it('should pass empty-property materialisation for migrated and legacy call sites', () => {
            const migrated = instance({
                'src/a.ts': `
                    import { fieldKeys } from './generated/field-registry';
                    interface A { a: string }
                    interface B { b: string }

                    export const EMPTY = fieldKeys.empty<{}>();
                    export const UNION = fieldKeys.union<A | B>();
                    export const RECORD = fieldKeys.record<Record<string, unknown>>();
                    export function generic<T>() { return fieldKeys.generic<T>(); }
                    export function constrained<T extends { id: string }>() { return fieldKeys.withId<T>(); }
                `,
            }).run();

            expect2(() => ({ skipped: migrated.skipped, fields: fieldMap(migrated) })).toEqual({
                skipped: [],
                fields: {
                    empty: [],
                    generic: [],
                    record: [],
                    union: [],
                    withId: ['id'],
                },
            });

            //* legacy 호환 모드에서도 같은 계열 타입은 실패하지 않고 빈 배열로 materialise 된다.
            const legacy = instance(
                {
                    'src/a.ts': `
                        import { keys } from 'ts-transformer-keys';
                        interface A { a: string }
                        interface B { b: string }

                        export const EMPTY = keys<{}>();
                        export const UNION = keys<A | B>();
                        export const RECORD = keys<Record<string, unknown>>();
                        export function generic<T>() { return keys<T>(); }
                        export function constrained<T extends { id: string }>() { return keys<T>(); }
                    `,
                },
                { withLegacyKeys: true },
            ).run({ allowLegacy: true });

            expect2(() => ({ skipped: legacy.skipped, byType: legacyTypeMap(legacy) })).toEqual({
                skipped: [],
                byType: {
                    '{}': { fields: [], legacy: true },
                    'A | B': { fields: [], legacy: true },
                    'Record<string, unknown>': { fields: [], legacy: true },
                    T: { fields: ['id'], legacy: true },
                },
            });
        });
    });
});
