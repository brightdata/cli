import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    Invalid_mcp_config_error,
    upsert_mcp_config,
    write_claude_code_mcp,
    write_cursor_mcp,
    write_codex_mcp,
} from '../../utils/mcp-config';

const get_expected_entry = (api_key: string)=>({
    command: 'npx',
    args: ['@brightdata/mcp'],
    env: {
        API_TOKEN: api_key,
    },
});

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(),
    'brightdata-mcp-config-'));

describe('utils/mcp-config', ()=>{
    let tmp_dir = '';

    beforeEach(()=>{
        tmp_dir = mk_tmp_dir();
    });

    afterEach(()=>{
        vi.restoreAllMocks();
        delete process.env['CODEX_HOME'];
        if (tmp_dir)
            fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('creates a new config file when none exists', ()=>{
        const file_path = path.join(tmp_dir, 'mcp.json');

        upsert_mcp_config(file_path, 'new_key');

        expect(JSON.parse(fs.readFileSync(file_path, 'utf8'))).toEqual({
            mcpServers: {
                'bright-data': get_expected_entry('new_key'),
            },
        });
        expect(fs.statSync(file_path).mode & 0o777).toBe(0o600);
    });

    it('merges the Bright Data server into an existing config', ()=>{
        const file_path = path.join(tmp_dir, 'mcp.json');

        fs.writeFileSync(file_path, JSON.stringify({
            theme: 'light',
            mcpServers: {
                existing: {
                    command: 'node',
                },
            },
        }, null, 4));

        upsert_mcp_config(file_path, 'merged_key');

        expect(JSON.parse(fs.readFileSync(file_path, 'utf8'))).toEqual({
            theme: 'light',
            mcpServers: {
                existing: {
                    command: 'node',
                },
                'bright-data': get_expected_entry('merged_key'),
            },
        });
    });

    it('overwrites an existing bright-data entry without removing other servers', ()=>{
        const file_path = path.join(tmp_dir, 'mcp.json');

        fs.writeFileSync(file_path, JSON.stringify({
            mcpServers: {
                'bright-data': {
                    command: 'old-command',
                    args: ['old-package'],
                    env: {
                        API_TOKEN: 'old_key',
                        EXTRA: 'value',
                    },
                },
                existing: {
                    command: 'node',
                },
            },
        }, null, 4));

        upsert_mcp_config(file_path, 'fresh_key');

        expect(JSON.parse(fs.readFileSync(file_path, 'utf8'))).toEqual({
            mcpServers: {
                'bright-data': get_expected_entry('fresh_key'),
                existing: {
                    command: 'node',
                },
            },
        });
    });

    it('throws on invalid JSON unless overwrite_invalid is set', ()=>{
        const file_path = path.join(tmp_dir, 'mcp.json');

        fs.writeFileSync(file_path, '{invalid-json');

        expect(()=>upsert_mcp_config(file_path, 'api_key'))
            .toThrow(Invalid_mcp_config_error);

        upsert_mcp_config(file_path, 'api_key', {overwrite_invalid: true});

        expect(JSON.parse(fs.readFileSync(file_path, 'utf8'))).toEqual({
            mcpServers: {
                'bright-data': get_expected_entry('api_key'),
            },
        });
    });

    it('writes Claude Code global config to the home directory', ()=>{
        const home_dir = path.join(tmp_dir, 'home');
        const exists_sync = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        const mkdir_sync = vi.spyOn(fs, 'mkdirSync')
            .mockImplementation(()=>undefined);
        const write_file_sync = vi.spyOn(fs, 'writeFileSync')
            .mockImplementation(()=>undefined);
        const chmod_sync = vi.spyOn(fs, 'chmodSync')
            .mockImplementation(()=>undefined);
        vi.spyOn(os, 'homedir').mockReturnValue(home_dir);

        write_claude_code_mcp('api_key', 'global');

        expect(exists_sync).toHaveBeenCalled();
        expect(mkdir_sync).toHaveBeenCalledWith(home_dir, {recursive: true});
        expect(write_file_sync).toHaveBeenCalledWith(
            path.join(home_dir, '.claude.json'),
            expect.any(String),
            {mode: 0o600}
        );
        expect(chmod_sync).toHaveBeenCalledWith(
            path.join(home_dir, '.claude.json'),
            0o600
        );
    });

    it('writes Claude Code project config under the current directory', ()=>{
        const project_dir = path.join(tmp_dir, 'project');
        const write_file_sync = vi.spyOn(fs, 'writeFileSync')
            .mockImplementation(()=>undefined);
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(()=>undefined);
        vi.spyOn(fs, 'chmodSync').mockImplementation(()=>undefined);
        vi.spyOn(process, 'cwd').mockReturnValue(project_dir);

        write_claude_code_mcp('api_key', 'project');

        expect(write_file_sync).toHaveBeenCalledWith(
            path.join(project_dir, '.claude', 'settings.json'),
            expect.any(String),
            {mode: 0o600}
        );
    });

    it('writes Cursor config to the correct global and project paths', ()=>{
        const home_dir = path.join(tmp_dir, 'home');
        const project_dir = path.join(tmp_dir, 'project');
        const write_file_sync = vi.spyOn(fs, 'writeFileSync')
            .mockImplementation(()=>undefined);
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(()=>undefined);
        vi.spyOn(fs, 'chmodSync').mockImplementation(()=>undefined);
        vi.spyOn(os, 'homedir').mockReturnValue(home_dir);
        vi.spyOn(process, 'cwd').mockReturnValue(project_dir);

        write_cursor_mcp('api_key', 'global');
        write_cursor_mcp('api_key', 'project');

        expect(write_file_sync).toHaveBeenNthCalledWith(
            1,
            path.join(home_dir, '.cursor', 'mcp.json'),
            expect.any(String),
            {mode: 0o600}
        );
        expect(write_file_sync).toHaveBeenNthCalledWith(
            2,
            path.join(project_dir, '.cursor', 'mcp.json'),
            expect.any(String),
            {mode: 0o600}
        );
    });

    it('writes Codex config to CODEX_HOME when it is set', ()=>{
        const codex_home = path.join(tmp_dir, 'codex-home');
        const write_file_sync = vi.spyOn(fs, 'writeFileSync')
            .mockImplementation(()=>undefined);
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockImplementation(()=>undefined);
        vi.spyOn(fs, 'chmodSync').mockImplementation(()=>undefined);
        process.env['CODEX_HOME'] = codex_home;

        write_codex_mcp('api_key');

        expect(write_file_sync).toHaveBeenCalledWith(
            path.join(codex_home, 'mcp.json'),
            expect.any(String),
            {mode: 0o600}
        );
    });
});
