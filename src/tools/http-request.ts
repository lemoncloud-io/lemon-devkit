/**
 * `http-request.ts`
 * - minimal `request`-compatible http client over Node's built-in `http`/`https` (B18).
 * - replaces the deprecated `request` package for `exec-cli#do_http` (one short local call per page,
 *   so `http.request` avoids `fetch`'s first-use undici load cost).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 initial (B18 - drop deprecated `request`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import http from 'http';
import https from 'https';

//* B18: the option subset `exec-cli#prepare_json` builds (same keys `request` accepted).
export interface HttpOptions {
    method?: string;
    uri?: string;
    url?: string;
    headers?: Record<string, any>;
    json?: boolean;
    qs?: Record<string, any> | null;
    body?: any;
    timeout?: number;
    followRedirect?: boolean;
    maxRedirects?: number;
}

//* B18: the response fields callers read (`request`'s `IncomingMessage` + `.body`).
export interface HttpResponse {
    statusCode: number;
    statusMessage?: string;
    headers: http.IncomingHttpHeaders;
    body?: any;
}

//* B18: `request`-style callback - `(error, response, body)`.
export type HttpCallback = (error: any, res: HttpResponse | null, body?: any) => void;

//* B18: injectable request function type (default: `httpRequest`).
export type ReqFn = (options: HttpOptions, cb: HttpCallback) => void;

//* B18: methods `request` never auto-follows on 3xx (its default `followRedirect` rule).
const NO_FOLLOW = ['PATCH', 'PUT', 'POST', 'DELETE'];

//* B18: case-insensitive header presence check.
const hasHeader = (headers: Record<string, any>, name: string): boolean =>
    Object.keys(headers).some(k => k.toLowerCase() === name.toLowerCase());

//* B18: build the target URL - `uri`/`url` plus `qs` merged over any existing query (like `request`).
const buildUrl = (options: HttpOptions): URL => {
    const url = new URL(`${options.uri ?? options.url ?? ''}`);
    const qs = options.qs && typeof options.qs === 'object' ? options.qs : {};
    Object.entries(qs).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, `${v}`));
    return url;
};

//* B18: encode the request body - JSON when `json` is set, string/Buffer as-is otherwise (object -> JSON).
const buildBody = (options: HttpOptions, headers: Record<string, any>): string | Buffer | undefined => {
    const body = options.body;
    if (body === undefined || body === null) return undefined;
    //* B18: like `request`, `json: true` stringifies any body (a string body gets JSON-quoted).
    if (options.json) {
        if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
        return JSON.stringify(body);
    }
    return typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
};

//* B18: decode the response body - JSON-parsed when `json` is set (raw text if not parseable).
const parseBody = (options: HttpOptions, chunks: Buffer[]): any => {
    const text = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
    if (!options.json) return text ?? '';
    if (text === undefined) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

/**
 * do one http(s) call, `request`-style: never rejects on non-2xx (status is on `res.statusCode`),
 * calls back with an error only for invalid URL, network failure, or timeout.
 */
export const httpRequest: ReqFn = (options, cb) => {
    let done = false;
    //* B18: settle exactly once.
    const finish: HttpCallback = (err, res, body) => {
        if (done) return;
        done = true;
        cb(err, res, body);
    };
    const method = `${options.method || 'GET'}`.toUpperCase();
    const maxRedirects = options.maxRedirects ?? 10;
    const follow = options.followRedirect !== false && !NO_FOLLOW.includes(method);

    //* B18: one hop; recurses on a followed 3xx.
    const send = (url: URL, hops: number): void => {
        const lib = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
        if (!lib) return finish(new Error(`Invalid protocol: ${url.protocol}`), null);
        const headers: Record<string, any> = { ...(options.headers || {}) };
        if (options.json && !hasHeader(headers, 'accept')) headers['accept'] = 'application/json';
        const body = buildBody(options, headers);
        if (body !== undefined && !hasHeader(headers, 'content-length'))
            headers['content-length'] = Buffer.byteLength(body);

        const req = lib.request(url, { method, headers }, res => {
            const status = res.statusCode || 0;
            const location = res.headers.location;
            //* B18: follow redirects like `request` (GET/HEAD/... only, max 10).
            if (follow && status >= 300 && status < 400 && location) {
                res.resume();
                if (hops >= maxRedirects)
                    return finish(new Error(`Exceeded maxRedirects. Probably stuck in a redirect loop ${url}`), null);
                return send(new URL(location, url), hops + 1);
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', (e: any) => finish(e, null));
            res.on('end', () => {
                const parsed = parseBody(options, chunks);
                const out: HttpResponse = {
                    statusCode: status,
                    statusMessage: res.statusMessage,
                    headers: res.headers,
                    body: parsed,
                };
                finish(null, out, parsed);
            });
        });
        req.on('error', (e: any) => finish(e, null));
        //* B18: optional timeout - destroys the socket with `ETIMEDOUT` (same code `request` used).
        if (options.timeout && options.timeout > 0) {
            req.setTimeout(options.timeout, () =>
                req.destroy(Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })),
            );
        }
        if (body !== undefined) req.write(body);
        req.end();
    };

    try {
        send(buildUrl(options), 0);
    } catch (e) {
        finish(e, null);
    }
};
