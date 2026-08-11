import os from 'os';
import path from 'path';
import {describe, expect, it} from 'vitest';
import {
    get_screenshot_base_dir,
    resolve_screenshot_path,
} from '../../browser/screenshot';

describe('browser/screenshot', ()=>{
    const daemon_dir = path.join(os.tmpdir(), 'brightdata-cli-test');
    const base_dir = get_screenshot_base_dir(daemon_dir);

    it('resolves relative screenshot paths inside the daemon jail', ()=>{
        expect(resolve_screenshot_path(base_dir, path.join('captures', 'page.png')))
            .toBe(path.join(base_dir, 'captures', 'page.png'));

        const generated = resolve_screenshot_path(base_dir, undefined);
        expect(generated.startsWith(base_dir+path.sep)).toBe(true);
        expect(path.basename(generated)).toMatch(
            /^browser-screenshot-\d+-[0-9a-f]{12}\.png$/
        );
    });

    it('rejects traversal, absolute paths, and null bytes', ()=>{
        expect(()=>resolve_screenshot_path(base_dir, '../escape.png'))
            .toThrow('must stay inside');
        expect(()=>resolve_screenshot_path(
            base_dir,
            path.resolve(daemon_dir, 'absolute.png'),
        )).toThrow('must be relative');
        expect(()=>resolve_screenshot_path(base_dir, 'bad\0name.png'))
            .toThrow('must not contain null bytes');
    });
});
