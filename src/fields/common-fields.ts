/**
 * `fields/common-fields.ts`
 * - shared common model field canon and drift checks.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-27 added common field helpers.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

export const DEFAULT_COMMON_MODEL_FIELDS: readonly string[] = [
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
    'createdAt',
    'deletedAt',
    'updatedAt',
];

export interface FormatCommonFieldsOptions {
    exclude?: readonly string[];
}

export interface CheckCommonFieldsOptions extends FormatCommonFieldsOptions {
    canon?: readonly string[];
    entryName?: string;
    runHint?: string;
}

export interface CommonFieldsCheckResult {
    ok: boolean;
    expected: string[];
    actual: string[];
    missing: string[];
    extra: string[];
}

export const sortCommonFields = (xs: readonly string[]): string[] =>
    [...xs].sort((a, b) => a.length - b.length || a.localeCompare(b));

const uniqueWithoutExcluded = (xs: readonly string[], exclude: ReadonlySet<string>): string[] =>
    xs.reduce<string[]>((L, x) => {
        if (!exclude.has(x) && !L.includes(x)) L.push(x);
        return L;
    }, []);

export const formatCommonFields = (
    xs: readonly string[] = DEFAULT_COMMON_MODEL_FIELDS,
    options: FormatCommonFieldsOptions = {},
): string => {
    const exclude = new Set(options.exclude ?? []);
    return sortCommonFields(uniqueWithoutExcluded(xs, exclude)).join(',');
};

export const checkCommonFields = (
    actual: readonly string[],
    options: CheckCommonFieldsOptions = {},
): CommonFieldsCheckResult => {
    const exclude = new Set(options.exclude ?? []);
    const expected = uniqueWithoutExcluded(options.canon ?? DEFAULT_COMMON_MODEL_FIELDS, exclude);
    const sortedActual = sortCommonFields(uniqueWithoutExcluded(actual, exclude));
    const expectedSet = new Set(expected);
    const actualSet = new Set(sortedActual);
    const missing = expected.filter(field => !actualSet.has(field));
    const extra = sortedActual.filter(field => !expectedSet.has(field));

    return {
        ok: missing.length === 0 && extra.length === 0,
        expected,
        actual: sortedActual,
        missing,
        extra,
    };
};

export const assertCommonFields = (actual: readonly string[], options: CheckCommonFieldsOptions = {}): void => {
    const result = checkCommonFields(actual, options);
    if (result.ok) return;

    const entryName = options.entryName ?? 'fields';
    const runHint = options.runHint ?? 'npm run fields:gen';
    const lines = [
        `[common-fields] ${entryName} is stale.`,
        `  expected: ${result.expected.join(',')}`,
        `  actual:   ${result.actual.join(',')}`,
    ];

    if (result.missing.length) lines.push(`  missing:  ${result.missing.join(',')}`);
    if (result.extra.length) lines.push(`  extra:    ${result.extra.join(',')}`);
    lines.push(`  run \`${runHint}\``);

    throw new Error(lines.join('\n'));
};
