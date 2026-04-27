/**
 * `field-guard-common.ts`
 * - transformer spec의 `checkAllKeys`에 common field guard를 삽입/갱신한다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-27 added common field guard codemod.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as path from 'path';

import { Block, Node, Project, SourceFile, SyntaxKind, VariableDeclaration } from 'ts-morph';

import { DEFAULT_COMMON_MODEL_FIELDS, formatCommonFields } from './common-fields';
import type { GuardCommonOptions, GuardCommonResult } from './types';

export type { GuardCommonOptions, GuardCommonResult } from './types';

const DEFAULT_PATHS = ['src/**/*.spec.ts'];
const CANDIDATE_VAR_RE = /^\$(node|mock|temp)$/;

const toPosix = (p: string): string => p.split(path.sep).join('/');
const relPathOf = (cwd: string, abs: string): string => toPosix(path.relative(cwd, abs));

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

const findTargetBlocks = (sf: SourceFile, targetName: string): Block[] => {
    const blocks: Block[] = [];

    for (const fn of sf.getFunctions()) {
        if (fn.getName() !== targetName) continue;
        const block = fn.getBody()?.asKind(SyntaxKind.Block);
        if (block) blocks.push(block);
    }

    for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (decl.getNameNode().getText() !== targetName) continue;
        const init = decl.getInitializer();
        if (!init || !Node.isArrowFunction(init)) continue;
        const block = init.getBody().asKind(SyntaxKind.Block);
        if (block) blocks.push(block);
    }

    return blocks;
};

const findBaseVarFromCommons = (block: Block): string | undefined => {
    for (const decl of block.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (decl.getNameNode().getText() !== 'commons') continue;
        const init = decl.getInitializer();
        const match = init?.getText().match(/(\$[A-Za-z0-9_]+)\.includes\s*\(/);
        if (match) return match[1];
    }
    return undefined;
};

const findBaseVarFromNotInModel = (sf: SourceFile): string | undefined => {
    for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        if (decl.getNameNode().getText() !== 'notInModel') continue;
        const match = decl
            .getInitializer()
            ?.getText()
            .match(/!\s*(\$[A-Za-z0-9_]+)\.includes\s*\(/);
        if (match) return match[1];
    }
    return undefined;
};

const findBaseVarDeclaration = (sf: SourceFile, name?: string): VariableDeclaration | undefined => {
    const decls = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    if (name) return decls.find(decl => decl.getNameNode().getText() === name);
    return decls.find(decl => CANDIDATE_VAR_RE.test(decl.getNameNode().getText()));
};

const includesDollarFromArrayLiteral = (node: Node): boolean =>
    node
        .asKind(SyntaxKind.ArrayLiteralExpression)
        ?.getElements()
        .some(el => el.getText().replace(/['"]/g, '') === '$') ?? false;

const includesDollarFromInitializer = (decl: VariableDeclaration | undefined): boolean => {
    const init = decl?.getInitializer();
    if (!init) return false;
    const text = init.getText();
    if (/\bCORE_FIELDS\b/.test(text)) return true;

    const call = init.asKind(SyntaxKind.CallExpression);
    if (!call) return false;
    const args = call.getArguments();
    if (args.length < 2) return false;
    return includesDollarFromArrayLiteral(args[1]);
};

const renderGuard = (varName: string, expected: string): string =>
    [
        `//* 최소한, 만일 \`keys()\`가 잘 작동했다면, 공통 필드를 가지고 있어야함.`,
        `const commons = fields.reduce<string[]>((L, a) => {`,
        `    if (${varName}.includes(a)) L.push(a);`,
        `    return L;`,
        `}, []);`,
        `expect2(() => ${varName}?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(`,
        `    '${expected}',`,
        `);`,
        `expect2(() => commons?.sort((a, b) => a.length - b.length || a.localeCompare(b)).join(',')).toEqual(`,
        `    '${expected}',`,
        `);`,
    ].join('\n');

const guardStatements = (block: Block, varName: string): Node[] =>
    block.getStatements().filter(stmt => {
        const text = stmt.getText();
        return (
            text.includes('const commons = fields.reduce') ||
            (text.includes('expect2') && text.includes(`${varName}?.sort`) && text.includes('.toEqual(')) ||
            (text.includes('expect2') && text.includes('commons?.sort') && text.includes('.toEqual('))
        );
    });

const firstNonGuardInsertIndex = (block: Block): number => {
    const statements = block.getStatements();
    const idx = statements.findIndex(stmt => {
        const text = stmt.getText();
        return text.includes('const keys = Object.keys') || text.includes('const alls = notInModel');
    });
    return idx < 0 ? 0 : idx;
};

const upsertGuard = (block: Block, varName: string, expected: string): 'inserted' | 'updated' | undefined => {
    const next = renderGuard(varName, expected);
    const existing = guardStatements(block, varName);
    if (existing.length > 0) {
        const before = existing.map(stmt => stmt.getText()).join('\n');
        const expectedCount = before.split(`'${expected}'`).length - 1;
        if (
            before.includes('const commons = fields.reduce') &&
            before.includes(`${varName}?.sort`) &&
            before.includes('commons?.sort') &&
            expectedCount === 2
        ) {
            return undefined;
        }
        existing[0].replaceWithText(next);
        for (const dup of existing.slice(1).reverse()) (dup as any).remove();
        return before === next && existing.length === 1 ? undefined : 'updated';
    }

    block.insertStatements(firstNonGuardInsertIndex(block), next);
    return 'inserted';
};

/** `checkAllKeys`의 실제 base 변수 초기화 형태를 보고 `$` 포함 여부에 맞는 literal guard를 삽입/갱신한다. */
export const runGuardCommon = (opts: GuardCommonOptions): GuardCommonResult => {
    const cwd = opts.cwd ? path.resolve(opts.cwd) : path.resolve(path.dirname(opts.tsconfig));
    const tsconfigPath = path.resolve(opts.tsconfig);
    const project = new Project({ tsConfigFilePath: tsconfigPath });
    const paths = opts.paths && opts.paths.length > 0 ? opts.paths : DEFAULT_PATHS;
    for (const pat of paths) project.addSourceFilesAtPaths(path.isAbsolute(pat) ? pat : path.join(cwd, pat));

    const scanFiles = paths.flatMap(pat => {
        const files = project.getSourceFiles(pat);
        if (files.length > 0 || path.isAbsolute(pat)) return files;
        return project.getSourceFiles(path.join(cwd, pat));
    });
    const uniqueFiles = Array.from(new Map(scanFiles.map(sf => [sf.getFilePath(), sf])).values()).filter(
        sf => !sf.getFilePath().includes(`${path.sep}node_modules${path.sep}`),
    );

    const originalTextByPath = new Map<string, string>(uniqueFiles.map(sf => [sf.getFilePath(), sf.getFullText()]));
    const changedFiles = new Set<string>();
    const guards: GuardCommonResult['guards'] = [];

    for (const sf of uniqueFiles) {
        const relPath = relPathOf(cwd, sf.getFilePath());
        const fallbackVar = findBaseVarFromNotInModel(sf);
        for (const block of findTargetBlocks(sf, opts.targetName)) {
            const varName = findBaseVarFromCommons(block) ?? fallbackVar;
            if (!varName) continue;
            const baseDecl = findBaseVarDeclaration(sf, varName);
            const includeDollar = includesDollarFromInitializer(baseDecl);
            const expected = formatCommonFields(DEFAULT_COMMON_MODEL_FIELDS, includeDollar ? {} : { exclude: ['$'] });
            const action = upsertGuard(block, varName, expected);
            if (!action) continue;
            changedFiles.add(sf.getFilePath());
            guards.push({ relPath, targetName: opts.targetName, varName, expected, action });
        }
    }

    const diffs = opts.diff
        ? Array.from(changedFiles)
              .map(filePath =>
                  renderDiff(
                      relPathOf(cwd, filePath),
                      originalTextByPath.get(filePath) ?? '',
                      project.getSourceFileOrThrow(filePath).getFullText(),
                  ),
              )
              .filter(Boolean)
        : undefined;

    if (!opts.dryRun) {
        for (const filePath of changedFiles) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            project.getSourceFileOrThrow(filePath).saveSync();
        }
    }

    return { guards, changedFiles: Array.from(changedFiles), diffs };
};
