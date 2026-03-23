import {checkbox, confirm, select} from '@inquirer/prompts';
import {Command} from 'commander';
import {get_api_key} from '../utils/credentials';
import {dim, green, red, warn} from '../utils/output';
import {
    Invalid_mcp_config_error,
    write_claude_code_mcp,
    write_cursor_mcp,
    write_codex_mcp,
} from '../utils/mcp-config';
import type {Mcp_scope, Mcp_write_opts} from '../utils/mcp-config';

type Mcp_agent = 'claude-code'|'cursor'|'codex';
type Add_mcp_opts = {
    agent?: string;
    global?: boolean;
    project?: boolean;
};

type Mcp_writers = {
    write_claude_code_mcp: (
        api_key: string,
        scope: Mcp_scope,
        opts?: Mcp_write_opts
    )=>void|Promise<void>;
    write_cursor_mcp: (
        api_key: string,
        scope: Mcp_scope,
        opts?: Mcp_write_opts
    )=>void|Promise<void>;
    write_codex_mcp: (api_key: string, opts?: Mcp_write_opts)=>
        void|Promise<void>;
};

type Mcp_failure = {
    agent: Mcp_agent;
    reason: string;
};

type Scope_resolution = Mcp_scope|'prompt'|'error';

const backtick = String.fromCharCode(96);

const mcp_agent_labels: Record<Mcp_agent, string> = {
    'claude-code': 'Claude Code',
    cursor: 'Cursor',
    codex: 'Codex',
};

const mcp_agents: Mcp_agent[] = ['claude-code', 'cursor', 'codex'];

const default_writers: Mcp_writers = {
    write_claude_code_mcp,
    write_cursor_mcp,
    write_codex_mcp,
};

const format_error = (error: unknown): string=>{
    if (error instanceof Error)
        return error.message;
    return 'Unknown error';
};

const format_agent_list = ()=>mcp_agents.join(', ');

const is_tty = ()=>
    process.stdin.isTTY !== false && process.stdout.isTTY !== false;

const parse_selected_agents = (agent_flag: string): Mcp_agent[]|null=>{
    const selected = Array.from(new Set(agent_flag.split(',')
        .map(agent=>agent.trim().toLowerCase())
        .filter(Boolean)));

    if (!selected.length)
    {
        process.stderr.write(
            'No agents provided. Use --agent '
            +format_agent_list()+'\n'
        );
        process.exitCode = 1;
        return null;
    }

    const invalid = selected.filter(agent=>
        !mcp_agents.includes(agent as Mcp_agent));
    if (invalid.length)
    {
        process.stderr.write(
            'Unknown agent '+invalid[0]+'. Supported agents: '
            +format_agent_list()+'\n'
        );
        process.exitCode = 1;
        return null;
    }

    return selected as Mcp_agent[];
};

const resolve_selected_agents = async(
    opts: Add_mcp_opts
): Promise<Mcp_agent[]|null>=>{
    if (opts.agent)
        return parse_selected_agents(opts.agent);

    if (!is_tty())
    {
        process.stderr.write(
            'Non-interactive MCP installation requires --agent <agents>.\n'
        );
        process.exitCode = 1;
        return null;
    }

    return await checkbox({
        message: 'Which coding agents should Bright Data MCP be added to?',
        choices: mcp_agents.map(agent=>({
            name: mcp_agent_labels[agent],
            value: agent,
        })),
        validate: value=>{
            if (value.length)
                return true;
            return 'Select at least one coding agent';
        },
    }) as Mcp_agent[];
};

const resolve_scope_from_flags = (
    selected_agents: Mcp_agent[],
    opts: Add_mcp_opts
): Scope_resolution=>{
    if (opts.global && opts.project)
    {
        process.stderr.write('Choose either --global or --project, not both.\n');
        process.exitCode = 1;
        return 'error';
    }

    if (selected_agents.every(agent=>agent == 'codex'))
    {
        if (opts.project)
        {
            process.stderr.write(
                'Codex only supports global MCP installation.\n'
            );
            process.exitCode = 1;
            return 'error';
        }
        return 'global';
    }

    if (opts.global)
        return 'global';
    if (opts.project)
        return 'project';
    return 'prompt';
};

const resolve_scope = async(
    selected_agents: Mcp_agent[],
    opts: Add_mcp_opts
): Promise<Mcp_scope|null>=>{
    const scope_from_flags = resolve_scope_from_flags(selected_agents, opts);
    if (scope_from_flags == 'global' || scope_from_flags == 'project')
        return scope_from_flags;
    if (scope_from_flags == 'error')
        return null;

    if (!is_tty())
    {
        process.stderr.write(
            'Non-interactive MCP installation requires --global or --project '
            +'when targeting Claude Code or Cursor.\n'
        );
        process.exitCode = 1;
        return null;
    }

    return await select({
        message: 'Install globally or for this project?',
        choices: [
            {
                name: 'Global',
                value: 'global',
            },
            {
                name: 'Project',
                value: 'project',
            },
        ],
        default: 'global',
    }) as Mcp_scope;
};

const write_agent_mcp = async(
    agent: Mcp_agent,
    api_key: string,
    scope: Mcp_scope,
    writers: Mcp_writers,
    opts: Mcp_write_opts = {}
)=>{
    if (agent == 'claude-code')
        return writers.write_claude_code_mcp(api_key, scope, opts);
    if (agent == 'cursor')
        return writers.write_cursor_mcp(api_key, scope, opts);
    return writers.write_codex_mcp(api_key, opts);
};

const write_agent_with_recovery = async(
    agent: Mcp_agent,
    api_key: string,
    scope: Mcp_scope,
    writers: Mcp_writers
)=>{
    try {
        await write_agent_mcp(agent, api_key, scope, writers);
        return;
    } catch(error) {
        if (!(error instanceof Invalid_mcp_config_error))
            throw error;

        warn(error.message);
        if (!is_tty())
        {
            throw new Error(
                'Fix the invalid JSON manually or rerun with a TTY to '
                +'overwrite it.'
            );
        }

        const overwrite = await confirm({
            message: 'Overwrite invalid config at '+error.file_path+'?',
            default: false,
        });
        if (!overwrite)
        {
            throw new Error(
                'Aborted because '+error.file_path+' contains invalid JSON'
            );
        }

        await write_agent_mcp(agent, api_key, scope, writers,
            {overwrite_invalid: true});
    }
};

const print_summary = (
    selected_agents: Mcp_agent[],
    success_count: number,
    failures: Mcp_failure[]
)=>{
    process.stderr.write('\n');
    process.stderr.write(
        dim('Summary: '+selected_agents.length+' target'
            +(selected_agents.length == 1 ? '' : 's')+', '+success_count
            +' succeeded, '+failures.length+' failed.\n')
    );
    for (const failure of failures)
    {
        process.stderr.write(
            red('✗ '+mcp_agent_labels[failure.agent]+': '+failure.reason+'\n')
        );
    }
};

const run_add_mcp = async(
    opts: Add_mcp_opts = {},
    writers: Mcp_writers = default_writers
)=>{
    const api_key = get_api_key();
    if (api_key == null)
    {
        process.stderr.write('Not logged in. Run '+backtick
            +'brightdata login'+backtick+' first.\n');
        process.exitCode = 1;
        return;
    }

    const selected_agents = await resolve_selected_agents(opts);
    if (selected_agents == null)
        return;

    const scope = await resolve_scope(selected_agents, opts);
    if (scope == null)
        return;

    const failures: Mcp_failure[] = [];
    let success_count = 0;

    for (const agent of selected_agents)
    {
        try {
            await write_agent_with_recovery(agent, api_key, scope, writers);
            success_count++;
            process.stderr.write(
                green('✓ Added Bright Data MCP to '
                    +mcp_agent_labels[agent]+'\n')
            );
        } catch(error) {
            const reason = format_error(error);
            failures.push({agent, reason});
            process.stderr.write(
                red('✗ Failed '+mcp_agent_labels[agent]+': '+reason+'\n')
            );
            process.exitCode = 1;
        }
    }

    print_summary(selected_agents, success_count, failures);
};

const add_mcp_command = new Command('mcp')
    .description('Add Bright Data MCP to Claude Code, Cursor, or Codex')
    .option('--agent <agents>',
        'Comma-separated: claude-code,cursor,codex')
    .option('--global', 'Install to global config')
    .option('--project', 'Install to project config')
    .action(async(opts: Add_mcp_opts)=>{
        await run_add_mcp(opts);
    });

export {add_mcp_command, run_add_mcp};
export type {Add_mcp_opts, Mcp_agent, Mcp_writers};
