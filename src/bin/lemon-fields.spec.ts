/**
 * `lemon-fields.spec.ts`
 * - CLI entry 기준의 option parsing, exit code, stdout/stderr 테스트.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added CLI scenario tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { bootstrapStub } from '../fields/field-gen';
import { main } from './lemon-fields';

const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-fields-cli-'));
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

interface CliResult {
    code: number;
    stdout: string;
    stderr: string;
}

/**
 * temp project cwd에서 CLI main을 실행하고 stdout/stderr를 문자열로 수집한다.
 */
export const instance = (root: string, argv: string[]): CliResult => {
    const cwd = process.cwd();
    const out = process.stdout.write;
    const err = process.stderr.write;
    const stdout: string[] = [];
    const stderr: string[] = [];

    (process.stdout.write as any) = (chunk: any) => {
        stdout.push(String(chunk));
        return true;
    };
    (process.stderr.write as any) = (chunk: any) => {
        stderr.push(String(chunk));
        return true;
    };

    try {
        process.chdir(root);
        const code = main(argv);
        return { code, stdout: stdout.join(''), stderr: stderr.join('') };
    } finally {
        process.chdir(cwd);
        (process.stdout.write as any) = out;
        (process.stderr.write as any) = err;
    }
};

//! main test body.
describe('lemon-fields CLI', () => {
    //* basic function
    it('should pass help, unknown flag and missing value output', () => {
        const root = makeTmpProject({ 'tsconfig.json': TSCONFIG });

        const help = instance(root, ['--help']);
        expect(help.code).toBe(0);
        expect(help.stdout).toContain('lemon-fields');
        expect(help.stdout).toContain('USAGE');
        expect(help.stderr).toBe('');

        const bad = instance(root, ['--unknown']);
        expect(bad.code).toBe(1);
        expect(bad.stdout).toBe('');
        expect(bad.stderr).toContain('[lemon-fields] ERROR: unknown flag: --unknown');

        const missing = instance(root, ['gen', '--paths', '--check']);
        expect(missing.code).toBe(1);
        expect(missing.stdout).toBe('');
        expect(missing.stderr).toContain('[lemon-fields] ERROR: missing value for --paths');
    });

    //* migrate report
    it('should pass migrate --report output format', () => {
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

        const res = instance(root, ['migrate', '--report']);
        const after = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        expect(res.code).toBe(0);
        expect(res.stderr).toBe('');
        expect(res.stdout).toContain('[lemon-fields] migrate — rewrote 1 site(s), 1 file(s); wrote bootstrap stub.');
        expect(res.stdout).toContain('src/a.ts  keys<UserModel>() -> fieldKeys.userModel<UserModel>()');
        expect(after).toContain('fieldKeys.userModel<UserModel>()');
    });

    it('should pass migrate --dry-run --diff --update-tsconfig output', () => {
        const tsconfig = JSON.stringify({
            compilerOptions: {
                target: 'es2017',
                module: 'commonjs',
                plugins: [{ transform: 'ts-transformer-keys/transformer' }],
            },
            include: ['src/**/*'],
        });
        const root = makeTmpProject({
            'tsconfig.json': tsconfig,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `interface M { id: string }`,
                `export const X = keys<M>();`,
            ].join('\n'),
        });
        const before = fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8');

        const res = instance(root, ['migrate', '--dry-run', '--diff', '--update-tsconfig']);

        expect(res.code).toBe(0);
        expect(res.stdout).toContain('[lemon-fields] [dry-run] migrate — rewrote 1 site(s), 1 file(s).');
        expect(res.stdout).toContain('--- src/a.ts');
        expect(res.stdout).toContain(`+import { fieldKeys } from './generated/field-registry';`);
        expect(res.stdout).toContain('would update tsconfig');
        expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf8')).toBe(before);
        expect(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).toBe(tsconfig);
    });

    //* check drift guard
    it('should pass gen --check drift and up-to-date exit codes', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface UserModel { id: string; name: string }`,
            'src/a.ts': [
                `import { fieldKeys } from './generated/field-registry';`,
                `import { UserModel } from './model';`,
                `export const F = fieldKeys.userModel<UserModel>();`,
            ].join('\n'),
        });
        const out = path.join(root, 'src/generated/field-registry.ts');

        const drift = instance(root, ['--check']);
        expect(drift.code).toBe(1);
        expect(drift.stdout).toBe('');
        expect(drift.stderr).toContain('registry drift detected at src/generated/field-registry.ts');
        expect(fs.readFileSync(out, 'utf8')).toBe(bootstrapStub());

        const gen = instance(root, ['gen']);
        expect(gen.code).toBe(0);
        expect(gen.stdout).toContain('gen — 1 entries, wrote src/generated/field-registry.ts');

        const ok = instance(root, ['--check']);
        expect(ok.code).toBe(0);
        expect(ok.stdout).toContain('ok — 1 entries up-to-date');
        expect(ok.stderr).toBe('');
    });

    it('should pass gen --report output format', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface CatalogModel { id: string; public: boolean }`,
            'src/a.ts': [
                `import { fieldKeys } from './generated/field-registry';`,
                `import { CatalogModel } from './model';`,
                `export const F = fieldKeys.catalogModel<CatalogModel>();`,
            ].join('\n'),
        });

        const res = instance(root, ['gen', '--report']);

        expect(res.code).toBe(0);
        expect(res.stderr).toBe('');
        expect(res.stdout).toContain('[lemon-fields] gen — 1 entries, wrote src/generated/field-registry.ts');
        expect(res.stdout).toContain('[lemon-fields] report — 1 generated entry:');
        expect(res.stdout).toContain('catalogModel  src/a.ts#CatalogModel  fields(2): id, public');
    });

    //* paths option
    it('should pass gen --paths while keeping imported model type context', () => {
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

        const res = instance(root, ['gen', '--paths', 'src/modules/user/**/*.ts']);
        const registry = fs.readFileSync(path.join(root, 'src/generated/field-registry.ts'), 'utf8');

        expect(res.code).toBe(0);
        expect(res.stdout).toContain('gen — 1 entries, wrote src/generated/field-registry.ts');
        expect(registry).toContain('userModel');
        expect(registry).toContain('["id", "name"]');
        expect(registry).not.toContain('postModel');
    });

    //* common flags
    it('should pass custom --tsconfig, --out and --no-include-spec flags', () => {
        const root = makeTmpProject({
            'tsconfig.fields.json': TSCONFIG,
            'src/custom/registry.ts': bootstrapStub(),
            'src/model.ts': `export interface M { id: string }`,
            'src/a.ts': `
                import { fieldKeys } from './custom/registry';
                import { M } from './model';
                export const PROD = fieldKeys.prodModel<M>();
            `,
            'src/a.spec.ts': `
                import { fieldKeys } from './custom/registry';
                import { M } from './model';
                describe('x', () => { it('y', () => fieldKeys.specModel<M>()); });
            `,
        });

        const res = instance(root, [
            'gen',
            '--tsconfig',
            'tsconfig.fields.json',
            '--out',
            'src/custom/registry.ts',
            '--no-include-spec',
        ]);
        const registry = fs.readFileSync(path.join(root, 'src/custom/registry.ts'), 'utf8');

        expect(res.code).toBe(0);
        expect(res.stdout).toContain('gen — 1 entries, wrote src/custom/registry.ts');
        expect(registry).toContain('prodModel');
        expect(registry).not.toContain('specModel');
    });

    //* allow-legacy
    it('should pass gen --allow-legacy stderr summary', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/model.ts': `export interface UserModel { id: string }`,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `import { UserModel } from './model';`,
                `export const F = keys<UserModel>();`,
            ].join('\n'),
        });

        const res = instance(root, ['gen', '--allow-legacy']);

        expect(res.code).toBe(0);
        expect(res.stdout).toContain('gen — 1 entries, wrote src/generated/field-registry.ts');
        expect(res.stderr).toContain('legacy leftovers (--allow-legacy): 1');
    });

    //* empty property set parity + migrate skipped output
    it('should materialise empty property sets for gen and keep migrate skipped output', () => {
        const genRoot = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': bootstrapStub(),
            'src/a.ts': `
                import { fieldKeys } from './generated/field-registry';
                interface A { a: string }
                interface B { b: string }
                export const EMPTY = fieldKeys.empty<{}>();
                export const UNION = fieldKeys.union<A | B>();
            `,
        });
        const gen = instance(genRoot, ['gen']);
        const registry = fs.readFileSync(path.join(genRoot, 'src/generated/field-registry.ts'), 'utf8');

        expect(gen.code).toBe(0);
        expect(gen.stderr).toBe('');
        expect(registry).toContain(`empty: <T extends object>() =>`);
        expect(registry).toContain(`[] as Array<Extract<keyof T, string>>`);
        expect(registry).toContain(`union: <T extends object>() =>`);

        const migRoot = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            ...TS_TRANSFORMER_KEYS_STUB,
            'src/a.ts': [
                `import { keys } from 'ts-transformer-keys';`,
                `export function grab<T>(): string[] { return keys<T>(); }`,
            ].join('\n'),
        });
        const mig = instance(migRoot, ['migrate', '--allow-skips']);
        expect(mig.code).toBe(0);
        expect(mig.stderr).toContain('[lemon-fields] skipped 1 site(s):');
        expect(mig.stderr).toContain('src/a.ts :: keys<T>() — type argument is an enclosing generic parameter');
    });
});
