/**
 * `exec-cli.ts`
 * - command line runner w/ local http request.
 *
 *
 * ## run in command line.
 * ```bash
 * $ node . -ep goods -sid lemon -cmd sync-list -opt save=0 -page 1
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-01 initial optimized via `imweb-forms-api/run.js`
 * @date        2025-05-20 optimize for `lemon-core#v4`
 * @date        2026-09-02 refactor for import-safety (D1) - no top-level side-effects.
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import request from 'request';
import { getRunParam, loadJsonSync } from './tools/shared';

/** ********************************************************************************************************************
 *  lazy engine loader.
 *
 *  NOTE - `lemon-core`'s `TS`/`LC` log-decoration flags are captured ONCE, synchronously, the very
 *  first time `lemon-core` is `require()`-d in the process:
 *    - `lemon-core/dist/engine/index.js:39`  -> `exports.$engine = buildEngine(global, { env: process.env });`
 *      (this line runs unconditionally when `lemon-core` is first loaded - see the file's own
 *      comment: "if loading this index.ts, it will trigger `bootloader` in `/engine`.")
 *    - `lemon-core/dist/engine/builder.js:193-194` -> inside `buildEngine()`:
 *          `const TS = _environ('TS', '1') === '1';`
 *          `const LC = _environ('LC', ...) === '1';`
 *      these two booleans are baked into the `$console` object once, and `_log/_inf/_err`
 *      (built via `build_log($console)` etc.) close over that fixed `$console` forever after -
 *      i.e. import-time-fixed, NOT re-read per log call.
 *    - by contrast, `lemon-core/dist/engine/utilities.js:285` (`Utilities.NS()`) does
 *      `const LC = this.env('LC', '0') === '1';` - this one IS re-read on every call, so the
 *      colorizing of the `NS` label itself is dynamic and import-order-independent.
 *  Net effect: to preserve the original CLI's exact log decoration (colorized + timestamped),
 *  `process.env.TS/LC` MUST be set before the FIRST EVER `require('lemon-core')` in the process.
 *  Since the original file set env (lines 23-24) textually before `import ... from 'lemon-core'`
 *  (line 27) - and this project compiles with `"module": "commonjs"`, where TS preserves the
 *  source order of `import`-turned-`require()` calls relative to plain statements - that ordering
 *  was exactly this trick. We keep the same guarantee here by deferring the engine load to a
 *  lazily-memoized `require('lemon-core')` call, invoked only from inside `bootstrap()` (or other
 *  call-sites), AFTER `process.env` has been assigned. This keeps `import * as cli from './exec-cli'`
 *  itself free of any env/log/argv/package.json side-effects (see `exec-cli.spec.ts`).
 *
 *  NOTE (`.port` validation) - the original also imported `loadJsonSync` FROM `lemon-core`
 *  (`dist/tools/tools.js:39` - `(name, def={}) => { name = !name.startsWith('./') ? './'+name : name;
 *  try { return JSON.parse(fs.readFileSync(name).toString()); } catch(e){ ...; return def; } }`).
 *  That is byte-for-byte the same implementation as this project's own `./tools/shared.ts#loadJsonSync`
 *  (verified by inspection), so `package.json` loading below uses the local one instead - this makes
 *  it a plain, side-effect-free, statically-`import`-able (hence easily mockable) function, without
 *  needing to load the `lemon-core` engine at all just to read a JSON file.
 ** *******************************************************************************************************************/
export interface LemonCoreLike {
    $U: {
        N: (x: any, def: number) => number;
        NS: (ns: string, color?: string, len?: number, delim?: string) => string;
    };
    _log: (...args: any[]) => void;
    _inf: (...args: any[]) => void;
    _err: (...args: any[]) => void;
}

let _lemonCore: LemonCoreLike | undefined;
/** load (and memoize) the real `lemon-core` engine. caller controls *when* this first happens. */
const lemonCore = (): LemonCoreLike => {
    if (!_lemonCore) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _lemonCore = require('lemon-core');
    }
    return _lemonCore as LemonCoreLike;
};

let _NS: string | undefined;
const getNS = (): string => {
    if (_NS === undefined) _NS = lemonCore().$U.NS('EXEC', 'cyan');
    return _NS as string;
};

/** ********************************************************************************************************************
 *  config.
 ** *******************************************************************************************************************/
export interface Pack {
    name?: string;
    version?: string;
    port?: number;
}

export interface Config {
    NAME: string;
    VERS: string;
    PORT: number;
    ENDPOINT: string;
    METHOD: string;
    EP: string;
    ID: string;
    IPP: number;
    WAIT: number;
    SID: string;
    CMD: string;
    OPT: string;
    PAGE: number;
    MAX: number;
}

/**
 * parse the batch-run configuration.
 * - pure function: `argv`/`pack` are explicit inputs (were `process.argv` / CWD `package.json`).
 * - NOTE: `PORT` here is `Number(pack.port) || 0`, not `$U.N(pack.port, 0)` - for real package.json
 *   input (`port` is always a JSON number) both are equivalent, and keeping this pure avoids
 *   needing `lemon-core` (hence env/import ordering) just to parse config. see `exec-cli.spec.ts`.
 */
export const parseConfig = (argv: string[], pack: Pack): Config => {
    const $arg = (o: string, defval: boolean | number | string | object) => getRunParam(o, defval, argv);
    const NAME = pack.name || 'LEMON API';
    const VERS = pack.version || '0.0.0';
    const PORT = Number(pack.port) || 0; // default server port.
    const ENDPOINT = `http://localhost:${PORT}`;
    const METHOD = $arg('m', 'GET') as string;
    const EP = $arg('ep', '') as string;
    const ID = $arg('id', '0') as string;
    const IPP = $arg('ipp', 0) as number;
    const WAIT = $arg('wait', 1000) as number;
    const SID = $arg('sid', '') as string;
    const CMD = $arg('cmd', '') as string;
    const OPT = $arg('opt', '') as string;
    const [PAGE, MAX] = ((): number[] => {
        let page: any = $arg('page', '');
        let max: any = $arg('max', 1);
        if (`${page}`.indexOf('~') > 0) {
            const pages = `${page}`.split('~').map((_: string) => _.trim());
            page = parseInt(pages[0]) || 0;
            max = parseInt(pages[1]) || 0;
        } else {
            page = Number(page);
            max = Number(max);
        }
        return [page, max];
    })();
    return { NAME, VERS, PORT, ENDPOINT, METHOD, EP, ID, IPP, WAIT, SID, CMD, OPT, PAGE, MAX };
};

/**
 * bootstrap - env override -> package.json load -> PORT validation (throws) -> log.
 * - only runs its side-effects when actually invoked (by `run()`, or by `run_batch(that)`'s
 *   1-arg back-compat fallback) - never merely by importing this module.
 */
export const bootstrap = (): Config => {
    //* override environment - MUST run before the first `lemonCore()` call (see note above).
    const $env = { TS: '1', LC: '1' };
    process.env = Object.assign(process.env, $env);

    //* - load package.json (local `loadJsonSync` - no `lemon-core` needed for this).
    const $pack: Pack = loadJsonSync('package.json');
    const config = parseConfig(process.argv, $pack);
    if (!config.PORT) throw new Error('.port is required at package.json!');

    //* - load engine only now (env already set) - for logging only.
    const { $U, _log } = lemonCore();
    const NS = getNS();
    _log(NS, `###### exec[${config.NAME}@${$U.NS(config.VERS, 'cyan')}${config.PORT}] ######`);
    _log(NS, 'PAGE ~ MAX =', config.PAGE, '~', config.MAX);
    return config;
};

/** ********************************************************************************************************************
 *  main application
 ** *******************************************************************************************************************/
//* do run http. `reqFn` is injectable (default: real `request`) so tests never hit the network.
export const do_http = (options: any, reqFn: typeof request = request): Promise<any> => {
    if (!options || !options.uri) return Promise.reject(new Error('invalid options'));
    const { _inf, _err } = lemonCore();
    const NS = getNS();
    // const cookies = $cm.prepare(options.uri);
    options.headers = options.headers || {};
    // _log(NS, '! options =', options);
    //* preven error `body:null` if json.
    if (options.json && !options.body) {
        delete options.body;
    }
    // options.headers.Cookie = (options.headers.Cookie||'') + (options.headers.Cookie ? '; ':'') + cookies;
    return new Promise((resolve, reject) => {
        _inf(NS, options.method, options.uri);
        reqFn(options, (error: any, res: any, body: any) => {
            if (error) {
                _err(NS, '!ERR=', error);
                return reject(error);
            }
            const ctype = res.headers['content-type'] || '';
            // _log(NS, '! content-type =', ctype);
            if (
                ctype.startsWith('application/json') &&
                typeof body == 'string' &&
                body.startsWith('{') &&
                body.endsWith('}')
            ) {
                try {
                    body = JSON.parse(body);
                    resolve(body);
                } catch (e) {
                    _err(NS, '! invalid json body =', body);
                    reject(e);
                }
            } else {
                // _log(NS, '! text body =', body);
                resolve(body);
            }
        });
    });
};

//* prepare request(json) options
export const prepare_json = function (method: string, path: string, qs: any, body: any) {
    method = method || 'GET';
    if (!path) throw Error('path is required!');
    const options: any = {
        method,
        uri: path,
        json: true,
        qs,
        body,
    };
    // if (body) options.body = typeof body == 'object' ? JSON.stringify(body) : body;
    if (body) options.method = 'POST';
    if (body) {
        const { _inf } = lemonCore();
        _inf(getNS(), '> json.body =', JSON.stringify(body));
    }
    return options;
};

//* wait some
export const wait_sometime = (that: any, time: number): Promise<any> => {
    time = time || 1500;
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(that);
        }, time);
    });
};

/** ********************************************************************************************************************
 *  main batch configuration.
 ** *******************************************************************************************************************/
export interface RunBatchCtx {
    config?: Config;
    http?: (options: any) => Promise<any>;
}

/**
 * page로 하는, 배치 작업을 한번에 실행 시키기..
 *
 * ```sh
 * # example
 * $ node . -ep user -sid lemon -cmd test-self -opt 'force=1' -page 1 -max 2
 */
//* the actual recursive loop - always carries the SAME resolved (config, http) through recursion
//* so bootstrap()/env-set/package.json-load/log only ever happen once per top-level call.
const runBatchLoop = async (that: any, config: Config, httpFn: (options: any) => Promise<any>): Promise<any> => {
    const { $U, _log, _inf, _err } = lemonCore();
    const NS = getNS();
    const { ENDPOINT, EP, ID, CMD, SID, METHOD, IPP, OPT, WAIT, MAX } = config;

    //* invoke http(json).
    const my_chain_run_page = (that: any) => {
        const page = $U.N(that.page, -1);
        _inf(NS, '#page := ', page);
        if (page < 0) return Promise.reject(new Error('page is required!'));
        const body: any = {}; //{map: that.map, default: that.default, layout: that.layout};
        if (that.map) body.map = that.map;
        if (that.default) body.default = that.default;
        if (that.layout) body.layout = that.layout;
        const req = prepare_json(
            METHOD,
            `${ENDPOINT}/${EP}/${ID}/${CMD}?sid=${SID}` +
                (page ? '&page=' + page : '') +
                (IPP ? '&ipp=' + IPP : '') +
                (OPT ? '&' : '') +
                OPT,
            null,
            Object.keys(body).length ? body : null,
        );
        return httpFn(req).then((_: any) => {
            _.layout && _log(NS, '! that[' + page + '].layout =', _.layout);
            _.range && _log(NS, '! that[' + page + '].range =', _.range);
            _.list && _log(NS, '! that[' + page + '].list =', _.list); // if has list.
            _.list || _inf(NS, '!WARN res =', _); // if not list.
            //* attach to that.
            if (_.map) that.map = _.map;
            if (_.default) that.default = _.default;
            if (_.layout) that.layout = _.layout;
            if (_.list) that.list = _.list;
            return that;
        });
    };

    return Promise.resolve(that)
        .then(my_chain_run_page)
        .then(_ => wait_sometime(_, WAIT))
        .then((that: any) => {
            const page = $U.N(that.page, 0);
            const list = that.list;
            const cnt = list ? list.length : -1; // '0' means EOF, -1 means N/A.
            const total = $U.N(that.total, 0);
            _inf(NS, '> cnt@page =', cnt + '@' + page, ':', total);
            const page2 = METHOD != 'DELETE' && page ? page + 1 : page;
            if (cnt === 0 || (MAX > 0 && page2 > MAX)) {
                _log(NS, 'FINISHED! Page =', page);
                return list;
            }
            that.page = page2;
            return runBatchLoop(that, config, httpFn);
        })
        .catch(e => {
            _err(NS, '!ERR! FIN=', e);
            throw e;
        });
};

//* execute page by page. `ctx` is optional: {config, http} - omit either/both to fall back to
//* `bootstrap()` (real env/package.json/engine) and the real `do_http` (network `request`), i.e.
//* the exact original behavior for 1-arg callers (deep-import compat: `dist/exec-cli.js`).
export const run_batch = async (that: any, ctx?: RunBatchCtx): Promise<any> => {
    const config = ctx?.config ?? bootstrap();
    const httpFn = ctx?.http ?? do_http;
    return runBatchLoop(that, config, httpFn);
};

//* export.
export const run = (): void => {
    const config = bootstrap();
    run_batch({ page: config.PAGE }, { config });
};
