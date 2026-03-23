import fs from 'fs';
import os from 'os';
import path from 'path';

type Mcp_scope = 'global'|'project';
type Mcp_write_opts = {
    overwrite_invalid?: boolean;
};
type Json_object = Record<string, unknown>;

class Invalid_mcp_config_error extends Error {
    file_path: string;

    constructor(file_path: string, reason: string)
    {
        super('Invalid JSON in '+file_path+': '+reason);
        this.name = 'Invalid_mcp_config_error';
        this.file_path = file_path;
    }
}

const is_plain_object = (value: unknown): value is Json_object=>
    typeof value == 'object' && value !== null && !Array.isArray(value);

const get_bright_data_mcp = (api_key: string)=>({
    command: 'npx',
    args: ['@brightdata/mcp'],
    env: {
        API_TOKEN: api_key,
    },
});

const load_json_object = (
    file_path: string,
    opts: Mcp_write_opts = {}
): Json_object=>{
    if (!fs.existsSync(file_path))
        return {};

    const raw = fs.readFileSync(file_path, 'utf8').trim();
    if (!raw)
        return {};

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!is_plain_object(parsed))
            throw new Error('Expected top-level JSON object');
        return parsed;
    } catch(error) {
        if (opts.overwrite_invalid)
            return {};
        const reason = error instanceof Error ? error.message : 'Unknown error';
        throw new Invalid_mcp_config_error(file_path, reason);
    }
};

const upsert_mcp_config = (
    file_path: string,
    api_key: string,
    opts: Mcp_write_opts = {}
)=>{
    const current = load_json_object(file_path, opts);
    const mcp_servers = is_plain_object(current['mcpServers'])
        ? current['mcpServers'] as Json_object
        : {};
    const next = {
        ...current,
        mcpServers: {
            ...mcp_servers,
            'bright-data': get_bright_data_mcp(api_key),
        },
    };
    const dir = path.dirname(file_path);

    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, {recursive: true});

    fs.writeFileSync(file_path, JSON.stringify(next, null, 4)+'\n', {
        mode: 0o600,
    });
    fs.chmodSync(file_path, 0o600);
};

const write_claude_code_mcp = (
    api_key: string,
    scope: Mcp_scope,
    opts: Mcp_write_opts = {}
)=>{
    const file_path = scope == 'project'
        ? path.join(process.cwd(), '.claude', 'settings.json')
        : path.join(os.homedir(), '.claude.json');
    upsert_mcp_config(file_path, api_key, opts);
};

const write_cursor_mcp = (
    api_key: string,
    scope: Mcp_scope,
    opts: Mcp_write_opts = {}
)=>{
    const file_path = scope == 'project'
        ? path.join(process.cwd(), '.cursor', 'mcp.json')
        : path.join(os.homedir(), '.cursor', 'mcp.json');
    upsert_mcp_config(file_path, api_key, opts);
};

const write_codex_mcp = (
    api_key: string,
    opts: Mcp_write_opts = {}
)=>{
    const codex_home = process.env['CODEX_HOME']?.trim()
        || path.join(os.homedir(), '.codex');
    upsert_mcp_config(path.join(codex_home, 'mcp.json'), api_key, opts);
};

export {
    Invalid_mcp_config_error,
    upsert_mcp_config,
    write_claude_code_mcp,
    write_cursor_mcp,
    write_codex_mcp,
};
export type {Mcp_scope, Mcp_write_opts};
