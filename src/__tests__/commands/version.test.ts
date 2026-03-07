import fs from 'fs';
import os from 'os';
import path from 'path';
import {describe, it, expect, vi, afterEach} from 'vitest';
import packageJson from '../../../package.json';
import {get_version_info, handle_version} from '../../commands/version';

describe('commands/version', ()=>{
    afterEach(()=>{
        vi.restoreAllMocks();
    });

    it('returns expected version info shape', ()=>{
        const info = get_version_info();
        expect(info.name).toBe(packageJson.name);
        expect(info.version).toBe(packageJson.version);
        expect(info.node).toBe(process.version);
        expect(info.platform.length > 0).toBe(true);
        expect(info.arch.length > 0).toBe(true);
    });

    it('prints short version string by default', ()=>{
        const write = vi.spyOn(process.stdout, 'write')
            .mockImplementation(()=>true);
        handle_version({});
        expect(write).toHaveBeenCalledWith(
            `${packageJson.name} v${packageJson.version}\n`
        );
    });

    it('writes json version info to output file', ()=>{
        const stamp = `${Date.now()}-${Math.random()}`;
        const out_file = path.join(os.tmpdir(), `bd-version-${stamp}.json`);
        handle_version({json: true, output: out_file});
        const data = JSON.parse(fs.readFileSync(out_file, 'utf8')) as {
            name: string;
            version: string;
            node: string;
        };
        fs.unlinkSync(out_file);
        expect(data.name).toBe(packageJson.name);
        expect(data.version).toBe(packageJson.version);
        expect(data.node).toBe(process.version);
    });
});
