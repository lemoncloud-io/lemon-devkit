/**
 * `field-migrate.spec.ts`
 * - AST 보존 여부를 확인하는 migration integration test.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added migration codemod tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MigrateOptions, runMigrate } from './field-migrate';
import { bootstrapStub, runGen } from './field-gen';

const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-fields-mig-'));
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

const TS_TRANSFORMER_KEYS_STUB: Record<string, string> = {
    'node_modules/ts-transformer-keys/package.json': JSON.stringify({
        name: 'ts-transformer-keys',
        main: 'index.js',
    }),
    'node_modules/ts-transformer-keys/index.js': `exports.keys = () => [];`,
    'node_modules/ts-transformer-keys/index.d.ts': `export function keys<T>(): Array<Extract<keyof T, string>>;`,
};

const TS_TRANSFORMER_KEYS_MIXED_STUB: Record<string, string> = {
    'node_modules/ts-transformer-keys/package.json': JSON.stringify({
        name: 'ts-transformer-keys',
        main: 'index.js',
    }),
    'node_modules/ts-transformer-keys/index.js': `exports.keys = () => []; exports.other = 1;`,
    'node_modules/ts-transformer-keys/index.d.ts': [
        `export function keys<T>(): Array<Extract<keyof T, string>>;`,
        `export const other: number;`,
    ].join('\n'),
};

const opts = (root: string, over: Partial<MigrateOptions> = {}): MigrateOptions => ({
    tsconfig: path.join(root, 'tsconfig.json'),
    out: 'src/generated/field-registry.ts',
    includeSpec: true,
    dryRun: false,
    allowSkips: false,
    cwd: root,
    ...over,
});

describe('runMigrate — happy paths', () => {
    it('rewrites a simple call; preserves .filter tail and surrounding code', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/model.ts': `export interface UserModel { id: string; _secret: number; name: string }`,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `import { UserModel } from './model';`,
                ``,
                `export const FIELDS: string[] = keys<UserModel>().filter(_ => !_.startsWith('_'));`,
            ].join('\n'),
        });
        const res = runMigrate(opts(root));
        expect(res.rewrites).toHaveLength(1);
        expect(res.wroteStub).toBe(true);

        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        expect(after).not.toContain(`import { keys }`);
        expect(after).toContain(`import { fieldKeys } from './generated/field-registry'`);
        expect(after).toMatch(/fieldKeys\.userModel<UserModel>\(\)\.filter/);
        expect(after).toContain(`.filter(_ => !_.startsWith('_'))`);
    });

    it('should pass existing double quote import style', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from "ts-transformer-keys";`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        expect(after).toContain(`import { fieldKeys } from "./generated/field-registry";`);
    });

    it('preserves intersection types and enclosing-context-derived names', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/modules/boards/model.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface Review { id: string }`,
                `interface Question { id: string; q: string }`,
                `interface PostModel { id: string; type: string }`,
                ``,
                `const filterFields = (a: string[], b: string[] = []) => [...a, ...b];`,
                ``,
                `export const FIELDS = {`,
                `    post: filterFields(`,
                `        keys<Review & Question>(),`,
                `        filterFields(keys<PostModel>()),`,
                `    ),`,
                `};`,
            ].join('\n'),
        });
        const res = runMigrate(opts(root));
        expect(res.rewrites.map(r => r.name).sort()).toEqual(['postMix', 'postModel']);

        const after = fs.readFileSync(path.join(root, 'src/modules/boards/model.ts'), 'utf8');
        expect(after).toMatch(/fieldKeys\.postMix<Review & Question>\(\)/);
        expect(after).toMatch(/fieldKeys\.postModel<PostModel>\(\)/);
        expect(after).toContain(`filterFields(`);
    });

    it('preserves `as Foo[]` casts and direct array exports', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/x.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface Overridable { a: string; b: string }`,
                `type OverridableKey = keyof Overridable;`,
                `export const OVERRIDABLES: OverridableKey[] = keys<Overridable>();`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/x.ts'), 'utf8');
        expect(after).toMatch(/: OverridableKey\[\] = fieldKeys\.overridable<Overridable>\(\)/);
    });

    it('aliases the registry import when `fieldKeys` name is already taken', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `const fieldKeys = 42;`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
                `export const Y = fieldKeys;`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        expect(after).toMatch(/import \{ fieldKeys as lemonFieldKeys \}/);
        expect(after).toMatch(/lemonFieldKeys\.m<M>\(\)/);
        expect(after).toContain(`const fieldKeys = 42;`);
    });

    it('rewrites aliased legacy import and preserves mixed legacy imports', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_MIXED_STUB,
            'src/a.ts': [
                `import { keys as typeKeys, other } from 'ts-transformer-keys';`,
                `interface M { id: string }`,
                `export const X = typeKeys<M>();`,
                `export const O = other;`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        expect(after).toContain(`import { other } from 'ts-transformer-keys';`);
        expect(after).toContain(`fieldKeys.m<M>()`);
        expect(after).toContain(`export const O = other;`);
    });

    it('merges fieldKeys into an existing registry import', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/generated/field-registry.ts': [bootstrapStub(), `export const other = 1;`].join('\n'),
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `import { other } from './generated/field-registry';`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
                `export const O = other;`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        expect(after).toContain(`import { other, fieldKeys } from './generated/field-registry';`);
        expect(after).toContain(`fieldKeys.m<M>()`);
    });

    it('writes bootstrap stub when missing and emits the expected Record<...> shape', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': `import { keys } from 'ts-transformer-keys';\ninterface M { id: string }\nexport const X = keys<M>();`,
        });
        const res = runMigrate(opts(root));
        expect(res.wroteStub).toBe(true);
        const stub = fs.readFileSync(path.join(root, 'src/generated/field-registry.ts'), 'utf8');
        expect(stub).toContain('export const fieldKeys = {} as Record<');
    });

    it('should pass dry-run diff without file changes', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
            ].join('\n'),
        });
        const before = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        const res = runMigrate(opts(root, { dryRun: true, diff: true }));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        expect(after).toBe(before);
        expect(res.diffs?.[0]).toContain('--- src/a.ts');
        expect(res.diffs?.[0]).toContain(`-import { keys } from 'ts-transformer-keys';`);
        expect(res.diffs?.[0]).toContain(`+import { fieldKeys } from './generated/field-registry';`);
        expect(res.diffs?.[0]).toContain(`+export const X = fieldKeys.m<M>();`);
    });

    it('should pass --update-tsconfig after full migration', () => {
        const root = makeTmpProject({
            'tsconfig.json': JSON.stringify({
                compilerOptions: {
                    target: 'es2017',
                    module: 'commonjs',
                    plugins: [{ transform: 'ts-transformer-keys/transformer' }, { transform: 'other-transformer' }],
                },
                include: ['src/**/*'],
            }),
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
            ].join('\n'),
        });
        const res = runMigrate(opts(root, { updateTsconfig: true }));
        const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'));

        expect(res.updatedTsconfig).toBe(true);
        expect(tsconfig.compilerOptions.plugins).toEqual([{ transform: 'other-transformer' }]);
    });

    it('migrate then gen produces a concrete registry with correct fields', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/model.ts': `export interface UserModel { id: string; name: string }`,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `import { UserModel } from './model';`,
                `export const F = keys<UserModel>();`,
            ].join('\n'),
        });
        runMigrate(opts(root));
        const res = runGen({
            tsconfig: path.join(root, 'tsconfig.json'),
            out: 'src/generated/field-registry.ts',
            includeSpec: true,
            allowLegacy: false,
            allowEmpty: false,
            cwd: root,
        });
        expect(res.entries.map(e => e.name)).toEqual(['userModel']);
        expect(res.entries[0].fields).toEqual(['id', 'name']);
    });

    it('should pass --paths scan only selected legacy files', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface AModel { id: string }`,
                `export const A = keys<AModel>();`,
            ].join('\n'),
            'src/b.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface BModel { id: string }`,
                `export const B = keys<BModel>();`,
            ].join('\n'),
        });

        const res = runMigrate(opts(root, { paths: ['src/a.ts'] }));
        const a = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        const b = fs.readFileSync(path.join(root, 'src/b.ts'), 'utf8');

        expect(res.rewrites.map(r => r.name)).toEqual(['aModel']);
        expect(a).toContain('fieldKeys.aModel<AModel>()');
        expect(b).toContain(`keys<BModel>()`);
    });
});

describe('runMigrate — failure modes', () => {
    it('fails by default when a site uses an enclosing generic parameter', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `export function grab<T>(): string[] { return keys<T>(); }`,
            ].join('\n'),
        });
        expect(() => runMigrate(opts(root))).toThrow(/enclosing generic parameter/);
    });

    it('--allow-skips reports but does not throw on unrewritable sites', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `export function grab<T>(): string[] { return keys<T>(); }`,
            ].join('\n'),
        });
        const res = runMigrate(opts(root, { allowSkips: true }));
        expect(res.skipped).toHaveLength(1);
        expect(res.rewrites).toHaveLength(0);
    });

    it('--allow-skips reports calls without type argument and keeps source valid', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [`import { keys } from 'ts-transformer-keys';`, `export const X = keys();`].join('\n'),
        });
        const res = runMigrate(opts(root, { allowSkips: true }));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        expect(res.skipped).toEqual([{ relPath: 'src/a.ts', typeArgText: '', reason: 'no type argument' }]);
        expect(after).toContain(`import { keys } from 'ts-transformer-keys';`);
        expect(after).toContain(`keys()`);
    });

    it('removes unused legacy import when no keys call exists', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [`import { keys } from 'ts-transformer-keys';`, `export const X = 1;`].join('\n'),
        });
        const res = runMigrate(opts(root));
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        expect(res.rewrites).toHaveLength(0);
        expect(after).not.toContain(`ts-transformer-keys`);
        expect(after).toContain(`export const X = 1;`);
    });

    it('dry-run makes no file changes', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': `import { keys } from 'ts-transformer-keys';\ninterface M { id: string }\nexport const X = keys<M>();`,
        });
        const before = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        const res = runMigrate(opts(root, { dryRun: true }));
        expect(res.rewrites).toHaveLength(1);
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');
        expect(after).toBe(before);
        expect(fs.existsSync(path.join(root, 'src/generated/field-registry.ts'))).toBe(false);
    });
});
