#!/usr/bin/env node
/**
 * `lemon-devkit-postinstall.ts`
 * - npm postinstall hook for consumer project proxy docs.
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2026-05-08 added consumer proxy docs install hook.
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import * as path from 'path';

import { installProxyDocs } from '../proxy-docs/install';

export const main = (): number => {
    const projectRoot = process.env.INIT_CWD || '';
    const packageRoot = path.resolve(__dirname, '../..');

    if (!projectRoot) return 0;
    if (path.resolve(projectRoot) === packageRoot) return 0;

    try {
        const res = installProxyDocs({ projectRoot, packageRoot });
        if (res.copied || res.readmeUpdated) {
            process.stdout.write(
                '[lemon-devkit] installed proxy implementation guide: docs/proxy-implementation-guide.md\n',
            );
        }
        return 0;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[lemon-devkit] WARN: failed to install proxy guide: ${msg}\n`);
        return 0;
    }
};

if (require.main === module) process.exit(main());
