#!/usr/bin/env node
/**
 * `lemon-fields` CLI
 * - `migrate`(one-shot codemod), `gen`(기본 생성기) subcommand를 제공한다.
 * - `--check`는 파일을 쓰지 않고 CI drift guard로 동작한다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added `lemon-fields` CLI.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as path from 'path';

import { runGen, writeRegistry } from '../fields/field-gen';
import { runGuardCommon } from '../fields/field-guard-common';
import { runMigrate } from '../fields/field-migrate';

type Subcommand = 'gen' | 'migrate' | 'guard-common';

interface ParsedFlags {
    /** `gen --check`: 파일을 쓰지 않고 drift만 확인 */
    check?: boolean;
    /** `gen --allow-legacy`: 남은 legacy `keys<T>()` 허용 */
    'allow-legacy'?: boolean;
    /** `gen --allow-empty`: 호출 위치가 없어도 성공 처리 */
    'allow-empty'?: boolean;
    /** `migrate --allow-skips`: 자동 처리 불가 위치를 throw 대신 보고 */
    'allow-skips'?: boolean;
    /** `migrate --dry-run`: 파일을 쓰지 않고 결과만 계산 */
    'dry-run'?: boolean;
    /** `migrate --diff`: 변경될 source diff 출력 */
    diff?: boolean;
    /** `gen/migrate --report`: 생성 또는 rewrite 요약 출력 */
    report?: boolean;
    /** migration 완료 후 ts-transformer-keys transformer plugin 제거 */
    'update-tsconfig'?: boolean;
    /** `guard-common --target <name>`: guard를 삽입할 함수/변수명 */
    target?: string;
    /** spec 파일 scan 여부. `--no-include-spec`이면 false */
    'include-spec'?: boolean;
    /** `--help` 또는 `-h` */
    help?: boolean;
    /** custom tsconfig 경로 */
    tsconfig?: string;
    /** custom registry output 경로 */
    out?: string;
    /** scan 대상 glob 목록 */
    paths?: string[];
}

interface ParsedArgs {
    subcommand: Subcommand;
    flags: ParsedFlags;
}

const USAGE = `
lemon-fields — materialise \`fieldKeys.<name><T>()\` call sites into a committed registry.

USAGE
  lemon-fields [gen]            Regenerate src/generated/field-registry.ts (default)
  lemon-fields migrate          One-shot codemod: rewrite legacy \`keys<T>()\` sites.
  lemon-fields guard-common     Upsert common field expect2 guards into checkAllKeys.
  lemon-fields --check          CI guard: fail if the generated file is out-of-date.

OPTIONS (both subcommands)
  --tsconfig <path>             default: tsconfig.json
  --out <path>                  default: src/generated/field-registry.ts
  --include-spec                default: true   (pass --no-include-spec to exclude)
  --paths <glob> [--paths ...]  limit scan to these files

GEN-ONLY
  --check                       do not write; exit 1 if out-of-date
  --report                      print generated key/source/field table
  --allow-legacy                accept leftover \`keys<T>()\` sites mid-migration
  --allow-empty                 do not fail if no call sites are found

MIGRATE-ONLY
  --dry-run                     compute changes without writing
  --diff                        print a compact source diff
  --allow-skips                 report unrewritable sites instead of failing
  --update-tsconfig             remove ts-transformer-keys transformer plugin after full migration
  --report                      print summary table

GUARD-COMMON-ONLY
  --target <name>               default: checkAllKeys
  --dry-run                     compute changes without writing
  --diff                        print a compact source diff
  --report                      print updated guard table
`.trim();

const parse = (argv: string[]): ParsedArgs => {
    const [head, ...tail] = argv;
    const hasSubcommand = head === 'migrate' || head === 'gen' || head === 'guard-common';
    const subcommand: Subcommand = hasSubcommand ? head : 'gen';
    const tokens = hasSubcommand ? tail : argv;
    return { subcommand, flags: parseFlags(tokens) };
};

const requireFlagValue = (key: string, value: string | undefined): string => {
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}\n\n${USAGE}`);
    return value;
};

const parseFlags = (tokens: string[], flags: ParsedFlags = {}): ParsedFlags => {
    const [tok, value, ...rest] = tokens;
    if (!tok) return flags;
    if (!tok.startsWith('--')) return parseFlags(tokens.slice(1), flags);

    const key = tok.slice(2);
    switch (key) {
        case 'check':
        case 'allow-legacy':
        case 'allow-empty':
        case 'allow-skips':
        case 'dry-run':
        case 'diff':
        case 'report':
        case 'update-tsconfig':
        case 'include-spec':
            return parseFlags(tokens.slice(1), { ...flags, [key]: true });
        case 'no-include-spec':
            return parseFlags(tokens.slice(1), { ...flags, 'include-spec': false });
        case 'tsconfig':
            return parseFlags(rest, { ...flags, tsconfig: requireFlagValue(key, value) });
        case 'out':
            return parseFlags(rest, { ...flags, out: requireFlagValue(key, value) });
        case 'paths':
            return parseFlags(rest, { ...flags, paths: [...(flags.paths ?? []), requireFlagValue(key, value)] });
        case 'target':
            return parseFlags(rest, { ...flags, target: requireFlagValue(key, value) });
        case 'help':
        case 'h':
            return parseFlags(tokens.slice(1), { ...flags, help: true });
        default:
            throw new Error(`unknown flag: --${key}\n\n${USAGE}`);
    }
};

const commonOpts = (flags: ParsedArgs['flags']) => ({
    tsconfig: flags.tsconfig ?? 'tsconfig.json',
    out: flags.out ?? 'src/generated/field-registry.ts',
    includeSpec: flags['include-spec'] === false ? false : true,
    paths: flags.paths,
});

const genReportLine = (entry: ReturnType<typeof runGen>['entries'][number]): string => {
    const legacy = entry.legacy ? ' [legacy]' : '';
    return `  ${entry.name}  ${entry.relPath}#${entry.typeArgText}  fields(${entry.fields.length}): ${entry.fields.join(
        ', ',
    )}${legacy}\n`;
};

const writeGenReport = (entries: ReturnType<typeof runGen>['entries'], content: string): void => {
    const label = `${entries.length} generated entr${entries.length === 1 ? 'y' : 'ies'}`;
    // fieldRegistryMeta checksum 앞 8자를 report에 포함해 dev가 CI/runtime 값과 비교할 수 있도록 함
    const checksumMatch = content.match(/"checksum":\s*"([0-9a-f]{16})"/);
    const checksumHint = checksumMatch ? `  checksum: ${checksumMatch[1].slice(0, 8)}…` : '';
    process.stdout.write(`[lemon-fields] report — ${label}${checksumHint}:\n`);
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
        process.stdout.write(genReportLine(entry));
    }
};

const runGenCmd = (flags: ParsedArgs['flags']): number => {
    const common = commonOpts(flags);
    const cwd = process.cwd();
    const outAbs = path.resolve(cwd, common.out);
    const isCheck = Boolean(flags['check']);

    const res = runGen({
        ...common,
        allowLegacy: Boolean(flags['allow-legacy']),
        allowEmpty: Boolean(flags['allow-empty']),
        repairDuplicateNames: !isCheck,
        cwd,
    });

    if (isCheck) {
        if (res.changed) {
            process.stderr.write(
                `[lemon-fields] registry drift detected at ${common.out}. Re-run \`lemon-fields gen\` and commit.\n`,
            );
            return 1;
        }
        if (res.formatOnly) {
            //* 필드셋/checksum은 동일 — on-disk 포맷(예: prettier 재포맷)만 다름. 의미 변경이 아니므로 CI는 통과시킨다.
            process.stdout.write(
                `[lemon-fields] format differs from generator output; content up-to-date — ${res.entries.length} entries.\n`,
            );
            return 0;
        }
        process.stdout.write(`[lemon-fields] ok — ${res.entries.length} entries up-to-date.\n`);
        return 0;
    }

    //* 의미 변경(changed) 시에만 쓴다. 포맷만 다르면(formatOnly) 쓰지 않는다 — 그렇지 않으면
    //* prettier 등 consumer repo의 포맷터와 매번 덮어쓰기 경합이 생긴다.
    if (res.changed) writeRegistry(outAbs, res.content);
    process.stdout.write(
        `[lemon-fields] gen — ${res.entries.length} entries, ${res.changed ? 'wrote' : 'no change to'} ${common.out}\n`,
    );
    if (!res.changed && res.formatOnly) {
        process.stdout.write(
            `[lemon-fields] note — on-disk format differs from generator output but fields are unchanged; leaving file as-is.\n`,
        );
    }
    if (res.repairs.length > 0) {
        process.stdout.write(`[lemon-fields] repaired ${res.repairs.length} duplicate registry name(s):\n`);
        for (const r of res.repairs) {
            process.stdout.write(`  ${r.relPath}  -> fieldKeys.${r.name}<${r.typeArgText}>()\n`);
        }
    }
    if (flags['report']) writeGenReport(res.entries, res.content);
    if (res.skipped.length > 0) {
        process.stderr.write(`[lemon-fields] skipped ${res.skipped.length} site(s):\n`);
        for (const s of res.skipped) process.stderr.write(`  - ${s.relPath} :: ${s.typeArgText} (${s.reason})\n`);
    }
    if (res.legacyLeftovers.length > 0) {
        process.stderr.write(`[lemon-fields] legacy leftovers (--allow-legacy): ${res.legacyLeftovers.length}\n`);
    }
    return 0;
};

const runMigrateCmd = (flags: ParsedArgs['flags']): number => {
    const common = commonOpts(flags);
    const res = runMigrate({
        ...common,
        dryRun: Boolean(flags['dry-run']),
        diff: Boolean(flags['diff']),
        allowSkips: Boolean(flags['allow-skips']),
        updateTsconfig: Boolean(flags['update-tsconfig']),
        cwd: process.cwd(),
    });
    const mode = flags['dry-run'] ? '[dry-run] ' : '';
    process.stdout.write(
        `[lemon-fields] ${mode}migrate — rewrote ${res.rewrites.length} site(s), ` +
            `${res.changedFiles.length} file(s)${res.wroteStub ? '; wrote bootstrap stub' : ''}.\n`,
    );
    if (flags['report']) {
        for (const r of res.rewrites)
            process.stdout.write(
                `  ${r.relPath}  keys<${r.typeArgText}>() -> fieldKeys.${r.name}<${r.typeArgText}>()\n`,
            );
    }
    if (res.diffs?.length) {
        process.stdout.write(`${res.diffs.join('\n')}\n`);
    }
    if (res.updatedTsconfig) {
        process.stdout.write(
            `[lemon-fields] ${
                flags['dry-run'] ? 'would update' : 'updated'
            } tsconfig: removed ts-transformer-keys transformer plugin.\n`,
        );
    }
    if (res.skipped.length > 0) {
        process.stderr.write(`[lemon-fields] skipped ${res.skipped.length} site(s):\n`);
        for (const s of res.skipped)
            process.stderr.write(`  - ${s.relPath} :: keys<${s.typeArgText}>() — ${s.reason}\n`);
    }
    return 0;
};

const runGuardCommonCmd = (flags: ParsedArgs['flags']): number => {
    const common = commonOpts(flags);
    const res = runGuardCommon({
        tsconfig: common.tsconfig,
        out: common.out,
        paths: common.paths,
        targetName: flags.target ?? 'checkAllKeys',
        dryRun: Boolean(flags['dry-run']),
        diff: Boolean(flags['diff']),
        cwd: process.cwd(),
    });
    const mode = flags['dry-run'] ? '[dry-run] ' : '';
    process.stdout.write(
        `[lemon-fields] ${mode}guard-common — ${res.guards.length} guard(s), ` +
            `${res.changedFiles.length} file(s)${flags['dry-run'] ? '' : ' updated'}.\n`,
    );
    if (flags['report']) {
        for (const g of res.guards) {
            process.stdout.write(`  ${g.relPath}  ${g.targetName}  ${g.varName} ${g.action}: ${g.expected}\n`);
        }
    }
    if (res.diffs?.length) process.stdout.write(`${res.diffs.join('\n')}\n`);
    return 0;
};

export const main = (argv: string[]): number => {
    try {
        const { subcommand, flags } = parse(argv);
        if (flags['help']) {
            process.stdout.write(`${USAGE}\n`);
            return 0;
        }
        if (subcommand === 'migrate') return runMigrateCmd(flags);
        if (subcommand === 'guard-common') return runGuardCommonCmd(flags);
        return runGenCmd(flags);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[lemon-fields] ERROR: ${msg}\n`);
        return 1;
    }
};

//* 직접 실행된 경우에만 CLI main을 수행한다. (test import 시에는 실행하지 않음)
if (require.main === module) {
    process.exit(main(process.argv.slice(2)));
}
