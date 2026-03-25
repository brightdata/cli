import fs from 'fs';
import {Command} from 'commander';
import {DEFAULT_DAEMON_IDLE_TIMEOUT_MS} from '../browser/daemon';
import {
    DEFAULT_IPC_TIMEOUT_MS,
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
    compact?: boolean;
    country?: string;
    daemonDir?: string;
    depth?: string;
    headed?: boolean;
    idleTimeout?: string;
    interactive?: boolean;
    json?: boolean;
    output?: string;
    pretty?: boolean;
    selector?: string;
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

type Browser_daemon_cookies = {
    cookies?: Array<Record<string, unknown>>;
};

type Browser_daemon_snapshot = {
    compact?: boolean;
    depth?: number;
    interactive?: boolean;
    ref_count?: number;
    selector?: string;
    snapshot?: string;
    title?: string|null;
    url?: string|null;
};

type Browser_flag_definition = {
    key: keyof Browser_cli_opts;
    label: string;
    message: string;
};

const OPEN_ONLY_FLAGS: Browser_flag_definition[] = [
    {
        key: 'country',
        label: '--country',
        message: 'Use it with "brightdata browser open" when starting a session.',
    },
    {
        key: 'zone',
        label: '--zone',
        message: 'Use it with "brightdata browser open" when starting a session.',
    },
    {
        key: 'idleTimeout',
        label: '--idle-timeout',
        message: 'Use it with "brightdata browser open" when starting a session.',
    },
];

const SNAPSHOT_ONLY_FLAGS: Browser_flag_definition[] = [
    {
        key: 'compact',
        label: '--compact',
        message: 'Use it with "brightdata browser snapshot".',
    },
    {
        key: 'interactive',
        label: '--interactive',
        message: 'Use it with "brightdata browser snapshot".',
    },
    {
        key: 'depth',
        label: '--depth',
        message: 'Use it with "brightdata browser snapshot".',
    },
    {
        key: 'selector',
        label: '--selector',
        message: 'Use it with "brightdata browser snapshot".',
    },
];

const UNIMPLEMENTED_FLAGS: Browser_flag_definition[] = [
    {
        key: 'headed',
        label: '--headed',
        message: 'Headed browser mode is not implemented yet.',
    },
];

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

const parse_snapshot_depth = (raw: string|undefined): number|undefined=>{
    const normalized = raw?.trim();
    if (!normalized)
        return undefined;
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 0)
    {
        fail('Snapshot depth must be a non-negative integer.');
        return undefined;
    }
    return parsed;
};

const parse_snapshot_selector = (raw: string|undefined): string|undefined=>{
    if (raw === undefined)
        return undefined;
    const normalized = raw.trim();
    if (!normalized)
    {
        fail('Snapshot selector cannot be empty.');
        return undefined;
    }
    return normalized;
};

const has_flag_value = (value: unknown): boolean=>{
    if (typeof value == 'boolean')
        return value;
    if (typeof value == 'string')
        return !!value.trim();
    return value !== undefined && value !== null;
};

const is_structured_output_requested = (opts: Browser_cli_opts): boolean=>{
    return !!(opts.json || opts.pretty || opts.output);
};

const assert_flags_not_set = (
    opts: Browser_cli_opts,
    command_name: string,
    flags: Browser_flag_definition[],
)=>{
    for (const flag of flags)
    {
        if (!has_flag_value(opts[flag.key]))
            continue;
        fail(`${flag.label} is not supported by "${command_name}". ${flag.message}`);
    }
};

const assert_standard_session_flags = (
    opts: Browser_cli_opts,
    command_name: string,
)=>{
    assert_flags_not_set(opts, command_name, OPEN_ONLY_FLAGS);
    assert_flags_not_set(opts, command_name, SNAPSHOT_ONLY_FLAGS);
    assert_flags_not_set(opts, command_name, UNIMPLEMENTED_FLAGS);
};

const assert_snapshot_flags = (
    opts: Browser_cli_opts,
    command_name: string,
)=>{
    assert_flags_not_set(opts, command_name, OPEN_ONLY_FLAGS);
    assert_flags_not_set(opts, command_name, UNIMPLEMENTED_FLAGS);
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

const get_snapshot_params = (opts: Browser_cli_opts)=>({
    compact: opts.compact === true,
    depth: parse_snapshot_depth(opts.depth),
    interactive: opts.interactive === true,
    selector: parse_snapshot_selector(opts.selector),
});

const get_action_opts = (
    opts: Browser_cli_opts,
    command: Command,
): Browser_cli_opts=>({
    ...(command.optsWithGlobals() as Browser_cli_opts),
    ...opts,
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

const resolve_active_session = async(
    opts: Browser_cli_opts,
    command_name: string,
): Promise<string>=>{
    assert_standard_session_flags(opts, command_name);
    const session_name = get_session_name(opts.session);
    await ensure_active_session(session_name, opts);
    return session_name;
};

const print_navigation_result = (
    message: string,
    data: Browser_navigation_result,
    opts: Browser_cli_opts,
)=>{
    if (is_structured_output_requested(opts))
    {
        print(data, get_print_opts(opts));
        return;
    }

    success(message);
    info(`Title: ${data.title ?? 'Unknown'}`);
    info(`URL: ${data.url ?? 'Unknown'}`);
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
    assert_flags_not_set(opts, 'brightdata browser open', SNAPSHOT_ONLY_FLAGS);
    assert_flags_not_set(opts, 'brightdata browser open', UNIMPLEMENTED_FLAGS);
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
        print_navigation_result(`Navigated to ${url}`, data, opts);
    } catch(error) {
        spinner.stop();
        fail((error as Error).message);
    }
};

const handle_browser_navigation_action = async(
    action: 'back'|'forward'|'reload',
    message: string,
    opts: Browser_cli_opts,
)=>{
    const session_name = await resolve_active_session(
        opts,
        `brightdata browser ${action}`,
    );
    const data = await send_browser_action(
        session_name,
        action,
        opts,
    ) as Browser_navigation_result;
    print_navigation_result(message, data, opts);
};

const handle_browser_back = async(opts: Browser_cli_opts)=>{
    await handle_browser_navigation_action('back', 'Navigated back.', opts);
};

const handle_browser_forward = async(opts: Browser_cli_opts)=>{
    await handle_browser_navigation_action('forward', 'Navigated forward.', opts);
};

const handle_browser_reload = async(opts: Browser_cli_opts)=>{
    await handle_browser_navigation_action('reload', 'Reloaded page.', opts);
};

const handle_browser_snapshot = async(opts: Browser_cli_opts)=>{
    assert_snapshot_flags(opts, 'brightdata browser snapshot');
    const session_name = get_session_name(opts.session);
    await ensure_active_session(session_name, opts);
    const data = await send_browser_action(
        session_name,
        'snapshot',
        opts,
        get_snapshot_params(opts),
    ) as Browser_daemon_snapshot;

    if (opts.json || opts.pretty)
    {
        print(data, get_print_opts(opts));
        return;
    }

    print(data.snapshot ?? '', {output: opts.output});
};

const handle_browser_status = async(opts: Browser_cli_opts)=>{
    const session_name = await resolve_active_session(
        opts,
        'brightdata browser status',
    );
    const data = await send_browser_action(
        session_name,
        'status',
        opts,
    ) as Browser_daemon_status;
    print(data, get_print_opts(opts));
};

const handle_browser_network = async(opts: Browser_cli_opts)=>{
    const session_name = await resolve_active_session(
        opts,
        'brightdata browser network',
    );
    const data = await send_browser_action(
        session_name,
        'network',
        opts,
    ) as Browser_daemon_network;
    print(data.requests ?? [], get_print_opts(opts));
};

const handle_browser_cookies = async(opts: Browser_cli_opts)=>{
    const session_name = await resolve_active_session(
        opts,
        'brightdata browser cookies',
    );
    const data = await send_browser_action(
        session_name,
        'cookies',
        opts,
    ) as Browser_daemon_cookies;
    print(data.cookies ?? [], get_print_opts(opts));
};

const handle_browser_sessions = async(opts: Browser_cli_opts = {})=>{
    assert_standard_session_flags(opts, 'brightdata browser sessions');
    if (has_flag_value(opts.session))
    {
        fail(
            '--session is not supported by "brightdata browser sessions". '
            +'This command lists all active sessions.'
        );
    }
    const sessions = await list_browser_sessions(opts);
    print(sessions, get_print_opts(opts));
};

const handle_browser_close = async(opts: Browser_cli_opts = {})=>{
    assert_standard_session_flags(opts, 'brightdata browser close');
    if (opts.all && has_flag_value(opts.session))
    {
        fail(
            '--session cannot be combined with '
            +'"brightdata browser close --all".'
        );
    }

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

        if (is_structured_output_requested(opts))
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
        if (is_structured_output_requested(opts))
        {
            print({closed: false, session_name}, get_print_opts(opts));
            return;
        }
        info(`No active browser session "${session_name}".`);
        return;
    }

    const data = await send_browser_action(session_name, 'close', opts) as {closed?: boolean};
    if (is_structured_output_requested(opts))
    {
        print({session_name, ...data}, get_print_opts(opts));
        return;
    }
    success(`Closed browser session "${session_name}".`);
};

const create_session_command = (
    name: string,
    description: string,
    action: (opts: Browser_cli_opts)=>Promise<void>,
)=>{
    return new Command(name)
        .description(description)
        .action(async(opts, command)=>
            action(get_action_opts(opts, command))
        );
};

const create_browser_command = ()=>{
    const browser = new Command('browser')
        .description('Control Bright Data browser sessions')
        .option('-k, --api-key <key>', 'Override API key')
        .option('-o, --output <path>', 'Write output to file')
        .option('--json', 'Force JSON output')
        .option('--pretty', 'Pretty-print JSON output')
        .option(
            '--session <name>',
            `Browser session name (default: ${DEFAULT_SESSION_NAME})`,
        )
        .option(
            '--country <code>',
            'ISO country code for geo-targeting (e.g. us, de)',
        )
        .option(
            '--zone <name>',
            `Browser zone name (default: ${DEFAULT_BROWSER_ZONE})`,
        )
        .option('--compact', 'Include only interactive elements and their ancestors')
        .option('--interactive', 'Include only interactive elements as a flat list')
        .option('--depth <n>', 'Limit snapshot depth to a non-negative integer')
        .option('--selector <sel>', 'Scope snapshots to a CSS selector subtree')
        .option(
            '--timeout <ms>',
            `Command timeout in milliseconds (default: ${DEFAULT_IPC_TIMEOUT_MS})`,
        )
        .option('--headed', 'Request headed browser mode when supported')
        .option(
            '--idle-timeout <ms>',
            'Daemon idle timeout in milliseconds '
            +`(default: ${DEFAULT_DAEMON_IDLE_TIMEOUT_MS})`,
        );

    browser.addCommand(
        new Command('open')
            .description('Navigate to a URL in the Bright Data browser')
            .argument('<url>', 'URL to navigate to')
            .action(async(url, opts, command)=>
                handle_browser_open(url, get_action_opts(opts, command))
            )
    );

    browser.addCommand(create_session_command(
        'snapshot',
        'Capture a text snapshot of the current page',
        handle_browser_snapshot,
    ));
    browser.addCommand(create_session_command(
        'back',
        'Navigate back in the active browser session',
        handle_browser_back,
    ));
    browser.addCommand(create_session_command(
        'forward',
        'Navigate forward in the active browser session',
        handle_browser_forward,
    ));
    browser.addCommand(create_session_command(
        'reload',
        'Reload the current page in the active browser session',
        handle_browser_reload,
    ));
    browser.addCommand(create_session_command(
        'status',
        'Show the current state of a browser session',
        handle_browser_status,
    ));
    browser.addCommand(create_session_command(
        'network',
        'Show tracked network requests for a browser session',
        handle_browser_network,
    ));
    browser.addCommand(create_session_command(
        'cookies',
        'Show cookies for the active browser session',
        handle_browser_cookies,
    ));

    browser.addCommand(
        new Command('close')
            .description('Close one or all active browser sessions')
            .option('--all', 'Close all active browser sessions')
            .action(async(opts, command)=>
                handle_browser_close(get_action_opts(opts, command))
            )
    );

    browser.addCommand(create_session_command(
        'sessions',
        'List active browser daemon sessions',
        handle_browser_sessions,
    ));

    return browser;
};

const browser_command = create_browser_command();

export {
    browser_command,
    create_browser_command,
    get_browser_session_names,
    handle_browser_back,
    handle_browser_close,
    handle_browser_cookies,
    handle_browser_forward,
    handle_browser_network,
    handle_browser_open,
    handle_browser_reload,
    handle_browser_sessions,
    handle_browser_snapshot,
    handle_browser_status,
    list_browser_sessions,
};
