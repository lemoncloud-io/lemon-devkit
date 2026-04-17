/**
 * `field-migrate.ts`
 * - `ts-transformer-keys`의 `keys<T>()`를 registry 기반 호출로 바꾸는 one-shot codemod.
 *
 * **NOTE**
 * - `CallExpression`의 callee만 AST rewrite 한다. `.filter(...)`, `as` cast,
 *   `filterFields(...)`, indentation은 최대한 유지한다.
 * - 최초 `gen` 전에도 compile 되도록 `--out`에 bootstrap stub을 쓴다.
 * - registry 이름은 여기서 생성하고 source에 고정한다. `gen`은 그 이름을 그대로 보존한다.
 * - 파일 안에 `fieldKeys` 충돌이 있으면 `fieldKeys as lemonFieldKeys`로 alias 한다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added legacy field migration codemod.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImportDeclaration, Node, Project, QuoteKind, SourceFile, SyntaxKind } from 'ts-morph';

import { deriveName } from './field-derive-name';
import { bootstrapStub } from './field-gen';
import type { DerivationInput, MigrateOptions, MigrateResult } from './types';

export type { MigrateOptions, MigrateResult } from './types';

const toPosix = (p: string): string => p.split(path.sep).join('/');
const relPathOf = (cwd: string, abs: string): string => toPosix(path.relative(cwd, abs));
const isSpec = (relPath: string): boolean => /\.spec\.(t|j)sx?$/.test(relPath);

/** `--paths` glob을 project source file 절대 경로 set으로 변환 */
const sourceFilesForPaths = (project: Project, cwd: string, paths: string[]): Set<string> =>
    new Set(
        paths.flatMap(pat => {
            const files = project.getSourceFiles(pat);
            if (files.length > 0 || path.isAbsolute(pat)) return files.map(sf => sf.getFilePath());
            return project.getSourceFiles(path.join(cwd, pat)).map(sf => sf.getFilePath());
        }),
    );

/**
 * 호출식을 감싸는 가장 가까운 declaration 이름을 찾는다.
 *
 * - 단순 타입명은 `<T>`에서 바로 이름을 만들 수 있음.
 * - `keys<A & B>()` 같은 복합 타입은 주변 변수/프로퍼티명이 있어야 `postMix`처럼 읽히는 이름을 만들 수 있음.
 */
const enclosingContextOf = (call: Node): string | undefined => {
    const walk = (node: Node | undefined): string | undefined => {
        if (!node) return undefined;
        switch (node.getKind()) {
            case SyntaxKind.PropertyAssignment: {
                return node.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode().getText();
            }
            case SyntaxKind.VariableDeclaration: {
                return node.asKindOrThrow(SyntaxKind.VariableDeclaration).getNameNode().getText();
            }
            case SyntaxKind.MethodDeclaration: {
                return node.asKindOrThrow(SyntaxKind.MethodDeclaration).getNameNode().getText();
            }
            case SyntaxKind.FunctionDeclaration: {
                return node.asKindOrThrow(SyntaxKind.FunctionDeclaration).getNameNode()?.getText();
            }
            case SyntaxKind.PropertyDeclaration: {
                return node.asKindOrThrow(SyntaxKind.PropertyDeclaration).getNameNode().getText();
            }
        }
        return walk(node.getParent());
    };
    return walk(call.getParent());
};

/**
 * `ts-transformer-keys`의 `keys` import를 찾는다.
 *
 * 반환되는 `local` 값은 alias를 반영한다.
 * - ex) `keys as typeKeys`도 plain `keys`와 같은 경로로 rewrite 가능함.
 */
const findLegacyImport = (sf: SourceFile): { local: string; decl: ImportDeclaration } | undefined => {
    for (const imp of sf.getImportDeclarations()) {
        if (imp.getModuleSpecifierValue() !== 'ts-transformer-keys') continue;
        for (const named of imp.getNamedImports()) {
            if (named.getName() !== 'keys') continue;
            const alias = named.getAliasNode();
            return { local: alias ? alias.getText() : 'keys', decl: imp };
        }
    }
    return undefined;
};

/**
 * 원하는 registry binding 이름이 현재 파일 scope에서 충돌하는지 확인한다.
 *
 * generated import는 top-level binding이므로 import binding과 top-level 선언만 확인한다.
 */
const conflictsWithFieldKeys = (sf: SourceFile, name: string): boolean => {
    for (const imp of sf.getImportDeclarations()) {
        for (const named of imp.getNamedImports()) {
            const local = named.getAliasNode()?.getText() ?? named.getName();
            if (local === name) return true;
        }
        const def = imp.getDefaultImport();
        if (def && def.getText() === name) return true;
        const ns = imp.getNamespaceImport();
        if (ns && ns.getText() === name) return true;
    }
    for (const stmt of sf.getStatements()) {
        if (stmt.getKind() === SyntaxKind.VariableStatement) {
            const vs = stmt.asKindOrThrow(SyntaxKind.VariableStatement);
            for (const d of vs.getDeclarationList().getDeclarations()) {
                if (d.getNameNode().getText() === name) return true;
            }
        }
        if (stmt.getKind() === SyntaxKind.FunctionDeclaration) {
            const fd = stmt.asKindOrThrow(SyntaxKind.FunctionDeclaration);
            if (fd.getNameNode()?.getText() === name) return true;
        }
        if (stmt.getKind() === SyntaxKind.ClassDeclaration) {
            const cd = stmt.asKindOrThrow(SyntaxKind.ClassDeclaration);
            if (cd.getNameNode()?.getText() === name) return true;
        }
    }
    return false;
};

/**
 * source file 기준의 registry import module specifier를 계산한다.
 * - `.ts` 확장자는 제거한다.
 */
const registrySpecifier = (sfPath: string, outAbs: string): string => {
    const spec = toPosix(path.relative(path.dirname(sfPath), outAbs)).replace(/\.ts$/, '');
    return spec.startsWith('.') ? spec : `./${spec}`;
};

/** 기존 파일의 import quote style을 새 registry import에도 맞춘다. */
const quoteKindOf = (sf: SourceFile): QuoteKind =>
    sf.getImportDeclarations()[0]?.getModuleSpecifier().getQuoteKind() ?? QuoteKind.Single;

/**
 * registry를 가리키는 `fieldKeys` import를 추가하거나 기존 import에 병합한다.
 * - 반환값은 해당 파일에서 실제 사용할 local binding 이름.
 *
 * 파일에 이미 `fieldKeys`가 있으면 `lemonFieldKeys`로 alias 하고,
 * 해당 파일의 모든 rewrite는 alias를 사용한다.
 */
const ensureRegistryImport = (sf: SourceFile, outAbs: string): string => {
    const spec = registrySpecifier(sf.getFilePath(), outAbs);
    sf.getProject().manipulationSettings.set({ quoteKind: quoteKindOf(sf) });
    //* 이미 `out`을 가리키는 registry import가 있으면 재사용한다.
    for (const imp of sf.getImportDeclarations()) {
        const t = imp.getModuleSpecifierSourceFile();
        if (!t && imp.getModuleSpecifierValue() !== spec) continue;
        const matchesByResolve = t && path.resolve(t.getFilePath()) === outAbs;
        const matchesBySpec = imp.getModuleSpecifierValue() === spec;
        if (!matchesByResolve && !matchesBySpec) continue;
        for (const named of imp.getNamedImports()) {
            if (named.getName() !== 'fieldKeys') continue;
            const alias = named.getAliasNode();
            return alias ? alias.getText() : 'fieldKeys';
        }
        //* registry import는 있지만 named list에 `fieldKeys`가 없으면 추가한다.
        const desiredLocal = conflictsWithFieldKeys(sf, 'fieldKeys') ? 'lemonFieldKeys' : 'fieldKeys';
        imp.addNamedImport(
            desiredLocal === 'fieldKeys' ? { name: 'fieldKeys' } : { name: 'fieldKeys', alias: desiredLocal },
        );
        return desiredLocal;
    }
    //* registry import가 없으면 안전한 local binding으로 새 import를 추가한다.
    const desiredLocal = conflictsWithFieldKeys(sf, 'fieldKeys') ? 'lemonFieldKeys' : 'fieldKeys';
    sf.addImportDeclaration({
        moduleSpecifier: spec,
        namedImports: [
            desiredLocal === 'fieldKeys' ? { name: 'fieldKeys' } : { name: 'fieldKeys', alias: desiredLocal },
        ],
    });
    return desiredLocal;
};

/** 변경 전/후 source text를 사람이 확인하기 쉬운 짧은 diff로 만든다. */
const renderDiff = (relPath: string, before: string, after: string): string => {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const prefix = beforeLines.findIndex((line, i) => line !== afterLines[i]);
    if (prefix < 0) return '';
    const commonTail = [...beforeLines]
        .reverse()
        .findIndex((line, i) => line !== afterLines[afterLines.length - 1 - i]);
    const tail = commonTail < 0 ? 0 : commonTail;
    const removed = beforeLines.slice(prefix, beforeLines.length - tail).map(line => `-${line}`);
    const added = afterLines.slice(prefix, afterLines.length - tail).map(line => `+${line}`);
    return [`--- ${relPath}`, `+++ ${relPath}`, `@@`, ...removed, ...added].join('\n');
};

/** `--update-tsconfig`가 명시된 경우 legacy transformer plugin을 제거한다. */
const updateTsconfig = (tsconfigPath: string, dryRun: boolean): boolean => {
    const raw = fs.readFileSync(tsconfigPath, 'utf8');
    const json = JSON.parse(raw);
    const plugins = json?.compilerOptions?.plugins;
    if (!Array.isArray(plugins)) return false;
    const nextPlugins = plugins.filter((p: any) => p?.transform !== 'ts-transformer-keys/transformer');
    if (nextPlugins.length === plugins.length) return false;
    const compilerOptions = { ...json.compilerOptions, plugins: nextPlugins };
    const nextJson = { ...json, compilerOptions };
    if (nextPlugins.length === 0) delete nextJson.compilerOptions.plugins;
    if (!dryRun) fs.writeFileSync(tsconfigPath, `${JSON.stringify(nextJson, null, 4)}\n`, 'utf8');
    return true;
};

/**
 * legacy import에서 `keys`만 제거한다.
 *
 * - mixed import는 유지한다. ex) `import { keys, other }` => `import { other }`
 * - `keys`만 import하던 선언은 통째로 제거한다.
 */
const stripLegacyKeysImport = (decl: ImportDeclaration): void => {
    const named = decl.getNamedImports();
    const toRemove = named.find(n => n.getName() === 'keys');
    if (!toRemove) return;
    toRemove.remove();
    if (decl.getNamedImports().length === 0 && !decl.getDefaultImport() && !decl.getNamespaceImport()) {
        decl.remove();
    }
};

/**
 * `<T>`가 enclosing generic parameter라면 true.
 *
 * generated registry는 concrete property 이름이 필요하다.
 * generic parameter는 gen 시점에 field list가 고정되지 않으므로 수동 처리 또는 `--allow-skips`가 필요함.
 */
const isGenericParameter = (call: Node, typeArgText: string): boolean => {
    //* 호출 위치에서 위로 올라가며 enclosing declaration만 확인한다.
    //* `A & B` 같은 복합 타입은 여기서 match 되지 않고 통과한다.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(typeArgText.trim())) return false;
    const walk = (node: Node | undefined): boolean => {
        if (!node) return false;
        const tps = (node as any).getTypeParameters?.() as { getName(): string }[] | undefined;
        if (tps && tps.some(tp => tp.getName() === typeArgText)) return true;
        return walk(node.getParent());
    };
    return walk(call.getParent());
};

/**
 * legacy `keys<T>()` 호출을 named registry 호출로 rewrite 한다.
 *
 * **처리 순서**
 * 1. `tsconfig`로 consumer TypeScript project를 로드한다.
 * 2. `ts-transformer-keys`에서 `keys`를 import한 파일을 찾는다.
 * 3. 안정적인 이름을 생성하고 call expression target만 바꾼다.
 * 4. registry import를 추가하고, 가능하면 legacy import를 제거한다.
 * 5. migrated source가 compile 되도록 bootstrap registry stub을 쓴다.
 */
export const runMigrate = (opts: MigrateOptions): MigrateResult => {
    const cwd = opts.cwd ? path.resolve(opts.cwd) : path.resolve(path.dirname(opts.tsconfig));
    const tsconfigPath = path.resolve(opts.tsconfig);
    const outAbs = path.resolve(cwd, opts.out);

    const project = new Project({ tsConfigFilePath: tsconfigPath });
    if (opts.includeSpec) {
        project.addSourceFilesAtPaths(path.join(cwd, 'src/**/*.spec.ts'));
    }
    if (fs.existsSync(outAbs)) {
        project.addSourceFileAtPathIfExists(outAbs);
    }

    const shouldWriteStub = !fs.existsSync(outAbs);
    const wroteStub = shouldWriteStub && !opts.dryRun;
    const allowedPaths =
        opts.paths && opts.paths.length > 0 ? sourceFilesForPaths(project, cwd, opts.paths) : undefined;

    //* STEP.1 전체 TypeScript project는 유지하고, rewrite scan 대상만 좁힌다.
    const scanFiles = project.getSourceFiles().filter(sf => {
        const p = sf.getFilePath();
        if (p.includes(`${path.sep}node_modules${path.sep}`)) return false;
        if (path.resolve(p) === outAbs) return false;
        if (!opts.includeSpec && isSpec(relPathOf(cwd, p))) return false;
        if (allowedPaths && !allowedPaths.has(p)) return false;
        return true;
    });

    const rewrites: MigrateResult['rewrites'] = [];
    const skipped: MigrateResult['skipped'] = [];
    const changedFiles = new Set<string>();
    const takenNames = new Set<string>();
    const originalTextByPath = new Map<string, string>(
        scanFiles.map(sf => [String(sf.getFilePath()), sf.getFullText()]),
    );
    const sourceFileByPath = new Map<string, SourceFile>(scanFiles.map(sf => [String(sf.getFilePath()), sf]));

    for (const sf of scanFiles) {
        const legacy = findLegacyImport(sf);
        if (!legacy) continue;
        const relPath = relPathOf(cwd, sf.getFilePath());

        interface PendingRewrite {
            /** update 할 원본 call expression */
            call: Node;
            /** `keys<T>()`의 generic argument 원문 */
            typeArgText: string;
            /** 복합 타입 이름 생성에 사용할 owner 이름 */
            context?: string;
        }
        const pending: PendingRewrite[] = [];

        //* STEP.2 먼저 수집하고 나중에 수정한다. traversal 중 AST를 바꾸지 않기 위함.
        for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const expr = call.getExpression();
            if (expr.getKind() !== SyntaxKind.Identifier) continue;
            if (expr.getText() !== legacy.local) continue;
            const typeArgs = call.getTypeArguments();
            if (typeArgs.length === 0) {
                skipped.push({ relPath, typeArgText: '', reason: 'no type argument' });
                continue;
            }
            const typeArgText = typeArgs[0].getText();
            if (isGenericParameter(call, typeArgText)) {
                skipped.push({ relPath, typeArgText, reason: 'type argument is an enclosing generic parameter' });
                continue;
            }
            pending.push({ call, typeArgText, context: enclosingContextOf(call) });
        }

        const fileHasSkips = skipped.some(s => s.relPath === relPath);
        if (pending.length === 0) {
            //* 호출 없이 legacy import만 있으면 제거한다.
            //* skipped 호출이 있던 파일은 source 유지를 위해 import를 남긴다.
            if (!fileHasSkips) {
                stripLegacyKeysImport(legacy.decl);
                changedFiles.add(sf.getFilePath());
            }
            continue;
        }

        const local = ensureRegistryImport(sf, outAbs);
        for (const p of pending) {
            const input: DerivationInput = { relPath, typeArgText: p.typeArgText, enclosingContext: p.context };
            const name = deriveName(input, takenNames);
            //* rewrite: keys<X>() -> <local>.<name><X>()
            //* callee만 바꾸고 type arg, argument, cast/filter tail은 유지한다.
            p.call.asKindOrThrow(SyntaxKind.CallExpression).getExpression().replaceWithText(`${local}.${name}`);
            rewrites.push({ relPath, name, typeArgText: p.typeArgText });
        }

        if (!fileHasSkips) {
            stripLegacyKeysImport(legacy.decl);
        }
        changedFiles.add(sf.getFilePath());
    }

    if (!opts.allowSkips && skipped.length > 0) {
        const lines = skipped.map(s => `  - ${s.relPath} :: keys<${s.typeArgText}>() — ${s.reason}`).join('\n');
        throw new Error(
            `migrate failed on ${skipped.length} site(s); re-run with --allow-skips after hand-fixing:\n${lines}`,
        );
    }
    if (opts.updateTsconfig && opts.paths && opts.paths.length > 0) {
        throw new Error(`--update-tsconfig cannot be used with --paths; run a full migration first.`);
    }
    if (opts.updateTsconfig && skipped.length > 0) {
        throw new Error(`--update-tsconfig cannot run while skipped legacy sites remain.`);
    }

    const updatedTsconfig = opts.updateTsconfig ? updateTsconfig(tsconfigPath, opts.dryRun) : false;
    const diffs = opts.diff
        ? Array.from(changedFiles)
              .map(filePath =>
                  renderDiff(
                      relPathOf(cwd, filePath),
                      originalTextByPath.get(filePath) ?? '',
                      sourceFileByPath.get(filePath)?.getFullText() ?? '',
                  ),
              )
              .filter(Boolean)
        : undefined;

    //* STEP.3 validation 통과 후 bootstrap stub을 쓴다. 실패한 run은 orphan stub을 남기지 않는다.
    if (wroteStub) {
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, bootstrapStub(), 'utf8');
        project.addSourceFileAtPath(outAbs);
    }

    if (!opts.dryRun) {
        for (const sf of project.getSourceFiles()) {
            if (changedFiles.has(sf.getFilePath())) sf.saveSync();
        }
    }

    return { rewrites, skipped, changedFiles: Array.from(changedFiles), wroteStub, diffs, updatedTsconfig };
};
