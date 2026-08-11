import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    create_daemon_token,
    is_daemon_token_valid,
    read_daemon_token,
    write_daemon_token,
} from '../../browser/token';

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(), 'bdata-token-'));

describe('browser/token', ()=>{
    let tmp_dir = '';

    beforeEach(()=>{
        tmp_dir = mk_tmp_dir();
    });

    afterEach(()=>{
        vi.restoreAllMocks();
        fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('creates and validates 256-bit hexadecimal tokens', ()=>{
        const token = create_daemon_token();
        const invalid_token = (token[0] == '0' ? '1' : '0')+token.slice(1);

        expect(token).toMatch(/^[0-9a-f]{64}$/);
        expect(is_daemon_token_valid(token, token)).toBe(true);
        expect(is_daemon_token_valid(token, invalid_token)).toBe(false);
        expect(is_daemon_token_valid(token, 'short')).toBe(false);
        expect(is_daemon_token_valid(token, undefined)).toBe(false);
    });

    it('writes tokens with strict permissions and reads them back', ()=>{
        const token_path = path.join(tmp_dir, 'session.token');
        fs.writeFileSync(token_path, 'old-token');
        fs.chmodSync(token_path, 0o666);
        const write_file = vi.spyOn(fs, 'writeFileSync');
        const chmod_file = vi.spyOn(fs, 'chmodSync');

        const token = create_daemon_token();
        write_daemon_token(token_path, token);

        expect(read_daemon_token(token_path)).toBe(token);
        expect(write_file).toHaveBeenCalledWith(
            token_path,
            token,
            {encoding: 'utf8', mode: 0o600}
        );
        expect(chmod_file).toHaveBeenCalledWith(token_path, 0o600);
        if (process.platform != 'win32')
            expect(fs.statSync(token_path).mode & 0o777).toBe(0o600);
        expect(read_daemon_token(path.join(tmp_dir, 'missing.token')))
            .toBeUndefined();
    });
});
