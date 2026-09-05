/**
 * `package.spec.ts`
 * - npm publish 산출물에 field 문서가 포함되는지 확인한다.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-04-17 added package file-list tests.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

interface PackFile {
    path: string;
}

interface PackInfo {
    files: PackFile[];
}

const repoRoot = path.resolve(__dirname, '../..');

//! main test body.
describe('npm package files', () => {
    //* publish file list
    it('should pass npm pack file list with field docs', () => {
        const raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), 'lemon-devkit-npm-cache') },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const [pack] = JSON.parse(raw) as PackInfo[];
        const files = pack.files.map(f => f.path);

        expect(files).toContain('src/fields/README.md');
        expect(files).not.toContain('docs/proxy-implementation-guide.md');
    });
});
