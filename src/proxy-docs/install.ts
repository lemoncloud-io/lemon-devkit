/**
 * `install.ts`
 * - install/update proxy guide into consumer projects.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-05-08 added proxy doc installer.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as fs from 'fs';
import * as path from 'path';

const README_BLOCK_START = '<!-- lemon-devkit:proxy-doc:start -->';
const README_BLOCK_END = '<!-- lemon-devkit:proxy-doc:end -->';

export interface InstallProxyDocsOptions {
    /** consumer project root. Usually npm lifecycle INIT_CWD. */
    projectRoot: string;
    /** package root where docs/proxy-implementation-guide.md exists. */
    packageRoot: string;
    /** overwrite docs/proxy-implementation-guide.md when the packaged source changes. default true */
    overwrite?: boolean;
}

export interface InstallProxyDocsResult {
    copied: boolean;
    readmeUpdated: boolean;
    proxyDocPath: string;
    readmePath: string;
}

const readText = (file: string): string => fs.readFileSync(file, 'utf8');

const writeTextIfChanged = (file: string, next: string): boolean => {
    const prev = fs.existsSync(file) ? readText(file) : '';
    if (prev === next) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, 'utf8');
    return true;
};

export const proxyReadmeBlock = (docRelPath = 'docs/proxy-implementation-guide.md'): string =>
    [
        README_BLOCK_START,
        '## Proxy',
        '',
        '`lemon-devkit@0.0.12`부터 install/upgrade 시 consumer project의 `docs/proxy-implementation-guide.md`와 `README.md`에 proxy 구현 가이드를 자동 반영한다.',
        `Proxy 기능을 추가하거나 변경할 때는 [lemon-devkit proxy implementation guide](${docRelPath})를 먼저 확인한다.`,
        '`BackendProxy`, `ManagerProxy`, `guardProxy()` 계열 동작과 프로젝트 적용 절차는 이 문서 기준으로 맞춘다.',
        README_BLOCK_END,
    ].join('\n');

export const upsertProxyReadmeBlock = (readme: string, docRelPath = 'docs/proxy-implementation-guide.md'): string => {
    const block = proxyReadmeBlock(docRelPath);
    const pattern = new RegExp(`${README_BLOCK_START}[\\s\\S]*?${README_BLOCK_END}`);
    if (pattern.test(readme)) return readme.replace(pattern, block);
    const trimmed = readme.trimEnd();
    return `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`;
};

export const installProxyDocs = (options: InstallProxyDocsOptions): InstallProxyDocsResult => {
    const projectRoot = path.resolve(options.projectRoot);
    const packageRoot = path.resolve(options.packageRoot);
    const sourceDocPath = path.join(packageRoot, 'docs/proxy-implementation-guide.md');
    const proxyDocPath = path.join(projectRoot, 'docs/proxy-implementation-guide.md');
    const readmePath = path.join(projectRoot, 'README.md');
    const overwrite = options.overwrite !== false;

    if (!fs.existsSync(sourceDocPath)) throw new Error(`proxy doc not found: ${sourceDocPath}`);

    const sourceDoc = readText(sourceDocPath);
    const copied = overwrite || !fs.existsSync(proxyDocPath) ? writeTextIfChanged(proxyDocPath, sourceDoc) : false;

    const prevReadme = fs.existsSync(readmePath) ? readText(readmePath) : `# ${path.basename(projectRoot)}\n`;
    const nextReadme = upsertProxyReadmeBlock(prevReadme);
    const readmeUpdated = writeTextIfChanged(readmePath, nextReadme);

    return { copied, readmeUpdated, proxyDocPath, readmePath };
};
