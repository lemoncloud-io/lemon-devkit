/**
 * `lib/tools.ts`
 * - additional helper.
 *
 * ex:
 * ```ts
 * const environ = require('lemon-core/dist/environ').default;
 * const $env = environ(process)
 * ```
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 optimize for `lemon-core#v4`
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */

interface AdaptiveParam<T> {
    (name: string, defval: T, argv?: string[]): T;
}
/**
 * get running parameter like -h api.
 */
export const getRunParam: AdaptiveParam<boolean | number | string | object> = (o, defval, argv?) => {
    // export function getRunParam<U extends boolean | number | string | object>(o: string, defval: U, argv?: string[]): U {
    // eslint-disable-next-line no-param-reassign
    argv = argv || process.argv || []; // use scope.
    const nm = `-${o}`;
    let i = argv.indexOf(nm);
    i = i > 0 ? i : argv.indexOf(o);
    i = i >= 0 ? i : argv.indexOf(`-${nm}`); // lookup -o => --o.
    if (i >= 0) {
        const val = argv[i + 1];
        if (typeof defval === 'boolean') {
            // transform to boolean.
            return val === 'true' || val === 't' || val === 'y' || val === '1';
        } else if (typeof defval === 'number') {
            // convert to integer.
            return Math.round(Number(val) / 1);
        } else if (typeof defval === 'object') {
            // array or object
            if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}')))
                return JSON.parse(val);
            else if (Array.isArray(defval)) return `${val}`.split(', ');
            else return { value: val };
        }
        return val;
    }
    return defval;
};
