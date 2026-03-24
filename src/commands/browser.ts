import fs from 'fs';
import {Command} from 'commander';
import {DEFAULT_DAEMON_IDLE_TIMEOUT_MS} from '../browser/daemon';
import {
    DEFAULT_SESSION_NAME,
    get_daemon_base_dir,
    normalize_session_name,
} from '../browser/ipc';
import {
    ensure_daemon,
    is_daemon_alive,
    send_command as send_daemon_command,
} from '../browser/lifecycle';
import {ensure_authenticated} from '../utils/auth';
import {
    DEFAULT_BROWSER_ZONE,
    ensure_browser_zone,
    get_cdp_endpoint,
} from '../utils/browser-credentials';
import {print, success, info, fail} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';
import type {Print_opts} from '../utils/output';

type Browser_cli_opts = {
    all?: boolean;
    apiKey?: string;
    country?: string;
    daemonDir?: string;
    idleTimeout?: string;
    json?: boolean;
    output?: string;
    pretty?: boolean;
    session?: string;
    timeout?: string;
    zone?: string;
};

type Browser_navigation_result = {
    status?: number|null;
    title?: string|null;
    url?: string|null;
};

type Browser_daemon_status = {
    connected?: boolean;
    current_title?: string|null;
    current_url?: string|null;
    idle_timeout_ms?: number;
    listener?: unknown;
    session_name?: string;
    tracked_requests?: number;
};

type Browser_daemon_network = {
    requests?: Array<Record<string, unknown>>;
};

const create_request_id = (action: string)=>
    `browser-${action}-${Date.now()}`;

const parse_timeout_ms = (
    raw: string|undefined,
    label: string,
): number|undefined=>{
    const normalized = raw?.trim();
    if (!normalized)
        return undefined;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0)
    {
        fail(`${label} must be a non-negative number of milliseconds.`);
        return undefined;
    }
    return Math.floor(parsed);
};

const get_session_name = (session: string|undefined): string=>{
    return normalize_session_name(session ?? DEFAULT_SESSION_NAME);
};

const get_browser_zone = (zone: string|undefined): string=>{
    const resolved = zone?.trim()
        || process.env['BRIGHTDATA_BROWSER_ZONE']?.trim()
        || DEFAULT_BROWSER_ZONE;
    if (!resolved)
    {
        fail('Browser zone cannot be empty.');
        return DEFAULT_BROWSER_ZONE;
    }
    return resolved;
};

const get_print_opts = (opts: Browser_cli_opts): Print_opts=>({
    json: opts.json,
    output: opts.output,
    pretty: opts.pretty,
});

const get_ipc_opts = (opts: Browser_cli_opts)=>({
    daemon_dir: opts.daemonDir,
    timeout_ms: parse_timeout_ms(opts.timeout, 'Browser timeout'),
});

const send_browser_action = async(
    session_name: string,
    action: string,
    opts: Browser_cli_opts,
    params?: Record<string, unknown>,
): Promise<unknown>=>{
    const response = await send_daemon_command(session_name, {
        id: create_request_id(action),
        action,
        params,
    }, get_ipc_opts(opts));
    if (!response.success)
        fail(response.error ?? `Browser command "${action}" failed.`);
    return response.data;
};

const ensure_active_session = async(
    session_name: string,
    opts: Browser_cli_opts,
): Promise<void>=>{
    const active = await is_daemon_alive(session_name, get_ipc_opts(opts));
    if (active)
        return;
    fail(
        `No active browser session "${session_name}". `
        +`Use 'brightdata browser open <url>' first.`
    );
};

const get_browser_session_names = (opts: Browser_cli_opts = {}): string[]=>{
    const base_dir = get_daemon_base_dir({daemon_dir: opts.daemonDir});
    if (!fs.existsSync(base_dir))
        return [];

    const sessions = new Set<string>();
    for (const entry of fs.readdirSync(base_dir))
    {
        const match = entry.match(/^(.+)\.(pid|sock|port)$/);
        if (match)
            sessions.add(match[1]);
    }
    return Array.from(sessions).sort();
};

const list_browser_sessions = async(
    opts: Browser_cli_opts = {},
): Promise<Browser_daemon_status[]>=>{
    const sessions = get_browser_session_names(opts);
    const active_sessions: Browser_daemon_status[] = [];

    for (const session_name of sessions)
    {
        if (!await is_daemon_alive(session_name, get_ipc_opts(opts)))
            continue;
        const response = await send_daemon_command(session_name, {
            id: create_request_id('status'),
            action: 'status',
        }, get_ipc_opts(opts));
        if (response.success)
            active_sessions.push(response.data as Browser_daemon_status);
    }

    return active_sessions;
};

const handle_browser_open = async(url: string, opts: Browser_cli_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const session_name = get_session_name(opts.session);
    const zone = get_browser_zone(opts.zone);
    const idle_timeout_ms = parse_timeout_ms(
        opts.idleTimeout,
        'Browser idle timeout',
    );
    const spinner = start_spinner(`Opening browser session "${session_name}"...`);

    try {
        await ensure_browser_zone(api_key, zone);
        const cdp_endpoint = await get_cdp_endpoint(api_key, zone, opts.country);
        await ensure_daemon(session_name, {
            cdp_endpoint,
            daemon_dir: opts.daemonDir,
            idle_timeout_ms,
        });
        const data = await send_browser_action(session_name, 'navigate', opts, {url}) as Browser_navigation_result;
        spinner.stop();

        if (opts.json || opts.pretty || opts.output)
        {
            print(data, get_print_opts(opts));
            return;
        }

        success(`Navigated to ${url}`);
        info(`Title: ${data.title ?? 'Unknown'}`);
        info(`URL: ${data.url ?? url}`);
    } catch(error) {
        spinner.stop();
        fail((error as Error).message);
    }
};

const handle_browser_status = async(opts: Browser_cli_opts)=>{
    const session_name = get_session_name(opts.session);
    await ensure_active_session(session_name, opts);
    const data = await send_browser_action(session_name, 'status', opts) as Browser_daemon_status;
    print(data, get_print_opts(opts));
};

const handle_browser_network = async(opts: Browser_cli_opts)=>{
    const session_name = get_session_name(opts.session);
    await ensure_active_session(session_name, opts);
    const data = await send_browser_action(session_name, 'network', opts) as Browser_daemon_network;
    print(data.requests ?? [], get_print_opts(opts));
};

const handle_browser_sessions = async(opts: Browser_cli_opts = {})=>{
    const sessions = await list_browser_sessions(opts);
    print(sessions, get_print_opts(opts));
};

const handle_browser_close = async(opts: Browser_cli_opts = {})=>{
    if (opts.all)
    {
        const sessions = get_browser_session_names(opts);
        let closed_sessions = 0;
        for (const session_name of sessions)
        {
            if (!await is_daemon_alive(session_name, get_ipc_opts(opts)))
                continue;
            await send_browser_action(session_name, 'close', opts);
            closed_sessions++;
        }

        if (opts.json || opts.pretty || opts.output)
        {
            print({closed_sessions}, get_print_opts(opts));
            return;
        }

        if (!closed_sessions)
        {
            info('No active browser sessions.');
            return;
        }
        success(`Closed ${closed_sessions} browser session${closed_sessions == 1 ? '' : 's'}.`);
        return;
    }

    const session_name = get_session_name(opts.session);
    if (!await is_daemon_alive(session_name, get_ipc_opts(opts)))
    {
        if (opts.json || opts.pretty || opts.output)
        {
            print({closed: false, session_name}, get_print_opts(opts));
            return;
        }
        info(`No active browser session "${session_name}".`);
        return;
    }

    const data = await send_browser_action(session_name, 'close', opts) as {closed?: boolean};
    if (opts.json || opts.pretty || opts.output)
    {
        print({session_name, ...data}, get_print_opts(opts));
        return;
    }
    success(`Closed browser session "${session_name}".`);
};

const add_output_options = (command: Command)=>{
    return command
        .option('--json', 'Force JSON output')
        .option('--pretty', 'Pretty-print JSON output')
        .option('-o, --output <path>', 'Write output to file');
};

const add_session_options = (command: Command)=>{
    return add_output_options(command)
        .option('--session <name>', 'Browser session name', DEFAULT_SESSION_NAME)
        .option('--timeout <ms>', 'IPC timeout in milliseconds');
};

const browser_open_command = add_session_options(
    new Command('open')
        .description('Navigate to a URL in the Bright Data browser')
        .argument('<url>', 'URL to navigate to')
        .option('--country <code>', 'ISO country code for geo-targeting (e.g. us, de)')
        .option('--zone <name>', `Browser zone name (default: ${DEFAULT_BROWSER_ZONE})`)
        .option(
            '--idle-timeout <ms>',
            `Daemon idle timeout in milliseconds (default: ${DEFAULT_DAEMON_IDLE_TIMEOUT_MS})`,
        )
        .option('-k, --api-key <key>', 'Override API key')
        .action(handle_browser_open)
);

const browser_status_command = add_session_options(
    new Command('status')
        .description('Show the current state of a browser session')
        .action(handle_browser_status)
);

const browser_network_command = add_session_options(
    new Command('network')
        .description('Show tracked network requests for a browser session')
        .action(handle_browser_network)
);

const browser_close_command = add_session_options(
    new Command('close')
        .description('Close one or all active browser sessions')
        .option('--all', 'Close all active browser sessions')
        .action(handle_browser_close)
);

const browser_sessions_command = add_output_options(
    new Command('sessions')
        .description('List active browser daemon sessions')
        .option('--timeout <ms>', 'IPC timeout in milliseconds')
        .action(handle_browser_sessions)
);

const browser_command = new Command('browser')
    .description('Control Bright Data browser sessions')
    .addCommand(browser_open_command)
    .addCommand(browser_status_command)
    .addCommand(browser_network_command)
    .addCommand(browser_close_command)
    .addCommand(browser_sessions_command);

export {
    browser_command,
    get_browser_session_names,
    handle_browser_close,
    handle_browser_network,
    handle_browser_open,
    handle_browser_sessions,
    handle_browser_status,
    list_browser_sessions,
};
