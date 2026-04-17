/**
 * `field-derive-name.ts`
 * - legacy `keys<T>()` 호출 위치에서 안정적인 registry 이름을 생성한다.
 *
 * **NOTE**
 * - `field-migrate.ts`가 source rewrite 시 사용한다.
 * - `field-gen.ts`에서는 `gen --allow-legacy`로 남은 legacy 호출을 처리할 때만 사용한다.
 * - 이미 migrate 된 `fieldKeys.<name><T>()` 이름은 source의 값을 그대로 보존한다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added stable field key derivation.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { createHash } from 'crypto';

import type { DerivationInput } from './types';

export type { DerivationInput } from './types';

const RESERVED = new Set([
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'null',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'let',
    'static',
    'await',
    'implements',
    'interface',
    'package',
    'private',
    'protected',
    'public',
]);

const IDENT = /^[a-z][A-Za-z0-9_]*$/;
const GENERIC_TYPE_NAMES = new Set([
    'Model',
    'Head',
    'Body',
    'Item',
    'Entity',
    'Record',
    'Data',
    'Param',
    'Params',
    'Result',
]);

/** 파일 경로에서 확장자를 제거한 basename만 추출 */
const fileStem = (relPath: string): string => {
    const base = relPath.split('/').pop() ?? relPath;
    return base.replace(/\.[^.]+$/, '');
};

/**
 * 문자열을 이름 생성용 token으로 분해함.
 * - punctuation, camelCase, PascalCase 경계를 모두 고려한다.
 * - ex) `UserModel` => ['User','Model']
 * - ex) `HTTPRequest` => ['HTTP','Request']
 * - ex) `primary-post key` => ['primary','post','key']
 */
const tokenize = (s: string): string[] =>
    s
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

/** token 목록을 camelCase로 변환 */
const camelize = (tokens: string[]): string => {
    if (tokens.length === 0) return '';
    const [first, ...rest] = tokens;
    return first.toLowerCase() + rest.map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join('');
};

/** 첫 글자만 대문자로 보정 */
const upperFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** `Model`처럼 너무 넓은 타입명에는 파일 경로 context를 붙인다. */
const pathContext = (relPath: string): string => {
    const parts = relPath.split('/').filter(Boolean);
    const stem = fileStem(parts.pop() ?? relPath).replace(/\.spec$/, '');
    const dir = [...parts].reverse().find(p => p !== 'src' && p !== 'modules') ?? '';
    const tokens = dir && dir !== stem ? [...tokenize(dir), ...tokenize(stem)] : tokenize(stem);
    return camelize(tokens);
};

/** path context가 이미 generic type suffix로 끝나면 중복해서 붙이지 않는다. */
const genericPathName = (relPath: string, typed: string): string => {
    const context = pathContext(relPath);
    const suffix = upperFirst(typed);
    return context.toLowerCase().endsWith(suffix.toLowerCase()) ? context : `${context}${suffix}`;
};

/** `&`, `|`, `<`, `.` 등이 없는 단순 identifier 여부 */
export const isSimpleIdentifier = (typeArgText: string): boolean =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(typeArgText.trim());

/** `(relPath, typeArgText)` 기준의 짧고 결정적인 hash */
const shortHash = (relPath: string, typeArgText: string): string =>
    createHash('sha1').update(`${relPath}\0${typeArgText}`).digest('hex').slice(0, 4);

/** identifier에 사용할 수 없는 문자를 제거하고 첫 글자를 보정 */
const stripInvalid = (name: string): string => {
    const out = name.replace(/[^A-Za-z0-9_]/g, '');
    if (!out) return '';
    const headSafe = !/[a-z]/.test(out.charAt(0)) ? out.charAt(0).toLowerCase() + out.slice(1) : out;
    return /^[a-z_]/.test(headSafe) ? headSafe : `_${headSafe}`;
};

/** 예약어/identifier 규칙을 만족하도록 최종 보정 */
const ensureValid = (name: string, input: DerivationInput): string => {
    const stripped = stripInvalid(name);
    const reservedSafe = RESERVED.has(stripped) ? `${stripped}_` : stripped;
    return IDENT.test(reservedSafe) ? reservedSafe : stripInvalid(`fk${shortHash(input.relPath, input.typeArgText)}`);
};

/**
 * 호출 위치의 기본 이름을 생성한다. (충돌 처리 전)
 * - 단순 identifier type arg => camelCase(typeArg)
 * - 복합 type arg(intersection/union 등) => camelCase(enclosingContext) + 'Mix'
 * - enclosingContext 없음 => camelCase(fileStem) + 'Mix'
 */
export const baseName = (input: DerivationInput): string => {
    const { typeArgText, enclosingContext, relPath } = input;
    const trimmed = typeArgText.trim();
    if (isSimpleIdentifier(trimmed)) {
        const typed = camelize(tokenize(trimmed));
        const base = GENERIC_TYPE_NAMES.has(trimmed) ? genericPathName(relPath, typed) : typed;
        return ensureValid(base, input);
    }
    if (enclosingContext && enclosingContext.trim()) {
        return ensureValid(`${camelize(tokenize(enclosingContext))}Mix`, input);
    }
    return ensureValid(`${camelize(tokenize(fileStem(relPath)))}Mix`, input);
};

/** 기본 이름이 충돌할 때, 경로 prefix를 붙여 한번 더 구분 */
export const prefixWithPath = (base: string, relPath: string): string => {
    const segments = relPath.split('/').filter(Boolean);
    const dirs = segments.slice(0, -1);
    const prefix = dirs.length === 0 ? '' : camelize(tokenize(dirs[dirs.length - 1]));
    if (!prefix) return base;
    const joined = prefix + base.charAt(0).toUpperCase() + base.slice(1);
    const out = stripInvalid(joined);
    return RESERVED.has(out) ? `${out}_` : out;
};

/**
 * `taken` 집합 안에서 최종 unique 이름을 확정한다.
 * - `taken`은 caller가 전체 호출 위치 기준으로 누적 관리한다.
 * - 기본 이름 -> 경로 prefix -> hash 순서로 충돌을 줄인다.
 */
export const deriveName = (input: DerivationInput, taken: Set<string>): string => {
    const base = baseName(input);
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    const prefixed = prefixWithPath(base, input.relPath);
    if (prefixed !== base && !taken.has(prefixed)) {
        taken.add(prefixed);
        return prefixed;
    }
    const hash = shortHash(input.relPath, input.typeArgText);
    const makeHashed = (attempt = 0): string => {
        const suffix = attempt === 0 ? '' : `_${attempt}`;
        const hashed = ensureValid(`${base}_${hash}${suffix}`, input);
        return taken.has(hashed) ? makeHashed(attempt + 1) : hashed;
    };
    const hashed = makeHashed();
    taken.add(hashed);
    return hashed;
};
