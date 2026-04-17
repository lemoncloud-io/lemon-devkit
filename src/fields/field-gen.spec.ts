/**
 * `field-gen.spec.ts`
 * - temp fixture project 기준의 field registry 생성 테스트.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added field registry generator tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GenOptions, runGen, bootstrapStub, renderRegistry, writeRegistry } from './field-gen';

const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-fields-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return root;
};

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

const baseOpts = (root: string, over: Partial<GenOptions> = {}): GenOptions => ({
    tsconfig: path.join(root, 'tsconfig.json'),
    out: 'src/generated/field-registry.ts',
    includeSpec: true,
    allowLegacy: false,
    allowEmpty: false,
    cwd: root,
    ...over,
});

describe('renderRegistry', () => {
    it('emits expected shape with header + sorted entries', () => {
        const out = renderRegistry([
            { name: 'userModel', fields: ['id', 'name'], relPath: 'src/a.ts', typeArgText: 'UserModel', legacy: false },
            {
                name: 'adminModel',
                fields: ['id', 'role'],
                relPath: 'src/b.ts',
                typeArgText: 'AdminModel',
                legacy: false,
            },
        ]);
        expect(out).toContain('AUTO-GENERATED');
        //* registry key 기준 정렬: adminModel이 userModel보다 앞에 와야 함.
        expect(out.indexOf('adminModel')).toBeLessThan(out.indexOf('userModel'));
        expect(out).toContain(`["id", "role"] as Array<Extract<keyof T, string>>`);
        expect(out).toContain(`} as const;`);
    });
});

describe('bootstrapStub', () => {
    it('produces a permissively typed empty registry', () => {
        const out = bootstrapStub();
        expect(out).toContain('export const fieldKeys = {} as Record<');
        expect(out).toContain('<T extends object>() => Array<Extract<keyof T, string>>');
    });
});

describe('writeRegistry', () => {
    it('should pass nested registry file writing', () => {
        const root = makeTmpProject({});
        const out = path.join(root, 'src/generated/deep/field-registry.ts');

        writeRegistry(out, 'export const fieldKeys = {} as const;\n');

        expect(fs.existsSync(out)).toBe(true);
        expect(fs.readFileSync(out, 'utf8')).toBe('export const fieldKeys = {} as const;\n');
    });
});

describe('runGen — happy paths', () => {
    it('extracts fields from a simple migrated call site', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `
                export interface UserModel { id: string; name: string; age: number }
            `,
            'src/index.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { UserModel } from './model';
                export const F = fieldKeys.userModel<UserModel>();
            `,
        });

        const res = runGen(baseOpts(root));
        expect(res.entries).toHaveLength(1);
        expect(res.entries[0].name).toBe('userModel');
        expect(res.entries[0].fields).toEqual(['id', 'name', 'age']);
        expect(res.changed).toBe(true);
    });

    it('resolves intersection types across multiple interfaces', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `
                export interface A { a: string; shared: number }
                export interface B { b: string; shared: number }
                export interface C { c: string }
            `,
            'src/index.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { A, B, C } from './model';
                export const F = fieldKeys.abcMix<A & B & C>();
            `,
        });

        const res = runGen(baseOpts(root));
        expect(res.entries).toHaveLength(1);
        expect(res.entries[0].name).toBe('abcMix');
        expect(res.entries[0].fields.sort()).toEqual(['a', 'b', 'c', 'shared']);
    });

    it('preserves property names verbatim — same interface, different names are distinct entries', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string; x: number }`,
            'src/a.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const A = fieldKeys.alpha<M>();
            `,
            'src/b.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const B = fieldKeys.bravo<M>();
            `,
        });

        const res = runGen(baseOpts(root));
        const names = res.entries.map(e => e.name).sort();
        expect(names).toEqual(['alpha', 'bravo']);
        //* 같은 interface를 다른 registry key로 노출하므로 field 목록은 동일해야 함.
        for (const e of res.entries) expect(e.fields.sort()).toEqual(['id', 'x']);
    });

    it('allows duplicate registry key when resolved field sets are identical', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string; x: number }`,
            'src/a.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const A = fieldKeys.same<M>();
            `,
            'src/b.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const B = fieldKeys.same<M>();
            `,
        });

        const res = runGen(baseOpts(root));

        expect(res.entries.map(e => e.name)).toEqual(['same']);
        expect(res.entries[0].fields).toEqual(['id', 'x']);
    });

    it('tracks aliased import: `fieldKeys as lemonFieldKeys`', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string }`,
            'src/index.ts': `
                import { fieldKeys as lemonFieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const F = lemonFieldKeys.modelA<M>();
            `,
        });
        const res = runGen(baseOpts(root));
        expect(res.entries.map(e => e.name)).toEqual(['modelA']);
    });

    it('skips the output file itself (never scans generated registry)', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': `
                export const fieldKeys = {
                    thing: <T extends object>() => ['a', 'b'] as Array<Extract<keyof T, string>>,
                } as const;
            `,
            'src/model.ts': `export interface M { id: string }`,
            'src/index.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const F = fieldKeys.modelB<M>();
            `,
        });
        const res = runGen(baseOpts(root));
        expect(res.entries.map(e => e.name)).toEqual(['modelB']);
    });

    it('includes spec files when includeSpec=true', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string }`,
            'src/a.spec.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                describe('x', () => { it('y', () => { fieldKeys.specModel<M>(); }); });
            `,
        });
        const res = runGen(baseOpts(root));
        expect(res.entries.map(e => e.name)).toEqual(['specModel']);
    });

    it('excludes spec files when includeSpec=false', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string }`,
            'src/a.spec.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                describe('x', () => { it('y', () => { fieldKeys.specModel<M>(); }); });
            `,
            'src/a.ts': `
                import { fieldKeys } from './generated/field-registry';
                import { M } from './model';
                export const X = fieldKeys.prodModel<M>();
            `,
        });
        const res = runGen(baseOpts(root, { includeSpec: false }));
        expect(res.entries.map(e => e.name)).toEqual(['prodModel']);
    });

    it('should pass --paths scan with imported model type context', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
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

        const res = runGen(baseOpts(root, { paths: ['src/modules/user/**/*.ts'] }));

        expect(res.entries.map(e => e.name)).toEqual(['userModel']);
        expect(res.entries[0].fields).toEqual(['id', 'name']);
    });
});

describe('runGen — failure modes', () => {
    it('fails on un-migrated legacy `keys<T>()` by default', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'node_modules/ts-transformer-keys/package.json': JSON.stringify({
                name: 'ts-transformer-keys',
                main: 'index.js',
            }),
            'node_modules/ts-transformer-keys/index.js': `exports.keys = () => [];`,
            'node_modules/ts-transformer-keys/index.d.ts': `export function keys<T>(): Array<Extract<keyof T, string>>;`,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string }`,
            'src/a.ts': `
                import { keys } from 'ts-transformer-keys';
                import { M } from './model';
                export const F = keys<M>();
            `,
        });
        expect(() => runGen(baseOpts(root))).toThrow(/legacy.*keys<T>\(\)/);
    });

    it('--allow-legacy derives names for legacy sites', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'node_modules/ts-transformer-keys/package.json': JSON.stringify({
                name: 'ts-transformer-keys',
                main: 'index.js',
            }),
            'node_modules/ts-transformer-keys/index.js': `exports.keys = () => [];`,
            'node_modules/ts-transformer-keys/index.d.ts': `export function keys<T>(): Array<Extract<keyof T, string>>;`,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface UserModel { id: string }`,
            'src/a.ts': `
                import { keys } from 'ts-transformer-keys';
                import { UserModel } from './model';
                export const F = keys<UserModel>();
            `,
        });
        const res = runGen(baseOpts(root, { allowLegacy: true }));
        expect(res.entries.map(e => e.name)).toEqual(['userModel']);
        expect(res.legacyLeftovers).toHaveLength(1);
    });

    it('fails on duplicate name with divergent field sets', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
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
        expect(() => runGen(baseOpts(root))).toThrow(/divergent/);
    });

    it('fails on duplicate name with same type text but divergent local fields', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
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
        expect(() => runGen(baseOpts(root))).toThrow(/divergent/);
    });

    it('fails on empty scan by default, allows with --allow-empty', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/a.ts': `export const x = 1;`,
        });
        expect(() => runGen(baseOpts(root))).toThrow(/no `fieldKeys/);
        const res = runGen(baseOpts(root, { allowEmpty: true }));
        expect(res.entries).toHaveLength(0);
        expect(res.content).toContain('as Record<');
    });

    it('reports skipped migrated and legacy sites whose types expose no fields', () => {
        const migratedRoot = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/a.ts': `
                import { fieldKeys } from './generated/field-registry';
                export const F = fieldKeys.empty<{}>();
            `,
        });
        const migrated = runGen(baseOpts(migratedRoot, { allowEmpty: true }));
        expect(migrated.entries).toHaveLength(0);
        expect(migrated.skipped).toEqual([
            { relPath: 'src/a.ts', typeArgText: '{}', reason: 'type resolved to no properties' },
        ]);

        const legacyRoot = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...{
                'node_modules/ts-transformer-keys/package.json': JSON.stringify({
                    name: 'ts-transformer-keys',
                    main: 'index.js',
                }),
                'node_modules/ts-transformer-keys/index.js': `exports.keys = () => [];`,
                'node_modules/ts-transformer-keys/index.d.ts': `export function keys<T>(): Array<Extract<keyof T, string>>;`,
            },
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/a.ts': `
                import { keys } from 'ts-transformer-keys';
                export const F = keys<{}>();
            `,
        });
        const legacy = runGen(baseOpts(legacyRoot, { allowLegacy: true, allowEmpty: true }));
        expect(legacy.entries).toHaveLength(0);
        expect(legacy.skipped).toEqual([
            { relPath: 'src/a.ts', typeArgText: '{}', reason: 'type resolved to no properties' },
        ]);
    });
});
