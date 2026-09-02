/**
 * `field-guard-common.spec.ts`
 * - temp fixture project 기준의 `runGuardCommon` 직접 단위 스펙.
 * - 목적: `guard-common` CLI 시나리오(`lemon-fields.spec.ts`)로만 간접 검증되던
 *   내부 분기를 `runGuardCommon` 직접 호출로 고정한다 (레몬 모듈 강화 프로그램 트랙3 WP-D2).
 *
 * @author      Claude (WP-D2)
 * @date        2026-09-02 added direct runGuardCommon spec (branch coverage hardening).
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_COMMON_MODEL_FIELDS, formatCommonFields } from './common-fields';
import { GuardCommonOptions, runGuardCommon } from './field-guard-common';

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
    // 픽스처 디렉터리로만 include를 제한한다 — repo 소스를 끌어오지 않기 위함 (함정 #1).
    include: ['src/**/*'],
    exclude: ['node_modules', '**/*.spec.ts'],
});

//* temp fixture project를 파일 단위로 빠르게 조립한다 (field-gen.spec.ts 패턴 재사용).
const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-guard-common-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return root;
};

const baseOpts = (root: string, over: Partial<GuardCommonOptions> = {}): GuardCommonOptions => ({
    tsconfig: path.join(root, 'tsconfig.json'),
    targetName: 'checkAllKeys',
    dryRun: true,
    cwd: root,
    ...over,
});

const readFile = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

//* `$mock = filterFields([], ['meta'])` 형태 — CORE_FIELDS 미사용, registry 미사용 (DEFAULT_COMMON_MODEL_FIELDS 폴백 경로).
const mockSpecBody = (varName = '$mock'): string =>
    [
        `import { expect2 } from 'lemon-core';`,
        `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
        `const ${varName} = filterFields([], ['meta']);`,
        `describe('x', () => {`,
        `    const notInModel = (fields: string[]) => fields.filter(s => !${varName}.includes(s));`,
        `    const checkAllKeys = (model: object, fields: string[]) => {`,
        `        const keys = Object.keys(model);`,
        `        const alls = notInModel(fields);`,
        `        return alls.filter(k => !keys.includes(k));`,
        `    };`,
        `});`,
    ].join('\n');

describe('runGuardCommon — cwd/out 기본값', () => {
    it('cwd 미지정 시 dirname(tsconfig)를 cwd로 쓰고, out 미지정 시 기본 registry 경로를 읽는다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            // out 기본값 위치에 registry 배치 — 기본 경로 해석이 실제로 여기까지 미치는지 검증.
            'src/generated/field-registry.ts': [
                `export const fieldKeys = {`,
                `    mockModel: <T extends object>() =>`,
                `        ["ns", "gid", "cid"] as Array<Extract<keyof T, string>>,`,
                `} as const;`,
            ].join('\n'),
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `import { fieldKeys } from './generated/field-registry';`,
                `type Model = { ns: string; gid: string; cid?: string };`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields(fieldKeys.mockModel<Model>(), ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        const keys = Object.keys(model);`,
                `        return notInModel(fields).filter(k => !keys.includes(k));`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        // cwd/out 둘 다 생략 — tsconfig만 넘긴다 (기본값 분기 고정).
        const res = runGuardCommon({
            tsconfig: path.join(root, 'tsconfig.json'),
            targetName: 'checkAllKeys',
            dryRun: true,
        });

        expect(res.guards.length).toBe(1);
        expect(res.guards[0].varName).toBe('$mock');
        // registry field(ns,gid,cid)가 반영됐다면 기본 out 경로에서 실제로 읽었다는 뜻.
        // sortCommonFields: 길이 우선, 동일 길이는 locale 비교 — 'ns'(2) < 'cid'/'gid'(3, 'c'<'g') < 'meta'(4).
        expect(res.guards[0].expected).toBe('ns,cid,gid,meta');
    });

    it('cwd/out을 명시하면 해당 경로를 resolve해서 쓴다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'registry/field-registry.ts': [
                `export const fieldKeys = {`,
                `    mockModel: <T extends object>() => ["ns"] as Array<Extract<keyof T, string>>,`,
                `} as const;`,
            ].join('\n'),
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `import { fieldKeys } from '../registry/field-registry';`,
                `type Model = { ns: string };`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields(fieldKeys.mockModel<Model>(), ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        return notInModel(fields);`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(
            baseOpts(root, { out: 'registry/field-registry.ts', cwd: path.resolve(root, '.') }),
        );

        expect(res.guards.length).toBe(1);
        expect(res.guards[0].expected).toBe('ns,meta');
    });
});

describe('runGuardCommon — paths 옵션', () => {
    it('paths 미지정 시 DEFAULT_PATHS(src/**/*.spec.ts)로 스캔한다 (cwd-join 재시도 경로)', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        // paths 생략 — process.cwd()(devkit repo)와 root가 다르므로 1차 매치는 실패하고
        // cwd-join 재시도가 성공해야 guard가 잡힌다.
        const res = runGuardCommon(baseOpts(root));

        expect(res.guards.length).toBe(1);
        expect(res.guards[0].relPath).toBe('src/mock.spec.ts');
    });

    it('paths에 절대경로 glob을 주면 그대로 스캔한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root, { paths: [path.join(root, 'src/**/*.spec.ts')] }));

        expect(res.guards.length).toBe(1);
        expect(res.guards[0].relPath).toBe('src/mock.spec.ts');
    });

    it('상대 glob이 cwd와 process.cwd()가 일치할 때는 1차 시도에서 바로 매치된다', () => {
        const root = fs.realpathSync(makeTmpProject({}));
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'tsconfig.json'), TSCONFIG, 'utf8');
        fs.writeFileSync(path.join(root, 'src/mock.spec.ts'), mockSpecBody(), 'utf8');

        const prevCwd = process.cwd();
        process.chdir(root);
        try {
            const res = runGuardCommon(baseOpts(root, { paths: ['src/**/*.spec.ts'] }));
            expect(res.guards.length).toBe(1);
            expect(res.guards[0].relPath).toBe('src/mock.spec.ts');
        } finally {
            process.chdir(prevCwd);
        }
    });

    it('node_modules 하위 파일은 스캔 결과에서 제외한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
            'node_modules/fake-pkg/deep.spec.ts': mockSpecBody('$fake'),
        });

        // node_modules까지 넓게 잡는 glob으로 스캔해도 node_modules는 걸러져야 한다.
        const res = runGuardCommon(baseOpts(root, { paths: ['**/*.spec.ts'] }));

        expect(res.guards.length).toBe(1);
        expect(res.guards.every(g => !g.relPath.includes('node_modules'))).toBe(true);
        expect(res.changedFiles.every(f => !f.includes(`${path.sep}node_modules${path.sep}`))).toBe(true);
    });
});

describe('runGuardCommon — checkAllKeys 블록 탐색', () => {
    it('function 선언 형태의 checkAllKeys도 찾고, 이름이 다른 함수는 무시한다', () => {
        // findTargetBlocks의 sf.getFunctions() 순회는 소스파일 최상위(top-level) 함수
        // 선언만 본다 — describe(...) 콜백 안에 중첩된 function은 잡히지 않으므로
        // 두 함수 선언 모두 module top-level에 둔다.
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                // 이름이 다른 top-level 함수 선언 — findTargetBlocks의 name!==targetName continue 분기.
                `function checkOtherKeys(model: object, fields: string[]) {`,
                `    const commons = fields.reduce<string[]>((L, a) => {`,
                `        if ($mock.includes(a)) L.push(a);`,
                `        return L;`,
                `    }, []);`,
                `    return commons;`,
                `}`,
                // 대상 top-level 함수 선언 형태.
                `function checkAllKeys(model: object, fields: string[]) {`,
                `    const commons = fields.reduce<string[]>((L, a) => {`,
                `        if ($mock.includes(a)) L.push(a);`,
                `        return L;`,
                `    }, []);`,
                `    return commons;`,
                `}`,
                `describe('x', () => {`,
                `    it('uses both', () => {`,
                `        checkOtherKeys({}, []);`,
                `        checkAllKeys({}, []);`,
                `    });`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));

        expect(res.guards.length).toBe(1);
        expect(res.guards[0].varName).toBe('$mock');
    });

    it('checkAllKeys 이름의 변수 선언이 arrow function이 아니면 블록으로 취급하지 않는다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                `describe('x', () => {`,
                // checkAllKeys라는 이름이지만 arrow function이 아닌 값 — init이 있으나 asKind(ArrowFunction)이 실패.
                `    const checkAllKeys = 42;`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));

        expect(res.guards.length).toBe(0);
        expect(res.changedFiles.length).toBe(0);
    });

    it('checkAllKeys 블록이 파일에 없으면 변경이 없다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `describe('x', () => {`,
                `    it('does nothing with checkAllKeys', () => {`,
                `        expect(1).toBe(1);`,
                `    });`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));

        expect(res.guards.length).toBe(0);
        expect(res.changedFiles.length).toBe(0);
    });

    it('checkAllKeys가 arrow function이어도 표현식 바디(중괄호 없음)면 블록을 못 찾아 건너뛴다', () => {
        // findTargetBlocks: init.getBody().asKind(Block)이 undefined가 되는 경우 —
        // 이름/arrow 여부까지는 통과하지만 body가 Block이 아니라서 blocks에 push되지 않는다.
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/control.spec.ts': mockSpecBody(),
            'src/expr-body.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                `const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                // 중괄호 없는 단일 표현식 arrow — getBody()가 Block이 아니라 CallExpression을 반환.
                `const checkAllKeys = (model: object, fields: string[]) => notInModel(fields);`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));

        expect(res.guards.some(g => g.relPath === 'src/control.spec.ts')).toBe(true);
        expect(res.guards.some(g => g.relPath === 'src/expr-body.spec.ts')).toBe(false);
        expect(res.changedFiles.some(f => f.endsWith('expr-body.spec.ts'))).toBe(false);
    });
});

describe('runGuardCommon — base 변수 결정', () => {
    it('commons 변수의 초기화식에서 base 변수를 찾는다 (findBaseVarFromCommons)', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].varName).toBe('$mock');
    });

    it('commons 변수가 없으면 notInModel 초기화식에서 base 변수로 폴백한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                // checkAllKeys 블록 내부에 'commons' 변수를 전혀 선언하지 않는 형태.
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        const keys = Object.keys(model);`,
                `        return notInModel(fields).filter(k => !keys.includes(k));`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].varName).toBe('$mock');
    });

    it('commons도 notInModel도 base 변수를 못 찾으면 해당 블록은 건너뛴다 (continue)', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            // 대조군: 정상적으로 base 변수를 찾을 수 있는 파일 — 스캔 자체는 계속 진행됨을 증명.
            'src/control.spec.ts': mockSpecBody(),
            // 실험군: commons도 notInModel도 없는 checkAllKeys 블록.
            'src/orphan.spec.ts': [
                `describe('x', () => {`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        return fields.filter(f => !Object.keys(model).includes(f));`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));

        // control 파일만 guard가 잡히고 orphan 파일은 블록이 있어도 base 변수가 없어 스킵된다.
        expect(res.guards.length).toBe(1);
        expect(res.guards.some(g => g.relPath === 'src/control.spec.ts')).toBe(true);
        expect(res.guards.some(g => g.relPath === 'src/orphan.spec.ts')).toBe(false);
        expect(res.changedFiles.some(f => f.endsWith('orphan.spec.ts'))).toBe(false);
    });
});

describe('runGuardCommon — $ 포함 여부 (includesDollarFromInitializer)', () => {
    it('base 변수가 CORE_FIELDS를 사용하면 $ 를 포함한 guard를 만든다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/flows.spec.ts': [
                `import { expect2, CORE_FIELDS } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $node = filterFields([], CORE_FIELDS);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$node.includes(s));`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        return notInModel(fields);`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].expected).toBe(formatCommonFields(DEFAULT_COMMON_MODEL_FIELDS, {}));
        expect(res.guards[0].expected.startsWith('$,')).toBe(true);
    });

    it('base 변수의 배열 리터럴에 $ 가 없으면 guard에서 $ 를 제외한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].expected).toBe(formatCommonFields(DEFAULT_COMMON_MODEL_FIELDS, { exclude: ['$'] }));
        expect(res.guards[0].expected.includes('$')).toBe(false);
    });
});

describe('runGuardCommon — expected fields 계산 (registry vs 폴백)', () => {
    it('registry에 매칭되는 fieldKeys 호출이 있으면 registry 필드를 사용한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/generated/field-registry.ts': [
                `export const fieldKeys = {`,
                `    chatsModel: <T extends object>() =>`,
                `        ["id", "ns", "_id", "cid", "gid", "sid", "uid", "lock", "next", "type", "error", "stereo", "createdAt", "deletedAt", "updatedAt"] as Array<Extract<keyof T, string>>,`,
                `} as const;`,
            ].join('\n'),
            'src/chats/transformer.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `import { fieldKeys } from '../generated/field-registry';`,
                `type Model = { id: string; ns: string; cid?: string; gid: string };`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields.filter(field => field !== '_id'));`,
                `const $mock = filterFields(fieldKeys.chatsModel<Model>(), ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                `        return notInModel(fields);`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root, { out: 'src/generated/field-registry.ts' }));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].expected).toBe('id,ns,cid,gid,sid,uid,lock,meta,next,type,error,stereo,createdAt,deletedAt,updatedAt');
    });

    it('registry 매칭이 없으면 DEFAULT_COMMON_MODEL_FIELDS로 폴백한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].expected).toBe(formatCommonFields(DEFAULT_COMMON_MODEL_FIELDS, { exclude: ['$'] }));
    });
});

describe('runGuardCommon — upsertGuard 3가지 결과', () => {
    it("최초 삽입 시 action은 'inserted'다", () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].action).toBe('inserted');
    });

    it("기존 guard가 있지만 expected 값이 다르면 action은 'updated'다", () => {
        const staleGuard = [
            `    //* 최소한, 만일 \`keys()\`가 잘 작동했다면, 공통 필드를 가지고 있어야함.`,
            `    const commons = fields.reduce<string[]>((L, a) => {`,
            `        if ($mock.includes(a)) L.push(a);`,
            `        return L;`,
            `    }, []);`,
            `    expect2(() => $mock?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(`,
            `        'STALE_NOT_REAL_VALUE',`,
            `    );`,
            `    expect2(() => commons?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(`,
            `        'STALE_NOT_REAL_VALUE',`,
            `    );`,
        ].join('\n');

        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                `    const checkAllKeys = (model: object, fields: string[]) => {`,
                staleGuard,
                `        const keys = Object.keys(model);`,
                `        return notInModel(fields).filter(k => !keys.includes(k));`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        const res = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(res.guards.length).toBe(1);
        expect(res.guards[0].action).toBe('updated');
        const expected = formatCommonFields(DEFAULT_COMMON_MODEL_FIELDS, { exclude: ['$'] });
        expect(res.guards[0].expected).toBe(expected);

        const after = readFile(root, 'src/mock.spec.ts');
        expect(after).toContain(`'${expected}'`);
        expect(after).not.toContain('STALE_NOT_REAL_VALUE');
    });

    it('기존 guard가 이미 정확하면 action은 undefined이고 changedFiles에 들어가지 않는다 (재실행 no-op)', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const first = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(first.guards.length).toBe(1);
        expect(first.guards[0].action).toBe('inserted');

        const second = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(second.guards.length).toBe(0);
        expect(second.changedFiles.length).toBe(0);
    });
});

describe('runGuardCommon — diff 옵션', () => {
    it('diff:true면 변경된 파일의 unified diff를 diffs에 담는다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root, { diff: true }));
        expect(res.guards.length).toBe(1);
        expect(res.diffs).toBeDefined();
        expect(res.diffs!.length).toBe(1);
        expect(res.diffs![0]).toContain('--- src/mock.spec.ts');
        expect(res.diffs![0]).toContain('+++ src/mock.spec.ts');
        expect(res.diffs![0]).toMatch(/^\+/m);
    });

    it('변경된 파일이 없으면 diff:true여도 빈 배열을 반환한다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });

        runGuardCommon(baseOpts(root, { dryRun: false }));
        const noop = runGuardCommon(baseOpts(root, { dryRun: false, diff: true }));

        expect(noop.guards.length).toBe(0);
        expect(noop.changedFiles.length).toBe(0);
        expect(noop.diffs).toEqual([]);
    });
});

describe('runGuardCommon — dryRun 옵션', () => {
    it('dryRun:true면 결과는 계산하되 파일은 건드리지 않는다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });
        const before = readFile(root, 'src/mock.spec.ts');

        const res = runGuardCommon(baseOpts(root, { dryRun: true }));
        expect(res.guards.length).toBe(1);
        expect(res.changedFiles.length).toBe(1);

        const after = readFile(root, 'src/mock.spec.ts');
        expect(after).toBe(before);
    });

    it('dryRun:false면 실제로 파일에 guard가 반영된다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': mockSpecBody(),
        });
        const before = readFile(root, 'src/mock.spec.ts');

        const res = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(res.guards.length).toBe(1);

        const after = readFile(root, 'src/mock.spec.ts');
        expect(after).not.toBe(before);
        expect(after).toContain('expect2(() => $mock?.sort');
        expect(after).toContain('expect2(() => commons?.sort');
    });
});

describe('runGuardCommon — guards[] 결과 필드', () => {
    it('relPath는 posix 구분자, targetName/varName/expected/action 필드를 모두 채운다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/nested/dir/mock.spec.ts': mockSpecBody(),
        });

        const res = runGuardCommon(baseOpts(root, { dryRun: false }));
        expect(res.guards.length).toBe(1);
        const guard = res.guards[0];

        expect(guard.relPath).toBe('src/nested/dir/mock.spec.ts');
        expect(guard.relPath.includes('\\')).toBe(false);
        expect(guard.targetName).toBe('checkAllKeys');
        expect(guard.varName).toBe('$mock');
        expect(typeof guard.expected).toBe('string');
        expect(['inserted', 'updated']).toContain(guard.action);

        expect(res.changedFiles.length).toBe(1);
        expect(res.changedFiles[0]).toContain('src/nested/dir/mock.spec.ts'.replace(/\//g, path.sep));
    });

    it('커스텀 targetName을 지정하면 해당 이름의 블록만 찾는다', () => {
        const root = makeTmpProject({
            'tsconfig.json': TSCONFIG,
            'src/mock.spec.ts': [
                `import { expect2 } from 'lemon-core';`,
                `const filterFields = (fields: string[], base: string[] = []) => base.concat(fields);`,
                `const $mock = filterFields([], ['meta']);`,
                `describe('x', () => {`,
                `    const notInModel = (fields: string[]) => fields.filter(s => !$mock.includes(s));`,
                // 기본 이름(checkAllKeys)이 아닌 커스텀 이름.
                `    const checkCommonKeys = (model: object, fields: string[]) => {`,
                `        return notInModel(fields);`,
                `    };`,
                `});`,
            ].join('\n'),
        });

        // 기본 targetName으로는 안 잡혀야 한다.
        const defaultRun = runGuardCommon(baseOpts(root));
        expect(defaultRun.guards.length).toBe(0);

        // 커스텀 targetName으로는 잡혀야 한다.
        const customRun = runGuardCommon(baseOpts(root, { targetName: 'checkCommonKeys' }));
        expect(customRun.guards.length).toBe(1);
        expect(customRun.guards[0].targetName).toBe('checkCommonKeys');
    });
});
