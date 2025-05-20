/**
 * `tools/shared.spec.ts`
 * - test runnder of hello-api
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 optimize for `lemon-core#v4`
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import { getRunParam } from './shared';

//! main test body.
describe('Test tools/shared', () => {
    //* test getRunParam() with process.argv
    test('test getRunParam()', () => {
        const argv = '--port 1234 -name hello -flag 1 -json {"a":1} -arr [1]'.split(' ');
        const $arg = (n: string, d?: boolean | number | string | object) => getRunParam(n, d, argv);
        expect($arg('port')).toBe('1234');
        expect($arg('port', 1)).toBe(1234);
        expect($arg('name', 'lemon')).toBe('hello');
        expect($arg('nick', 'lemon')).toBe('lemon');
        expect($arg('flag', false)).toBe(true);
        //* object type
        expect($arg('name', ['a'])).toEqual(['hello']);
        expect($arg('name', null)).toEqual({ value: 'hello' });
        expect($arg('json', null)).toEqual({ a: 1 });
        expect($arg('arr', null)).toEqual([1]);

        //* default with process.arg
        expect(getRunParam('hello', 'none')).toEqual('none');
    });

    test('test getRunParam() w/o process.argv', async () => {
        process.argv = undefined;
        //* default with process.arg
        expect(getRunParam('hello', 'none')).toEqual('none');
    });
});
