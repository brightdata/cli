import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {Page} from 'playwright-core';

const SCREENSHOT_DIR_NAME = 'screenshots';
const SCREENSHOT_MIME_TYPE = 'image/png';
const SCREENSHOT_PREFIX = 'browser-screenshot-';

type Screenshot_capture_opts = {
    base_dir: string;
    base64?: boolean;
    full_page?: boolean;
    path?: string;
};

type Screenshot_capture_result = {
    base64?: string;
    full_page: boolean;
    mime_type: string;
    path?: string;
};

const get_screenshot_base_dir = (daemon_base_dir: string): string=>
    path.resolve(daemon_base_dir, SCREENSHOT_DIR_NAME);

const create_screenshot_name = (): string=>{
    const token = crypto.randomBytes(6).toString('hex');
    return `${SCREENSHOT_PREFIX}${Date.now()}-${token}.png`;
};

const resolve_screenshot_path = (
    base_dir: string,
    file_path: string|undefined,
): string=>{
    const jail = path.resolve(base_dir);
    if (file_path === undefined)
        return path.join(jail, create_screenshot_name());

    const normalized = file_path.trim();
    if (!normalized)
        throw new Error('Screenshot path cannot be empty.');
    if (normalized.includes('\0'))
        throw new Error('Screenshot path must not contain null bytes.');
    if (path.isAbsolute(normalized))
    {
        throw new Error(
            'Screenshot path must be relative to the daemon screenshot '
            +'directory.'
        );
    }

    const resolved = path.resolve(jail, normalized);
    if (!resolved.startsWith(jail+path.sep))
    {
        throw new Error(
            'Screenshot path must stay inside the daemon screenshot directory.'
        );
    }
    return resolved;
};

const take_screenshot = async(
    page: Page,
    opts: Screenshot_capture_opts,
): Promise<Screenshot_capture_result>=>{
    const full_page = opts.full_page === true;
    const should_save = opts.path !== undefined || opts.base64 !== true;
    const output_path = should_save
        ? resolve_screenshot_path(opts.base_dir, opts.path)
        : undefined;
    const buffer = await page.screenshot({fullPage: full_page});

    if (output_path)
    {
        fs.mkdirSync(path.dirname(output_path), {recursive: true, mode: 0o700});
        fs.writeFileSync(output_path, buffer);
    }

    return {
        base64: opts.base64 === true ? buffer.toString('base64') : undefined,
        full_page,
        mime_type: SCREENSHOT_MIME_TYPE,
        path: output_path,
    };
};

export {
    create_screenshot_name,
    get_screenshot_base_dir,
    resolve_screenshot_path,
    SCREENSHOT_MIME_TYPE,
    take_screenshot,
};
export type {
    Screenshot_capture_opts,
    Screenshot_capture_result,
};
