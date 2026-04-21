/**
 * `field-derive-name.spec.ts`
 * - registry 이름 생성 규칙 테스트.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added field key derivation tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { DerivationInput, baseName, deriveName, isSimpleIdentifier, prefixWithPath } from './field-derive-name';

const mk = (p: Partial<DerivationInput> = {}): DerivationInput => ({
    relPath: 'src/service/backend-model.ts',
    typeArgText: 'UserModel',
    enclosingContext: undefined,
    ...p,
});

describe('isSimpleIdentifier', () => {
    it.each([
        ['UserModel', true],
        ['_foo', true],
        ['$bar', true],
        ['A & B', false],
        ['A | B', false],
        ['Array<string>', false],
        ['ns.Model', false],
        ['', false],
        ['1abc', false],
    ])('%s -> %s', (input, expected) => {
        expect(isSimpleIdentifier(input)).toBe(expected);
    });
});

describe('baseName', () => {
    it('simple identifier camelizes', () => {
        expect(baseName(mk({ typeArgText: 'UserModel' }))).toBe('userModel');
        expect(baseName(mk({ typeArgText: 'PostHead' }))).toBe('postHead');
        expect(baseName(mk({ typeArgText: 'ALLCAPS' }))).toBe('allcaps');
    });

    it('generic identifier uses path context', () => {
        expect(
            baseName(
                mk({
                    relPath: 'src/modules/callback/transformer.spec.ts',
                    typeArgText: 'Model',
                }),
            ),
        ).toBe('callbackTransformerModel');
        expect(
            baseName(
                mk({
                    relPath: 'src/modules/mock/model.ts',
                    typeArgText: 'Model',
                }),
            ),
        ).toBe('mockModel');
    });

    it('intersection with enclosing context → contextMix', () => {
        expect(
            baseName(
                mk({
                    relPath: 'src/modules/boards/model.ts',
                    typeArgText: 'Review & Question & Comment',
                    enclosingContext: 'post',
                }),
            ),
        ).toBe('postMix');
    });

    it('intersection without enclosing context falls back to fileStem', () => {
        expect(
            baseName(
                mk({
                    relPath: 'src/modules/boards/model.ts',
                    typeArgText: 'A & B',
                }),
            ),
        ).toBe('modelMix');
    });

    it('union also counts as complex (falls into Mix path)', () => {
        expect(baseName(mk({ typeArgText: 'A | B', enclosingContext: 'primary' }))).toBe('primaryMix');
    });

    it('reserved-word camelizations get underscore-suffixed', () => {
        expect(baseName(mk({ typeArgText: 'Class' }))).toBe('class_');
    });

    it('non-alphanumeric context is sanitized', () => {
        expect(baseName(mk({ typeArgText: 'A & B', enclosingContext: 'primary-post key' }))).toBe('primaryPostKeyMix');
    });

    it('falls back to hash name when sanitized base is not a valid public identifier', () => {
        const out = baseName(mk({ relPath: '123.ts', typeArgText: 'A & B' }));
        expect(out).toMatch(/^fk[0-9a-f]{4}$/);
    });
});

describe('prefixWithPath', () => {
    it('prepends last dir segment', () => {
        expect(prefixWithPath('userModel', 'src/modules/admin/users/model.ts')).toBe('usersUserModel');
    });

    it('returns base unchanged when file is at root', () => {
        expect(prefixWithPath('userModel', 'model.ts')).toBe('userModel');
    });
});

describe('deriveName — collision resolution', () => {
    it('first site keeps base', () => {
        const taken = new Set<string>();
        const out = deriveName(mk({ typeArgText: 'UserModel' }), taken);
        expect(out).toBe('userModel');
        expect(taken).toContain('userModel');
    });

    it('second site with different dir uses path prefix', () => {
        const taken = new Set<string>();
        deriveName(mk({ relPath: 'src/modules/users/model.ts', typeArgText: 'UserModel' }), taken);
        const out = deriveName(mk({ relPath: 'src/modules/admin/users/model.ts', typeArgText: 'UserModel' }), taken);
        //* 첫 번째는 base `userModel`, 두 번째는 path prefix `usersUserModel` 사용.
        expect(taken).toContain('userModel');
        expect(out).toBe('usersUserModel');
    });

    it('third collision falls to hash suffix', () => {
        const taken = new Set<string>();
        deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), taken); //* => userModel
        deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), taken); //* => aUserModel

        const out3 = deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), taken);
        //* 두 번째 site는 `aUserModel` prefix로 해결.
        //* 세 번째 site는 base/prefix 모두 충돌하므로 hash suffix 사용.
        expect(/^userModel_[0-9a-f]{4}$/.test(out3)).toBe(true);
    });

    it('hashes are deterministic for same (relPath, typeArgText)', () => {
        const takenA = new Set<string>(['userModel', 'aUserModel']);
        const takenB = new Set<string>(['userModel', 'aUserModel']);
        const a = deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), takenA);
        const b = deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), takenB);
        expect(a).toBe(b);
    });

    it('increments suffix when base, path prefix and hash are already taken', () => {
        const taken = new Set<string>(['userModel', 'aUserModel']);
        const first = deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), taken);
        const second = deriveName(mk({ relPath: 'src/a/model.ts', typeArgText: 'UserModel' }), taken);

        expect(first).toMatch(/^userModel_[0-9a-f]{4}$/);
        expect(second).toBe(`${first}_1`);
    });
});
