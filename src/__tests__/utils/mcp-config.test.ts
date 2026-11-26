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
        if (process.platform != 'win32')
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
            path.join(project_dir, '.mcp.json'),
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

    describe('Codex config.toml', ()=>{
        const codex_block = (api_key: string)=>[
            '[mcp_servers.bright-data]',
            'command = "npx"',
            'args = ["@brightdata/mcp"]',
            '',
            '[mcp_servers.bright-data.env]',
            'API_TOKEN = "'+api_key+'"',
            '',
        ].join('\n');
        const codex_toml = ()=>path.join(tmp_dir, 'config.toml');
        const read_toml = ()=>fs.readFileSync(codex_toml(), 'utf8');

        beforeEach(()=>{
            process.env['CODEX_HOME'] = tmp_dir;
        });

        it('creates config.toml in CODEX_HOME', ()=>{
            write_codex_mcp('api_key');

            expect(read_toml()).toBe(codex_block('api_key'));
            expect(fs.statSync(codex_toml()).mode & 0o777).toBe(0o600);
        });

        it('defaults to ~/.codex when CODEX_HOME is not set', ()=>{
            delete process.env['CODEX_HOME'];
            vi.spyOn(os, 'homedir').mockReturnValue(tmp_dir);

            write_codex_mcp('api_key');

            expect(fs.readFileSync(path.join(tmp_dir, '.codex',
                'config.toml'), 'utf8')).toBe(codex_block('api_key'));
        });

        it('keeps other config and comments unchanged', ()=>{
            const existing = [
                '# my settings',
                'model = "o3"',
                '',
                '[mcp_servers.other]',
                'command = "other" # inline comment',
            ].join('\n');
            fs.writeFileSync(codex_toml(), existing+'\n');

            write_codex_mcp('api_key');

            expect(read_toml()).toBe(existing+'\n\n'+codex_block('api_key'));
        });

        it('replaces an existing bright-data server and its sub-tables', ()=>{
            fs.writeFileSync(codex_toml(), [
                'model = "o3"',
                '',
                '[mcp_servers."bright-data"]',
                'command = "old"',
                '[mcp_servers.bright-data.env]',
                'API_TOKEN = "old_key"',
                '',
                '[mcp_servers.other]',
                'command = "other"',
                '',
            ].join('\n'));

            write_codex_mcp('new_key');

            expect(read_toml()).toBe([
                'model = "o3"',
                '',
                '[mcp_servers.other]',
                'command = "other"',
                '',
                codex_block('new_key'),
            ].join('\n'));
        });

        it('refuses to edit bright-data defined with dotted keys', ()=>{
            const existing = '[mcp_servers]\nbright-data.command = "npx"\n';
            fs.writeFileSync(codex_toml(), existing);

            expect(()=>write_codex_mcp('api_key')).toThrow(
                'defines bright-data in a form the CLI cannot update');
            expect(()=>write_codex_mcp('api_key')).not.toThrow(
                Invalid_mcp_config_error);
            expect(read_toml()).toBe(existing);
        });
    });
});
