/**
 * `exec-cli.spec.ts`
 * - test runner for `exec-cli.ts` (D1 - import-safety refactor).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-09-02 initial (WP-D1 - lemon module hardening track3)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

//* `request` does real network I/O - always mocked, never real, per the safety contract.
vi.mock('request', () => ({ __esModule: true, default: vi.fn() }));

//* `./tools/shared` is a local, side-effect-free module - mock only `loadJsonSync` (so
//* `bootstrap()`'s package.json read is controllable) while keeping the REAL `getRunParam`
//* (its exact argv-parsing quirks are what several tests below characterize).
vi.mock('./tools/shared', async importOriginal => {
    const actual = await importOriginal<typeof import('./tools/shared')>();
    return { ...actual, loadJsonSync: vi.fn(() => ({})) };
});

//! main test body.
describe('Test exec-cli', () => {
    const ORIG_ARGV = process.argv;
    const ORIG_ENV = { ...process.env };

    afterEach(() => {
        process.argv = ORIG_ARGV;
        process.env = { ...ORIG_ENV };
    });

    /** ****************************************************************************************
     * D1 core acceptance: merely importing this module must be side-effect free.
     ***************************************************************************************** */
    describe('module import safety (D1 acceptance)', () => {
        test('import * as cli does not touch env / argv / package.json / log, and does not throw', async () => {
            //* arrange: make sure a `.port`-less run would previously have thrown at import-time,
            //* and that argv/env are in a state that would previously have been read eagerly.
            delete process.env.TS;
            delete process.env.LC;
            process.argv = ['node', 'exec-cli']; // no -page/-ep/... args.

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
            const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const shared: any = await import('./tools/shared');

            //* act: fresh import (does not throw).
            const cli = await import('./exec-cli');

            //* assert (a) process.env untouched.
            expect(process.env.TS).toBeUndefined();
            expect(process.env.LC).toBeUndefined();
            //* assert (c) `loadJsonSync` (package.json read) never invoked.
            expect(shared.loadJsonSync).not.toHaveBeenCalled();
            //* assert (d) no logging happened.
            expect(logSpy).not.toHaveBeenCalled();
            expect(errSpy).not.toHaveBeenCalled();
            //* assert: the module loaded and exposes the expected surface (compat + new).
            expect(typeof cli.run).toBe('function');
            expect(typeof cli.run_batch).toBe('function');
            expect(typeof cli.parseConfig).toBe('function');
            expect(typeof cli.bootstrap).toBe('function');
            expect(typeof cli.do_http).toBe('function');
            expect(typeof cli.prepare_json).toBe('function');
            expect(typeof cli.wait_sometime).toBe('function');

            logSpy.mockRestore();
            errSpy.mockRestore();
        });
    });

    /** ****************************************************************************************
     * parseConfig() - pure function. NOTE: argv arrays below always carry a leading dummy token
     * (mirroring real `process.argv`'s `[node, script, ...flags]` shape) - `getRunParam` only
     * finds a `-flag` match past index 0 (see `tools/shared.ts#getRunParam`'s own lookup order),
     * so a bare `['-page', '3']` at index 0 would silently miss and fall back to the default.
     ***************************************************************************************** */
    describe('parseConfig()', () => {
        test('derives NAME/VERS/PORT/ENDPOINT from pack', async () => {
            const { parseConfig } = await import('./exec-cli');
            const config = parseConfig([], { name: 'my-api', version: '1.2.3', port: 8081 });
            expect(config.NAME).toEqual('my-api');
            expect(config.VERS).toEqual('1.2.3');
            expect(config.PORT).toEqual(8081);
            expect(config.ENDPOINT).toEqual('http://localhost:8081');
        });

        test('falls back to defaults when pack fields are missing', async () => {
            const { parseConfig } = await import('./exec-cli');
            const config = parseConfig([], {});
            expect(config.NAME).toEqual('LEMON API');
            expect(config.VERS).toEqual('0.0.0');
            expect(config.PORT).toEqual(0);
        });

        test('reads -m/-ep/-id/-ipp/-wait/-sid/-cmd/-opt from argv', async () => {
            const { parseConfig } = await import('./exec-cli');
            const argv = ['node', 'exec-cli'].concat(
                '-m PUT -ep goods -id g1 -ipp 20 -wait 500 -sid lemon -cmd sync-list -opt save=0'.split(' '),
            );
            const config = parseConfig(argv, { port: 1234 });
            expect(config.METHOD).toEqual('PUT');
            expect(config.EP).toEqual('goods');
            expect(config.ID).toEqual('g1');
            expect(config.IPP).toEqual(20);
            expect(config.WAIT).toEqual(500);
            expect(config.SID).toEqual('lemon');
            expect(config.CMD).toEqual('sync-list');
            expect(config.OPT).toEqual('save=0');
        });

        test('defaults METHOD=GET, WAIT=1000 when absent (trap #6 - WAIT param default)', async () => {
            const { parseConfig } = await import('./exec-cli');
            const config = parseConfig([], { port: 1234 });
            expect(config.METHOD).toEqual('GET');
            expect(config.WAIT).toEqual(1000);
        });

        //* trap #8 - `page~max` parsing table.
        //* NOTE (spec defect, see D1-report.md): the source guard is `indexOf('~') > 0`, which
        //* requires at least one character BEFORE the tilde. For `'~7'` (tilde at index 0) that
        //* guard is false, so it does NOT take the split branch - it falls to the `else` branch
        //* (`page = Number('~7')` = NaN). The coordinator's trap-#8 table lists `'~7' -> [0,7]`,
        //* which assumes the split branch fires here; actual (preserved, unmodified) behavior is
        //* `[NaN, 1]`. Characterized as observed, not as tabled - see report for the discrepancy.
        test.each([
            ['3~7', [3, 7]],
            ['3~', [3, 0]],
            ['~7', [NaN, 1]],
            ['abc~7', [0, 7]],
            ['0~5', [0, 5]],
            ['5', [5, 1]],
            ['', [0, 1]],
        ])('page arg %j -> [PAGE, MAX] = %j', async (pageArg, expected) => {
            const { parseConfig } = await import('./exec-cli');
            const argv = pageArg === '' ? ['node', 'exec-cli'] : ['node', 'exec-cli', '-page', pageArg];
            const config = parseConfig(argv, { port: 1234 });
            expect([config.PAGE, config.MAX]).toEqual(expected);
        });
    });

    /** ****************************************************************************************
     * bootstrap() - env override -> package.json load -> PORT validation -> log.
     ***************************************************************************************** */
    describe('bootstrap()', () => {
        test('sets process.env.TS/LC (trap #1 - see exec-cli.ts header comment for the ordering proof)', async () => {
            const { bootstrap } = await import('./exec-cli');
            const shared: any = await import('./tools/shared');
            (shared.loadJsonSync as any).mockReturnValueOnce({ name: 'n', version: '1', port: 3000 });
            delete process.env.TS;
            delete process.env.LC;

            bootstrap();

            expect(process.env.TS).toEqual('1');
            expect(process.env.LC).toEqual('1');
        });

        test('throws when package.json has no .port (trap #2 - moved from import-time to call-time)', async () => {
            const { bootstrap } = await import('./exec-cli');
            const shared: any = await import('./tools/shared');
            (shared.loadJsonSync as any).mockReturnValueOnce({ name: 'n', version: '1' }); // no `.port`.
            process.argv = ['node', 'exec-cli'];

            expect(() => bootstrap()).toThrowError('.port is required at package.json!');
        });

        test('reads package.json via the injected loadJsonSync, not a real file (trap #3)', async () => {
            const { bootstrap } = await import('./exec-cli');
            const shared: any = await import('./tools/shared');
            (shared.loadJsonSync as any).mockReturnValueOnce({ name: 'test-app', version: '9.9.9', port: 5555 });

            const config = bootstrap();
            expect(config.NAME).toEqual('test-app');
            expect(config.VERS).toEqual('9.9.9');
            expect(config.PORT).toEqual(5555);
        });
    });

    /** ****************************************************************************************
     * do_http() - request fn is injectable; no network.
     ***************************************************************************************** */
    describe('do_http()', () => {
        test('rejects when options or options.uri missing', async () => {
            const { do_http } = await import('./exec-cli');
            await expect(do_http(null)).rejects.toThrow('invalid options');
            await expect(do_http({})).rejects.toThrow('invalid options');
        });

        test('parses a JSON object body when content-type is application/json (trap #11)', async () => {
            const { do_http } = await import('./exec-cli');
            const fakeRequest: any = (options: any, cb: any) =>
                cb(null, { headers: { 'content-type': 'application/json' } }, '{"a":1}');
            const result = await do_http({ uri: '/x', method: 'GET' }, fakeRequest);
            expect(result).toEqual({ a: 1 });
        });

        test('does NOT parse a JSON array body - resolves the raw string (trap #11)', async () => {
            const { do_http } = await import('./exec-cli');
            const fakeRequest: any = (options: any, cb: any) =>
                cb(null, { headers: { 'content-type': 'application/json' } }, '[1,2,3]');
            const result = await do_http({ uri: '/x', method: 'GET' }, fakeRequest);
            expect(result).toEqual('[1,2,3]');
        });

        test('resolves the raw body when content-type is not application/json', async () => {
            const { do_http } = await import('./exec-cli');
            const fakeRequest: any = (options: any, cb: any) =>
                cb(null, { headers: { 'content-type': 'text/plain' } }, 'hello');
            const result = await do_http({ uri: '/x', method: 'GET' }, fakeRequest);
            expect(result).toEqual('hello');
        });

        test('rejects on request error', async () => {
            const { do_http } = await import('./exec-cli');
            const fakeRequest: any = (options: any, cb: any) => cb(new Error('boom'), null, null);
            await expect(do_http({ uri: '/x', method: 'GET' }, fakeRequest)).rejects.toThrow('boom');
        });

        test('rejects when the json-looking body fails to parse', async () => {
            const { do_http } = await import('./exec-cli');
            const fakeRequest: any = (options: any, cb: any) =>
                cb(null, { headers: { 'content-type': 'application/json' } }, '{not-json}');
            await expect(do_http({ uri: '/x', method: 'GET' }, fakeRequest)).rejects.toThrow();
        });

        test('deletes options.body when options.json is set and body is falsy (trap #12)', async () => {
            const { do_http } = await import('./exec-cli');
            const seen: any[] = [];
            const fakeRequest: any = (options: any, cb: any) => {
                seen.push(options);
                cb(null, { headers: {} }, 'ok');
            };
            const options: any = { uri: '/x', method: 'GET', json: true, body: null };
            await do_http(options, fakeRequest);
            expect('body' in seen[0]).toBe(false);
        });
    });

    /** ****************************************************************************************
     * prepare_json() - trap #7 (body forces POST).
     ***************************************************************************************** */
    describe('prepare_json()', () => {
        test('defaults method to GET and requires path', async () => {
            const { prepare_json } = await import('./exec-cli');
            const options = prepare_json('', '/p', { q: 1 }, null);
            expect(options.method).toEqual('GET');
            expect(options.uri).toEqual('/p');
            expect(options.json).toBe(true);
            expect(options.qs).toEqual({ q: 1 });
            expect(() => prepare_json('GET', '', null, null)).toThrow('path is required!');
        });

        test('forces method to POST when body is present, even if PUT was requested (trap #7)', async () => {
            const { prepare_json } = await import('./exec-cli');
            const options = prepare_json('PUT', '/p', null, { a: 1 });
            expect(options.method).toEqual('POST');
        });
    });

    /** ****************************************************************************************
     * wait_sometime() - trap #6 (dead default 1500 vs WAIT param default 1000).
     ***************************************************************************************** */
    describe('wait_sometime()', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        test('resolves with `that` after the given time', async () => {
            const { wait_sometime } = await import('./exec-cli');
            const p = wait_sometime({ x: 1 }, 10);
            vi.advanceTimersByTime(10);
            await expect(p).resolves.toEqual({ x: 1 });
        });

        test('characterization: falsy time falls back to the dead default 1500ms, not 1000 (trap #6)', async () => {
            const { wait_sometime } = await import('./exec-cli');
            const resolved = vi.fn();
            wait_sometime({ x: 1 }, 0).then(resolved);
            await vi.advanceTimersByTimeAsync(1499);
            expect(resolved).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            expect(resolved).toHaveBeenCalledWith({ x: 1 });
        });
    });

    /** ****************************************************************************************
     * run_batch(that, ctx) - config/http injectable; recursion preserves ctx (no re-bootstrap).
     * NOTE: `$U.N` used internally is the REAL `lemon-core`'s (not injectable, per spec) - its
     * behavior is deterministic/pure numeric conversion, so exercising it for real here is safe
     * and requires no network/AWS access.
     ***************************************************************************************** */
    describe('run_batch()', () => {
        const baseConfig = (over: Partial<import('./exec-cli').Config> = {}): import('./exec-cli').Config => ({
            NAME: 'n',
            VERS: '1',
            PORT: 1234,
            ENDPOINT: 'http://localhost:1234',
            METHOD: 'GET',
            EP: 'ep',
            ID: '0',
            IPP: 0,
            WAIT: 1, // keep tests fast.
            SID: 'sid',
            CMD: 'cmd',
            OPT: '',
            PAGE: 1,
            MAX: 1,
            ...over,
        });

        test('rejects when `that.page` is missing (trap #14 - my_chain_run_page default -1)', async () => {
            const { run_batch } = await import('./exec-cli');
            const http = vi.fn();
            await expect(run_batch({}, { config: baseConfig(), http })).rejects.toThrow('page is required!');
            expect(http).not.toHaveBeenCalled();
        });

        test('stops when the http response has an empty list (trap #10 - cnt===0)', async () => {
            const { run_batch } = await import('./exec-cli');
            const http = vi.fn().mockResolvedValue({ list: [] });
            const result = await run_batch({ page: 1 }, { config: baseConfig(), http });
            expect(result).toEqual([]);
            expect(http).toHaveBeenCalledTimes(1);
        });

        test('paginates while list is non-empty, stopping at MAX (trap #10/#14 - $U.N(that.total,0) default)', async () => {
            const { run_batch } = await import('./exec-cli');
            const http = vi
                .fn()
                .mockResolvedValueOnce({ list: [1, 2] })
                .mockResolvedValueOnce({ list: [3, 4] });
            const result = await run_batch({ page: 1 }, { config: baseConfig({ MAX: 2 }), http });
            expect(result).toEqual([3, 4]);
            expect(http).toHaveBeenCalledTimes(2);
        });

        test('keeps going when `list` itself is absent (cnt=-1), until MAX (trap #10)', async () => {
            const { run_batch } = await import('./exec-cli');
            const http = vi.fn().mockResolvedValue({}); // no `.list` at all -> cnt=-1, never 0.
            const result = await run_batch({ page: 1 }, { config: baseConfig({ MAX: 3 }), http });
            //* page 1->2 (call#1), 2->3 (call#2), 3->4 (call#3, page2=4>MAX=3 stops here).
            expect(http).toHaveBeenCalledTimes(3);
            expect(result).toBeUndefined();
        });

        test('DELETE does not increment the page (trap #9)', async () => {
            const { run_batch } = await import('./exec-cli');
            //* MAX=0 so only `cnt===0` can stop the loop - proves the loop isn't merely
            //* MAX-bounded, but genuinely never advances `page` for METHOD=DELETE.
            const http = vi
                .fn()
                .mockResolvedValueOnce({ list: [1] }) // cnt=1, would continue.
                .mockResolvedValueOnce({ list: [] }); // cnt=0, stops.
            await run_batch({ page: 1 }, { config: baseConfig({ METHOD: 'DELETE', MAX: 0 }), http });
            expect(http).toHaveBeenCalledTimes(2);
            //* both calls used the same `page` value in the built uri (DELETE never bumps it).
            expect(http.mock.calls[0][0].uri).toEqual(http.mock.calls[1][0].uri);
        });

        test('recursion preserves the injected config/http - no re-bootstrap on later pages', async () => {
            const { run_batch } = await import('./exec-cli');
            const shared: any = await import('./tools/shared');
            (shared.loadJsonSync as any).mockClear();
            const http = vi
                .fn()
                .mockResolvedValueOnce({ list: [1] })
                .mockResolvedValueOnce({ list: [] });
            await run_batch({ page: 1 }, { config: baseConfig({ MAX: 5 }), http });
            expect(shared.loadJsonSync).not.toHaveBeenCalled(); // bootstrap() never invoked.
        });
    });

    /** ****************************************************************************************
     * run() - back-compat entry point: single bootstrap, PAGE from config, delegates to run_batch.
     ***************************************************************************************** */
    describe('run()', () => {
        test('bootstraps exactly once even though run_batch may recurse across pages', async () => {
            const { run } = await import('./exec-cli');
            const shared: any = await import('./tools/shared');
            const req: any = (await import('request')).default;
            (shared.loadJsonSync as any).mockClear();
            (shared.loadJsonSync as any).mockReturnValue({ name: 'n', version: '1', port: 1234 });
            //* -wait 1 keeps the (mocked, network-free) chain's internal delay tiny for the test;
            //* first (and only, since the list is empty) call resolves immediately via the mock.
            process.argv = ['node', 'exec-cli', '-page', '1', '-max', '1', '-wait', '1'];
            req.mockImplementation((options: any, cb: any) =>
                cb(null, { headers: { 'content-type': 'application/json' } }, '{"list":[]}'),
            );

            run();
            //* `run()` fires-and-forgets (matches the original's non-awaited call) - `loadJsonSync`'s
            //* call count is already final synchronously (bootstrap() runs before any awaiting),
            //* but give the mocked chain a tick to settle so it doesn't leak into later tests.
            await new Promise(r => setTimeout(r, 20));

            expect(shared.loadJsonSync).toHaveBeenCalledTimes(1);
            expect(req).toHaveBeenCalledTimes(1);
        });
    });
});
