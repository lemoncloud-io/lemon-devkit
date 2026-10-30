/**
 * `exec-cli.B18.spec.ts`
 * - B18: `do_http` over the real Node `http` client against a LOCAL server (127.0.0.1, ephemeral port).
 * - no external network: every call targets the in-process server or a just-closed local port.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 initial (B18 - drop deprecated `request`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { do_http, prepare_json } from './exec-cli';
import { httpRequest } from './tools/http-request';

//* B18: request log seen by the local server.
interface Seen {
    method?: string;
    url?: string;
    headers: http.IncomingHttpHeaders;
    body: string;
}

describe('B18 do_http() over Node http (local server)', () => {
    let server: http.Server;
    let base = '';
    const seen: Seen[] = [];

    //* B18: start a local server on 127.0.0.1 with an ephemeral port.
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                seen.push({ method: req.method, url: req.url, headers: req.headers, body });
                const path = (req.url || '').split('?')[0];
                if (path === '/json') {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ ok: true, url: req.url }));
                }
                if (path === '/echo') {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    return res.end(JSON.stringify({ method: req.method, got: body ? JSON.parse(body) : null }));
                }
                if (path === '/missing') {
                    res.writeHead(404, { 'content-type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'not found' }));
                }
                if (path === '/text') {
                    res.writeHead(500, { 'content-type': 'text/plain' });
                    return res.end('boom');
                }
                if (path === '/redirect') {
                    res.writeHead(302, { location: '/json?from=redirect' });
                    return res.end();
                }
                if (path === '/slow') return setTimeout(() => res.end('late'), 500);
                res.writeHead(204);
                res.end();
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    //* B18: close the local server (drop keep-alive sockets first).
    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    test('GET with JSON response resolves the parsed object (json: true, accept header sent)', async () => {
        const res = await do_http(prepare_json('GET', `${base}/json?sid=lemon&page=1`, null, null));
        expect(res).toEqual({ ok: true, url: '/json?sid=lemon&page=1' });
        const last = seen[seen.length - 1];
        expect(last.method).toEqual('GET');
        expect(last.headers['accept']).toEqual('application/json');
        expect(last.body).toEqual('');
    });

    test('POST with JSON body sends application/json and resolves the parsed reply', async () => {
        const res = await do_http(prepare_json('PUT', `${base}/echo`, null, { map: { a: 1 } }));
        //* prepare_json forces POST when a body is present (trap #7, unchanged).
        expect(res).toEqual({ method: 'POST', got: { map: { a: 1 } } });
        const last = seen[seen.length - 1];
        expect(last.headers['content-type']).toEqual('application/json');
        expect(last.headers['content-length']).toEqual(`${Buffer.byteLength(last.body)}`);
    });

    test('non-2xx does NOT reject - resolves the body (same as `request`)', async () => {
        await expect(do_http(prepare_json('GET', `${base}/missing`, null, null))).resolves.toEqual({
            error: 'not found',
        });
        await expect(do_http({ method: 'GET', uri: `${base}/text` })).resolves.toEqual('boom');
    });

    test('response object carries statusCode/headers (httpRequest callback shape)', async () => {
        const res: any = await new Promise((resolve, reject) =>
            httpRequest({ method: 'GET', uri: `${base}/missing`, json: true }, (e, r) => (e ? reject(e) : resolve(r))),
        );
        expect(res.statusCode).toEqual(404);
        expect(res.headers['content-type']).toEqual('application/json');
        expect(res.body).toEqual({ error: 'not found' });
    });

    test('qs is merged over the uri query; GET follows a 3xx redirect', async () => {
        await expect(do_http({ method: 'GET', uri: `${base}/json?a=1`, json: true, qs: { b: 2 } })).resolves.toEqual({
            ok: true,
            url: '/json?a=1&b=2',
        });
        await expect(do_http(prepare_json('GET', `${base}/redirect`, null, null))).resolves.toEqual({
            ok: true,
            url: '/json?from=redirect',
        });
    });

    test('empty 204 with json resolves undefined; timeout rejects with ETIMEDOUT', async () => {
        await expect(do_http(prepare_json('GET', `${base}/none`, null, null))).resolves.toBeUndefined();
        await expect(do_http({ method: 'GET', uri: `${base}/slow`, timeout: 50 })).rejects.toMatchObject({
            code: 'ETIMEDOUT',
        });
    });

    test('connection error (closed local port) rejects', async () => {
        //* B18: grab a free port, then close it so nothing listens there.
        const tmp = http.createServer();
        await new Promise<void>(resolve => tmp.listen(0, '127.0.0.1', () => resolve()));
        const port = (tmp.address() as AddressInfo).port;
        await new Promise<void>(resolve => tmp.close(() => resolve()));
        await expect(do_http(prepare_json('GET', `http://127.0.0.1:${port}/x`, null, null))).rejects.toMatchObject({
            code: 'ECONNREFUSED',
        });
    });

    test('invalid uri / protocol rejects without any network call', async () => {
        await expect(do_http({ method: 'GET', uri: '/relative-only' })).rejects.toThrow();
        await expect(do_http({ method: 'GET', uri: 'ftp://127.0.0.1/x' })).rejects.toThrow('Invalid protocol');
    });
});
