/**
 * `install.spec.ts`
 * - consumer project proxy document installer tests.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-05-08 added proxy doc installer tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { installProxyDocs } from './install';

const makeTmpProject = (files: Record<string, string>): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-proxy-docs-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return root;
};

describe('proxy docs installer', () => {
    it('should copy proxy implementation guide and append README guidance', () => {
        const projectRoot = makeTmpProject({ 'README.md': '# consumer\n' });
        const packageRoot = path.resolve(__dirname, '../..');

        const res = installProxyDocs({ projectRoot, packageRoot });
        const doc = fs.readFileSync(path.join(projectRoot, 'docs/proxy-implementation-guide.md'), 'utf8');
        const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

        expect(res.copied).toBe(true);
        expect(res.readmeUpdated).toBe(true);
        expect(doc).toContain('BackendService / BackendProxy 구현 가이드');
        expect(readme).toContain('<!-- lemon-devkit:proxy-doc:start -->');
        expect(readme).toContain(
            'install/upgrade 시 consumer project의 `docs/proxy-implementation-guide.md`와 `README.md`',
        );
        expect(readme).toContain('[lemon-devkit proxy implementation guide](docs/proxy-implementation-guide.md)');
        expect(readme).toContain('Proxy 기능을 추가하거나 변경할 때');
    });

    it('should be idempotent after first install', () => {
        const projectRoot = makeTmpProject({ 'README.md': '# consumer\n' });
        const packageRoot = path.resolve(__dirname, '../..');

        installProxyDocs({ projectRoot, packageRoot });
        const res = installProxyDocs({ projectRoot, packageRoot });
        const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

        expect(res.copied).toBe(false);
        expect(res.readmeUpdated).toBe(false);
        expect(readme.match(/lemon-devkit:proxy-doc:start/g)?.length).toBe(1);
    });
});
