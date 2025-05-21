/**
 * `environ.ts`
 * - override environ with `env/<profile>.yml`
 * - **NOTE** seperated file from index due to initialization sequence.
 *
 * usage (javascript):
 * ```js
 * const environ = require('lemon-core/dist/environ').default;
 * process.env = environ(process)
 * ```
 *
 * usage (typescript):
 * ```ts
 * import environ from 'lemon-core/dist/environ';
 * const $env = environ(process);
 * process.env = $env;
 * ```
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2025-05-20 optimize for `lemon-core#v4`
 *
 * @copyright (C) lemoncloud.io 2025 - All Rights Reserved.
 */
import fs from 'fs';
import * as yaml from 'js-yaml';
import { fromIni } from '@aws-sdk/credential-providers';
import { EnvironmentSet } from 'lemon-core/dist/environ';

/**
 * type: `CrendentialForAWS`
 * - common interface for AWS credentials.
 * - used for `AWS.config.credentials` or `AWS.Credentials`
 */
export interface CrendentialForAWS {
    /**
     * AWS access key ID
     */
    readonly accessKeyId: string;
    /**
     * AWS secret access key
     */
    readonly secretAccessKey: string;
    /**
     * A security or session token to use with these credentials. Usually
     * present for temporary credentials.
     */
    readonly sessionToken?: string;

    /** (optional) the loaded profile name if applicable */
    readonly profile?: string;
}

/**
 * loader `<profile>.yml`
 *
 * **Determine Environ Target**
 * 1. ENV 로부터, 로딩할 `env.yml` 파일을 지정함.
 * 2. STAGE 로부터, `env.yml`내 로딩할 환경 그룹을 지정함.
 *
 * example:
 * `$ ENV=lemon STAGE=dev nodemon express.js --port 8081`
 *
 * @param process the main process instance.
 * @param options (optional) default option.
 */
export const loadEnviron = (process: any, options?: EnvironmentSet) => {
    options = options || {};
    const { ENV, ENV_PATH } = options;
    const $env = (process && process.env) || {};
    const QUIET = 0 ? 0 : $env['LS'] === '1'; // LOG SILENT - PRINT NO LOG MESSAGE
    const PROFILE = ENV || $env['PROFILE'] || $env['ENV'] || 'none'; // Environment Profile Name.
    const STAGE = options?.STAGE || $env['STAGE'] || $env['NODE_ENV'] || 'local'; // Global STAGE/NODE_ENV For selecting.
    const _log = QUIET ? (...a: any) => {} : console.log;
    const isLocal = STAGE === 'local';
    if (!isLocal) _log(`! PROFILE=${PROFILE} STAGE=${STAGE}`);

    //* initialize environment via 'env.yml'
    return ($det => {
        const file = PROFILE;
        const path = `${ENV_PATH || './env'}/` + file + (file.endsWith('.yml') ? '' : '.yml');
        if (!fs.existsSync(path)) throw new Error('FILE NOT FOUND:' + path);
        if (!isLocal) _log(`! loading yml-file: "${path}"`);
        const $doc: any = yaml.load(fs.readFileSync(path, 'utf8'));
        const $src: any = ($doc && $doc[STAGE]) || {};
        const $new = Object.keys($src).reduce(($O: any, key: string) => {
            const val = $src[key];
            if (typeof val == 'string' && val.startsWith('!')) {
                //* force to update environ.
                $O[key] = val.substring(1);
            } else if (typeof val == 'object' && Array.isArray(val)) {
                //* join array with ', '.
                $O[key] = val.join(', ');
            } else if ($det[key] === undefined) {
                //* override only if undefined.
                $O[key] = `${val}`; // as string.
            } else {
                //* ignore!.
            }
            return $O;
        }, {});
        //* make sure STAGE.
        $new.STAGE = $new.STAGE || STAGE;
        return Object.assign($det, $new);
    })($env);
};

interface Logger {
    (title: string, msg?: string): void;
    (title: string, ...args: any[]): void;
}
/**
 * load AWS credential profile via env.NAME
 *
 * ```sh
 * # load AWS 'lemon' profile, and run test.
 * $ NAME=lemon npm run test
 * ````
 * @param $proc     process (default `global.process`)
 * @param $info     info logger (default `console.info`)
 */
export const loadProfile = async (
    $proc?: { env?: any },
    options?: {
        info?: Logger;
    },
): Promise<CrendentialForAWS> => {
    $proc = $proc === undefined ? process : $proc;
    const $info = options?.info ?? console.info;
    const $env = loadEnviron($proc);
    const PROFILE = `${$env['NAME'] != 'none' ? $env['NAME'] || '' : ''}`;
    if (PROFILE && $info) $info('! PROFILE =', PROFILE);
    return asyncCredentials(PROFILE);
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * !WARN! - could not catch AWS.Error `Profile null not found` via callback.
 *
 * @param profile   profile name of AWS.
 * @deprecated use `asyncCredentials` instead.
 */
export const credentials = (profile: string): string => {
    if (!profile) return '';
    throw new Error('WARN! credentials() is deprecated. use `asyncCredentials()` instead!');
};

/**
 * return whether AWS credentials set
 *
 * @deprecated use `asyncCredentials` instead.
 */
export const hasCredentials = (): boolean => {
    return false;
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * @returns {Promise<any>} - AWS credentials
 */
export const asyncCredentials = async (profile: string): Promise<CrendentialForAWS> => {
    const provider = fromIni({ profile });
    const $res = await provider();
    return { ...$res, profile };
};
