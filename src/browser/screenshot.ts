import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {Page} from 'playwright-core';

const SCREENSHOT_MIME_TYPE = 'image/png';
const SCREENSHOT_TMP_DIR = 'brightdata-cli';
const SCREENSHOT_TMP_PREFIX = 'browser-screenshot-';

type Screenshot_capture_opts = {
    base64?: boolean;
    full_page?: boolean;
    path?: string;
};

type Screenshot_capture_result = {
    base64?: string;
    full_page: boolean;
    mime_type: string;
    path: string;
};

const normalize_screenshot_path = (file_path: string|undefined): string|undefined=>{
    if (file_path === undefined)
        return undefined;
    const normalized = file_path.trim();
    if (!normalized)
        throw new Error('Screenshot path cannot be empty.');
    return path.resolve(normalized);
};

const create_temp_screenshot_path = (): string=>{
    const token = crypto.randomBytes(6).toString('hex');
    return path.join(
        os.tmpdir(),
        SCREENSHOT_TMP_DIR,
        `${SCREENSHOT_TMP_PREFIX}${Date.now()}-${token}.png`
    );
};

const take_screenshot = async(
    page: Page,
    opts: Screenshot_capture_opts = {},
): Promise<Screenshot_capture_result>=>{
    const full_page = opts.full_page === true;
    const output_path = normalize_screenshot_path(opts.path)
        ?? create_temp_screenshot_path();
    const buffer = await page.screenshot({fullPage: full_page});

    fs.mkdirSync(path.dirname(output_path), {recursive: true});
    fs.writeFileSync(output_path, buffer);

    return {
        base64: opts.base64 === true ? buffer.toString('base64') : undefined,
        full_page,
        mime_type: SCREENSHOT_MIME_TYPE,
        path: output_path,
    };
};

export {
    create_temp_screenshot_path,
    normalize_screenshot_path,
    SCREENSHOT_MIME_TYPE,
    take_screenshot,
};
export type {
    Screenshot_capture_opts,
    Screenshot_capture_result,
};
