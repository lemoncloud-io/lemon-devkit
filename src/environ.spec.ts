/**
 * `environ.spec.ts`
 * - test runnder for `environ.ts`
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 optimize for `lemon-core#v4`
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import { expect2 } from 'lemon-core';
import { loadEnviron } from './environ';

const safe = (f: () => unknown) => {
    try {
        return f();
    } catch (e) {
        // console.error('! err =', e);
        return e;
    }
};

const $environ = (env?: { [key: string]: string }, opts?: { STAGE?: string }): any => {
    //* convert all string.
    env =
        (env &&
            Object.keys(env).reduce((O: any, k) => {
                O[k] = `${env[k]}`;
                return O;
            }, {})) ||
        env;
    const proc = { env };
    const ENV_PATH = 1 ? './env' : __dirname + '/../env';
    const opt = { ENV_PATH, ...opts };
    return safe(() => loadEnviron(proc, opt));
};

//! main test body.
describe(`test the 'environ.ts'`, () => {
    test('check basic environ()', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NODE_ENV: 'prod' });
        expect2(() => $conf, 'NAME').toEqual({ NAME: 'lemon' });
        expect2(() => $conf, 'STAGE').toEqual({ STAGE: 'production' });
        expect2(() => $conf, 'TS').toEqual({ TS: '0' });
    });

    test('check file error', () => {
        const $conf = $environ({ LS: '1', ENV: 'anony' });
        expect2(() => $conf.message.split(':')[0]).toEqual('FILE NOT FOUND');
    });

    test('check default envion', () => {
        const $env = { LS: '1' };
        const $envDef = $environ($env);
        const $expEnv = { LS: '1', LC: '1', NAME: 'none', STAGE: 'local', TS: '1', NS: 'TT' };
        expect2(() => $envDef).toEqual({ ...$expEnv });

        const $envTst = $environ($env, { STAGE: 'test' });
        expect2(() => $envTst).toEqual({ ...$expEnv, LOCAL_ACCOUNT: 'my-local-iid', STAGE: 'test' });

        const $envLoc = $environ($env, { STAGE: 'local' });
        expect2(() => $envLoc).toEqual({ ...$expEnv });

        const $envDev = $environ($env, { STAGE: 'dev' });
        expect2(() => $envDev).toEqual({ ...$expEnv, STAGE: 'develop' });

        const $envPrd = $environ($env, { STAGE: 'prod' });
        expect2(() => $envPrd).toEqual({ ...$expEnv, STAGE: 'production', NS: 'SS', TS: '0' });
    });

    test('check unknown envion.stage', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', STAGE: 'proxy' });
        expect2(() => $conf.STAGE).toEqual('proxy');
    });

    test('check override', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NAME: 'hello', STAGE: 'prod' });
        expect2(() => $conf.NAME).toEqual('hello');
        expect2(() => $conf.STAGE).toEqual('prod');
    });

    test('check override', () => {
        const $conf = $environ({ LS: '1', ENV: 'lemon', NAME: 'hello', STAGE: 'local' });
        expect2(() => $conf.NAME).toEqual('test-lemon');
        expect2(() => $conf.STAGE).toEqual('local');
        expect2(() => $conf.LIST).toEqual('a, b');
    });
});
