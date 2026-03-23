import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    checkbox: vi.fn(),
    select: vi.fn(),
    confirm: vi.fn(),
    get_api_key: vi.fn(),
    dim: vi.fn((msg: string)=>msg),
    green: vi.fn((msg: string)=>msg),
    red: vi.fn((msg: string)=>msg),
    warn: vi.fn(),
}));

vi.mock('@inquirer/prompts', ()=>({
    checkbox: mocks.checkbox,
    select: mocks.select,
    confirm: mocks.confirm,
}));

vi.mock('../../utils/credentials', ()=>({
    get_api_key: mocks.get_api_key,
}));

vi.mock('../../utils/output', ()=>({
    dim: mocks.dim,
    green: mocks.green,
    red: mocks.red,
    warn: mocks.warn,
}));

import {run_add_mcp} from '../../commands/add-mcp';

const get_expected_entry = (api_key: string)=>({
    command: 'npx',
    args: ['@brightdata/mcp'],
    env: {
        API_TOKEN: api_key,
    },
});

const mk_tmp_dir = ()=>fs.mkdtempSync(path.join(os.tmpdir(),
    'brightdata-add-mcp-'));

const read_json = (file_path: string)=>JSON.parse(fs.readFileSync(file_path,
    'utf8'));

describe('commands/add-mcp', ()=>{
    let tmp_dir = '';
    let home_dir = '';
    let project_dir = '';
    let codex_home = '';
    let original_cwd = '';
    let stdin_tty: PropertyDescriptor|undefined;
    let stdout_tty: PropertyDescriptor|undefined;

    beforeEach(()=>{
        vi.clearAllMocks();
        tmp_dir = mk_tmp_dir();
        home_dir = path.join(tmp_dir, 'home');
        project_dir = path.join(tmp_dir, 'project');
        codex_home = path.join(tmp_dir, 'codex-home');
        original_cwd = process.cwd();
        stdin_tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
        stdout_tty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

        fs.mkdirSync(home_dir, {recursive: true});
        fs.mkdirSync(project_dir, {recursive: true});
        process.chdir(project_dir);
        process.env['CODEX_HOME'] = codex_home;
        vi.spyOn(os, 'homedir').mockReturnValue(home_dir);
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        });
        Object.defineProperty(process.stdout, 'isTTY', {
            value: true,
            configurable: true,
        });

        mocks.get_api_key.mockReturnValue('test_api_key');
        mocks.checkbox.mockResolvedValue(['claude-code', 'cursor', 'codex']);
        mocks.select.mockResolvedValue('project');
        mocks.confirm.mockResolvedValue(true);
        vi.spyOn(process.stderr, 'write').mockImplementation(()=>true);
    });

    afterEach(()=>{
        process.chdir(original_cwd);
        if (stdin_tty)
            Object.defineProperty(process.stdin, 'isTTY', stdin_tty);
        if (stdout_tty)
            Object.defineProperty(process.stdout, 'isTTY', stdout_tty);
        delete process.env['CODEX_HOME'];
        vi.restoreAllMocks();
        if (tmp_dir)
            fs.rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('writes selected agent configs in the full interactive flow', async()=>{
        await run_add_mcp();

        expect(mocks.checkbox).toHaveBeenCalledOnce();
        expect(mocks.select).toHaveBeenCalledOnce();
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(read_json(path.join(project_dir, '.claude', 'settings.json')))
            .toEqual({
                mcpServers: {
                    'bright-data': get_expected_entry('test_api_key'),
                },
            });
        expect(read_json(path.join(project_dir, '.cursor', 'mcp.json')))
            .toEqual({
                mcpServers: {
                    'bright-data': get_expected_entry('test_api_key'),
                },
            });
        expect(read_json(path.join(codex_home, 'mcp.json')))
            .toEqual({
                mcpServers: {
                    'bright-data': get_expected_entry('test_api_key'),
                },
            });
        expect(fs.existsSync(path.join(home_dir, '.claude.json'))).toBe(false);
        expect(fs.existsSync(path.join(home_dir, '.cursor', 'mcp.json')))
            .toBe(false);
    });

    it('warns and overwrites invalid JSON after confirmation', async()=>{
        const cursor_config = path.join(project_dir, '.cursor', 'mcp.json');

        fs.mkdirSync(path.dirname(cursor_config), {recursive: true});
        fs.writeFileSync(cursor_config, '{invalid-json');
        mocks.checkbox.mockResolvedValue(['cursor']);
        mocks.select.mockResolvedValue('project');
        mocks.confirm.mockResolvedValue(true);

        await run_add_mcp();

        expect(mocks.warn).toHaveBeenCalledWith(
            expect.stringContaining('Invalid JSON in '+cursor_config)
        );
        expect(mocks.confirm).toHaveBeenCalledWith({
            message: 'Overwrite invalid config at '+cursor_config+'?',
            default: false,
        });
        expect(read_json(cursor_config)).toEqual({
            mcpServers: {
                'bright-data': get_expected_entry('test_api_key'),
            },
        });
    });
});
