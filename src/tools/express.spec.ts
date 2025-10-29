/**
 * `tools/express.spec.ts`
 * - test runnder for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 * @date        2025-05-20 optimize for `lemon-core#v4`
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import { buildExpress } from './express';
import request from 'supertest';

/** run `npm i -D lemon-core */
import $cores, { $U, expect2, NextDecoder, NextHandler, loadJsonSync, buildEngine } from 'lemon-core';

/**
 * local test instance
 */
export const instance = async () => {
    // STEP.1 - build engine
    const $engine = buildEngine(global, { env: {} });
    const $pack = loadJsonSync('package.json');

    // STEP.2 - prepare handler.
    const $web = $cores.cores.lambda.web;
    $web.setHandler('test', decode_next_handler);
    $web.setHandler('', decode_next_handler);
    $web.setHandler('_', decode_next_handler);
    $web.setHandler('_tst', decode_next_handler);
    $web.setHandler('_ tst', decode_next_handler);
    const genRequestId = () => 'express-test-request-id';

    // STEP.3 - build express server.
    const $express = buildExpress($engine, $web, { genRequestId });
    return { $express, $engine: { ...$engine }, $web, $pack };
};

//* router of `/test/:id/:cmd?`
const decode_next_handler: NextDecoder = (mode, id, cmd) => {
    let next: NextHandler = null as any;
    // _log(`> decode: mode=${mode} /${id}/${cmd || ''}`)
    switch (mode) {
        case 'LIST':
            next = async () => ({ hello: 'LIST' });
            break;
        case 'GET':
        //TODO - serve binary like `/favicon.ico`
        case 'POST':
            if (false) false;
            else if (id == '0')
                next = async id => {
                    throw new Error(`404 NOT FOUND - id:${id}`);
                };
            else if (id != '!' && cmd == '400')
                next = async id => {
                    throw new Error(`400 INVALID ERROR - id:${id}`);
                };
            else if (id != '!' && cmd == '500')
                next = async id => {
                    throw new Error(`500 SERVER ERROR - id:${id}`);
                };
            else if (id != '!' && cmd == '200')
                next = async (id, param, body, context) => ({ id, param, body, context }); // dump parameter if '!'
            else if (cmd) next = async id => ({ id, cmd, hello: `${cmd} ${id}` });
            else next = async id => ({ id, hello: `${id}` });
            break;
    }
    return next;
};

//! main test body.
describe('express', () => {
    it('should pass express route: GET /', async () => {
        const { $express, $pack } = await instance();
        const app = $express.app;
        const res = await request(app).get('/');
        expect2(() => res.status).toEqual(200);
        expect2(() => res.text.split('\n')[0]).toEqual(`lemon-devkit/${$pack.version}`);
    });

    //* check id + cmd param
    it('should pass express route: GET /test/abc/hi', async () => {
        const { $express } = await instance();
        const $exp = { status: 200, body: { id: 'abc', cmd: 'hi', hello: 'hi abc' } };
        const $app = $express.app;
        const _get = async (type?: string) => await request($app).get(`/${type ?? 'test'}/abc/hi`);
        expect2(await _get(), 'status,body').toEqual({ status: 200, body: { ...$exp.body } });
        expect2(await _get(''), 'status,body').toEqual({ status: 404, body: {} });
        expect2(await _get('_'), 'status,body').toEqual({ status: 200, body: { ...$exp.body } });
        expect2(await _get('_tst'), 'status,body').toEqual({ status: 200, body: { ...$exp.body } });
        expect2(await _get('_ tst'), 'status,body').toEqual({ status: 404, body: {} });
    });

    //* check mode
    it('should pass express routes', async () => {
        const { $express, $pack } = await instance();
        const ACCOUNT_ID = $U.env('USER', 'travis'); // it must be 'travis' in `travis-ci.org`
        const app = $express.app;

        expect2(await request(app).get('/test/abc'), 'status').toEqual({ status: 200 });
        expect2(await request(app).get('/test1/abc'), 'status,body').toEqual({ status: 404, body: {} });
        expect2(await request(app).get('/test/0'), 'status').toEqual({ status: 404 });
        expect2(await request(app).get('/test/0'), 'status,body,text').toEqual({
            status: 404,
            body: {},
            text: '404 NOT FOUND - id:0',
        });
        expect2(await request(app).get('/test/a/400'), 'status,body').toEqual({ status: 400, body: {} });
        expect2(await request(app).get('/test/a/500'), 'status,body').toEqual({ status: 500, body: {} });
        expect2(await request(app).post('/test/a/500'), 'status,body').toEqual({ status: 500, body: {} });
        expect2(await request(app).delete('/test/a'), 'status,body,text').toEqual({
            status: 404,
            body: {},
            text: '404 NOT FOUND - DELETE /test/a',
        });
        //* echo request context.....
        expect2(await request(app).post('/test/a/200').set('Cookie', 'A=1; B=2').send({ b: 3 }), 'status,body').toEqual(
            {
                status: 200,
                body: {
                    id: 'a',
                    param: {},
                    body: { b: 3 },
                    context: {
                        accountId: ACCOUNT_ID,
                        clientIp: '::ffff:127.0.0.1',
                        domain: ACCOUNT_ID == 'travis' ? '127.0.0.1' : '127.0.0.1',
                        identity: {},
                        requestId: 'express-test-request-id',
                        source: `api://${ACCOUNT_ID}@lemon-devkit-dev#${$pack.version}`,
                        userAgent: 'node-superagent/3.8.3',
                        cookie: { A: '1', B: '2' },
                    },
                },
            },
        );
    });
});
