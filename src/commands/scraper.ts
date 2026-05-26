import {Command} from 'commander';
import {post, get, type Body_hint} from '../utils/client';
import {load as load_config} from '../utils/config';
import {ensure_authenticated} from '../utils/auth';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import {print, success, fail, dim, is_tty} from '../utils/output';
import type {
    Create_template_request,
    Create_template_response,
    Trigger_ai_request,
    Trigger_ai_response,
    Ai_progress_response,
    Scraper_create_opts,
    Create_envelope,
    Run_request,
    Trigger_immediate_response,
    Scraper_run_opts,
    Batch_trigger_response,
} from '../types/scraper';

// Scraper-studio body-pattern hints. Kept here, not in client.ts, so
// the DCA vocabulary doesn't leak into other commands. First match wins.
const SCRAPER_BODY_HINTS: Body_hint[] = [
    {
        pattern: /collector does not have a template/i,
        hint: 'AI generation has not completed for this collector. '
            +'Re-run `bdata scraper create` (the previous attempt may '
            +'have hit the AI-Flow parallel-job cap), or open '
            +'https://brightdata.com/cp/scrapers to inspect / finish '
            +'the half-built collector in the web UI.',
    },
    {
        pattern: /cannot run more than \d+ jobs in parallel/i,
        hint: 'You hit the AI-Flow concurrent-job cap. Wait for an '
            +'in-flight `scraper create` to finish, or serialise '
            +'your launches.',
    },
];

const CREATE_TEMPLATE_ENDPOINT = '/dca/collector';
const AI_TRIGGER_PATH = 'automate_template';
const AI_PROGRESS_PATH = 'automate_template/progress';
const RUNNING_SENTINEL = '__running__';
const DONE_STATUS = 'done';
const TERMINAL_FAIL_STATUSES = ['failed', 'error', 'cancelled'];
const TRIGGER_IMMEDIATE_ENDPOINT = '/dca/trigger_immediate';
const GET_RESULT_ENDPOINT = '/dca/get_result';
const SYNC_CRAWL_ENDPOINT = '/dca/crawl';
const BATCH_TRIGGER_ENDPOINT = '/dca/trigger';
const BATCH_DATASET_ENDPOINT = '/dca/dataset';
const SYNC_TIMEOUT_MIN = 25;
const SYNC_TIMEOUT_MAX = 50;
const SYNC_TIMEOUT_DEFAULT = 50;
const READY_SENTINEL = '__ready__';
const PENDING_SENTINEL = '__pending__';
const BATCH_POLL_INTERVAL_MS = 10_000;
const BATCH_TIMEOUT_DEFAULT = 3600;
const REALTIME_LIMIT_MARKER = 'realtime job limit';

const build_template_request = (
    opts: Scraper_create_opts
): Create_template_request=>({
    name: opts.name ?? `cli-scraper-${Math.floor(Date.now()/1000)}`,
    deliver: {
        type: 'webhook',
        endpoint: opts.deliverWebhook ?? 'https://example.com/webhook',
        filename: {template: 'data', extension: 'json'},
    },
});

const build_ai_request = (
    url: string,
    description: string
): Trigger_ai_request=>({
    description,
    urls: [url],
});

const extract_progress_status = (
    result: Ai_progress_response
): string|undefined=>{
    if (!result || typeof result != 'object')
        return undefined;
    if (typeof result.status != 'string')
        return undefined;
    // terminal statuses stop polling; non-done ones route to failure.
    if (result.status == DONE_STATUS
        || TERMINAL_FAIL_STATUSES.includes(result.status))
    {
        return result.status;
    }
    return RUNNING_SENTINEL;
};

const format_create_summary = (
    collector_id: string,
    name: string,
    progress: Ai_progress_response
): string=>{
    const steps = progress.completed_steps?.length ?? 0;
    const lines = [
        `Scraper created: ${name}`,
        `  Collector ID: ${collector_id}`,
        `  Completed steps: ${steps}`,
        `  View in web UI: https://brightdata.com/cp/scrapers`,
    ];
    return lines.join('\n');
};

const clean_error_message = (msg: string): string=>
    msg.split('\n')[0].replace(/^Error:\s*/, '').trim();

const build_create_envelope = (params: {
    collector_id: string;
    name: string;
    status: string;
    progress?: Ai_progress_response;
    created_at?: string;
    error?: string;
}): Create_envelope=>({
    collector_id: params.collector_id,
    name: params.name,
    status: params.status,
    completed_steps: params.progress?.completed_steps ?? [],
    view_url: `https://brightdata.com/cp/scrapers/${params.collector_id}`,
    ...(params.created_at ? {created_at: params.created_at} : {}),
    ...(params.error ? {error: params.error} : {}),
});

const wants_machine_output = (opts: Scraper_create_opts): boolean=>
    !!(opts.json || opts.pretty || opts.output) || !is_tty;

const emit_create_output = (
    envelope: Create_envelope,
    progress: Ai_progress_response|null,
    opts: Scraper_create_opts
): boolean=>{
    if (!wants_machine_output(opts))
        return false;
    const print_opts = {json: opts.json, pretty: opts.pretty,
        output: opts.output};
    const payload = opts.legacyOutput && progress
        ? (progress as unknown) : envelope;
    print(payload, print_opts);
    return true;
};

const handle_create_scraper = async(
    url: string,
    description: string,
    opts: Scraper_create_opts
)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const template_body = build_template_request(opts);
    const create_spinner = start_spinner('Creating scraper template...');
    let collector_id = '';
    let scraper_name = template_body.name;
    let created_at: string|undefined;
    try {
        const template = await post<Create_template_response>(
            api_key,
            CREATE_TEMPLATE_ENDPOINT,
            template_body,
            {timing: opts.timing, hints: SCRAPER_BODY_HINTS}
        );
        create_spinner.stop();
        if (!template.id)
        {
            fail('Failed to create scraper template (missing id).');
            return;
        }
        collector_id = template.id;
        scraper_name = template.name ?? template_body.name;
        created_at = template.created;
        console.error(dim(`Template created: ${collector_id}`));
    } catch(e) {
        create_spinner.stop();
        console.error(
            `Failed to create scraper template: ${(e as Error).message}`);
        process.exit(1);
        return;
    }
    const trigger_spinner = start_spinner('Triggering AI generation...');
    try {
        await post<Trigger_ai_response>(
            api_key,
            `/dca/collectors/${collector_id}/${AI_TRIGGER_PATH}`,
            build_ai_request(url, description),
            {timing: opts.timing, hints: SCRAPER_BODY_HINTS}
        );
        trigger_spinner.stop();
    } catch(e) {
        trigger_spinner.stop();
        const msg = (e as Error).message;
        console.error(
            `Failed to start AI generation for collector `
            +`${collector_id}: ${msg}`
        );
        emit_create_output(
            build_create_envelope({
                collector_id,
                name: scraper_name,
                status: 'ai_trigger_failed',
                created_at,
                error: clean_error_message(msg),
            }),
            null,
            opts
        );
        process.exit(1);
        return;
    }
    const poll_spinner = start_spinner('Generating scraper...');
    try {
        const poll_result = await poll_until<Ai_progress_response>({
            timeout_seconds: timeout,
            fetch_once: ()=>get<Ai_progress_response>(
                api_key,
                `/dca/collectors/${collector_id}/${AI_PROGRESS_PATH}`,
                {timing: opts.timing, hints: SCRAPER_BODY_HINTS}
            ),
            get_status: extract_progress_status,
            running_statuses: [RUNNING_SENTINEL],
            timeout_label: `AI generation (collector ${collector_id})`,
            on_running: ({attempt, timeout_seconds, result})=>{
                const step = result.step ?? 'pending';
                console.error(dim(
                    `Step: ${step} — polling `
                    +`(attempt ${attempt}/${timeout_seconds})`
                ));
            },
        });
        poll_spinner.stop();
        console.error(dim(
            `Done in ${poll_result.attempts} poll attempts.`));
        const progress = poll_result.result;
        if (progress.status != DONE_STATUS)
        {
            console.error(
                `AI generation failed (collector ${collector_id}, `
                +`status: ${progress.status}).`
            );
            emit_create_output(
                build_create_envelope({
                    collector_id,
                    name: scraper_name,
                    status: progress.status,
                    progress,
                    created_at,
                    error: `AI generation finished with status `
                        +`"${progress.status}".`,
                }),
                progress,
                opts
            );
            process.exit(1);
            return;
        }
        const emitted = emit_create_output(
            build_create_envelope({
                collector_id,
                name: scraper_name,
                status: progress.status,
                progress,
                created_at,
            }),
            progress,
            opts
        );
        if (emitted)
            return;
        success(format_create_summary(
            collector_id, scraper_name, progress));
    } catch(e) {
        poll_spinner.stop();
        const msg = (e as Error).message;
        const suffix = msg.includes(collector_id)
            ? '' : ` (collector ${collector_id})`;
        console.error(`${msg}${suffix}`);
        emit_create_output(
            build_create_envelope({
                collector_id,
                name: scraper_name,
                status: 'poll_failed',
                created_at,
                error: clean_error_message(msg),
            }),
            null,
            opts
        );
        process.exit(1);
        return;
    }
};

const parse_sync_timeout = (raw: string|undefined): number=>{
    const value = raw == null ? SYNC_TIMEOUT_DEFAULT : +raw;
    if (!Number.isFinite(value)
        || value < SYNC_TIMEOUT_MIN || value > SYNC_TIMEOUT_MAX)
    {
        throw new Error(
            `Invalid --sync-timeout "${raw}". `
            +`Must be between ${SYNC_TIMEOUT_MIN} and ${SYNC_TIMEOUT_MAX}.`
        );
    }
    return Math.floor(value);
};

const build_run_request = (url: string): Run_request=>({url});

const build_run_query = (
    collector_id: string,
    opts: Pick<Scraper_run_opts, 'name'|'version'>,
    extra?: Record<string, string>
): string=>{
    const params = new URLSearchParams({collector: collector_id});
    if (opts.name)
        params.set('name', opts.name);
    if (opts.version)
        params.set('version', opts.version);
    if (extra)
    {
        for (const k of Object.keys(extra))
            params.set(k, extra[k]);
    }
    return params.toString();
};

const classify_result = (status: number, body: string): string=>{
    if (status < 200 || status >= 300)
        return PENDING_SENTINEL;
    const trimmed = body.trim();
    if (!trimmed || trimmed == 'null')
        return PENDING_SENTINEL;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed == 'object' && !Array.isArray(parsed)
            && (parsed as {pending?: unknown}).pending === true)
        {
            return PENDING_SENTINEL;
        }
    } catch(_e) {}
    return READY_SENTINEL;
};

const parse_result_body = (body: string): unknown=>{
    const trimmed = body.trim();
    try {
        return JSON.parse(trimmed);
    } catch(_e) {
        return trimmed;
    }
};

const is_realtime_page_limit_error = (data: unknown): boolean=>{
    if (!Array.isArray(data) || data.length == 0)
        return false;
    for (const item of data)
    {
        if (!item || typeof item != 'object')
            return false;
        const err = (item as {error?: unknown}).error;
        if (typeof err != 'string')
            return false;
        if (err.toLowerCase().includes(REALTIME_LIMIT_MARKER))
            return true;
    }
    return false;
};

const classify_dataset = (status: number, body: string): string=>{
    if (status == 202)
        return PENDING_SENTINEL;
    if (status < 200 || status >= 300)
        return PENDING_SENTINEL;
    const trimmed = body.trim();
    if (!trimmed)
        return PENDING_SENTINEL;
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed == 'object' && !Array.isArray(parsed)
            && (parsed as {status?: unknown}).status == 'building')
        {
            return PENDING_SENTINEL;
        }
    } catch(_e) {}
    return READY_SENTINEL;
};

type Raw_response = {
    status: number;
    body: string;
};

const fetch_raw = async(
    api_key: string,
    endpoint: string,
    init: RequestInit
): Promise<Raw_response>=>{
    const config = load_config();
    const base_url = config.api_url ?? 'https://api.brightdata.com';
    const url = endpoint.startsWith('http') ? endpoint :
        `${base_url}${endpoint}`;
    const headers: Record<string, string> = {
        'Authorization': `Bearer ${api_key}`,
        'User-Agent': 'brightdata-cli',
        ...(init.headers as Record<string, string> ?? {}),
    };
    if (init.body !== undefined)
        headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {...init, headers});
    const body = await res.text();
    return {status: res.status, body};
};

const run_batch = async(
    api_key: string,
    collector_id: string,
    url: string,
    opts: Scraper_run_opts
)=>{
    const timeout_raw = opts.timeout ?? String(BATCH_TIMEOUT_DEFAULT);
    let timeout = BATCH_TIMEOUT_DEFAULT;
    try {
        timeout = parse_timeout(timeout_raw);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    console.error(dim(
        'Realtime page limit exceeded — switching to batch mode...'));
    const trigger_spinner = start_spinner('Submitting batch job...');
    let collection_id = '';
    try {
        const query = build_run_query(collector_id, opts);
        const trigger = await post<Batch_trigger_response>(
            api_key,
            `${BATCH_TRIGGER_ENDPOINT}?${query}`,
            [build_run_request(url)],
            {timing: opts.timing, hints: SCRAPER_BODY_HINTS}
        );
        trigger_spinner.stop();
        if (!trigger.collection_id)
        {
            console.error(
                `Failed to submit batch job (collector ${collector_id}): `
                +'missing collection_id.');
            process.exit(1);
            return;
        }
        collection_id = trigger.collection_id;
        const eta = trigger.start_eta
            ? ` (ETA: ${trigger.start_eta})` : '';
        console.error(dim(
            `Batch job: ${collection_id}${eta}`));
    } catch(e) {
        trigger_spinner.stop();
        console.error(
            `Failed to submit batch job (collector ${collector_id}): `
            +`${(e as Error).message}`);
        process.exit(1);
        return;
    }
    const poll_spinner = start_spinner('Collecting (batch)...');
    try {
        const poll_result = await poll_until<Raw_response>({
            timeout_seconds: timeout,
            interval_ms: BATCH_POLL_INTERVAL_MS,
            fetch_once: ()=>fetch_raw(api_key,
                `${BATCH_DATASET_ENDPOINT}?id=`
                +encodeURIComponent(collection_id),
                {method: 'GET'}),
            get_status: r=>classify_dataset(r.status, r.body),
            running_statuses: [PENDING_SENTINEL],
            timeout_label: `batch results (collection_id ${collection_id})`,
            on_running: ({attempt, timeout_seconds})=>{
                console.error(dim(
                    `Polling batch (attempt ${attempt}/${timeout_seconds})`));
            },
        });
        poll_spinner.stop();
        const data = parse_result_body(poll_result.result.body);
        print(data, {json: opts.json, pretty: opts.pretty,
            output: opts.output});
    } catch(e) {
        poll_spinner.stop();
        const msg = (e as Error).message;
        const suffix = msg.includes(collection_id)
            ? '' : ` (collection_id ${collection_id})`;
        console.error(`${msg}${suffix}`);
        process.exit(1);
        return;
    }
};

const handle_run_scraper = async(
    collector_id: string,
    url: string,
    opts: Scraper_run_opts
)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    if (opts.sync)
    {
        let sync_timeout = SYNC_TIMEOUT_DEFAULT;
        try {
            sync_timeout = parse_sync_timeout(opts.syncTimeout);
        } catch(e) {
            fail((e as Error).message);
            return;
        }
        const query = build_run_query(collector_id, opts,
            {timeout: `${sync_timeout}s`});
        const spinner = start_spinner('Scraping...');
        try {
            const res = await fetch_raw(api_key,
                `${SYNC_CRAWL_ENDPOINT}?${query}`, {
                    method: 'POST',
                    body: JSON.stringify(build_run_request(url)),
                });
            spinner.stop();
            if (res.status == 202)
            {
                const parsed = parse_result_body(res.body) as
                    {response_id?: string; message?: string};
                const rid = parsed?.response_id ?? '<unknown>';
                console.error(
                    `Sync request timed out server-side after `
                    +`${sync_timeout}s (response_id: ${rid}). `
                    +'Re-run without --sync to poll for results.'
                );
                process.exit(1);
                return;
            }
            if (res.status < 200 || res.status >= 300)
            {
                console.error(
                    `Failed to scrape (collector ${collector_id}): `
                    +`HTTP ${res.status} ${res.body.slice(0, 200)}`
                );
                process.exit(1);
                return;
            }
            const data = parse_result_body(res.body);
            if (is_realtime_page_limit_error(data))
            {
                await run_batch(api_key, collector_id, url, opts);
                return;
            }
            print(data, {json: opts.json, pretty: opts.pretty,
                output: opts.output});
            return;
        } catch(e) {
            spinner.stop();
            console.error(
                `Failed to scrape (collector ${collector_id}): `
                +`${(e as Error).message}`);
            process.exit(1);
            return;
        }
    }
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const trigger_spinner = start_spinner('Triggering scrape...');
    let response_id = '';
    try {
        const trigger_query = build_run_query(collector_id, opts);
        const trigger = await post<Trigger_immediate_response>(
            api_key,
            `${TRIGGER_IMMEDIATE_ENDPOINT}?${trigger_query}`,
            build_run_request(url),
            {timing: opts.timing, hints: SCRAPER_BODY_HINTS}
        );
        trigger_spinner.stop();
        if (!trigger.response_id)
        {
            console.error(
                `Failed to trigger scraper (collector ${collector_id}): `
                +'missing response_id in trigger response.');
            process.exit(1);
            return;
        }
        response_id = trigger.response_id;
        console.error(dim(`Triggered (response_id: ${response_id})`));
    } catch(e) {
        trigger_spinner.stop();
        console.error(
            `Failed to trigger scraper (collector ${collector_id}): `
            +`${(e as Error).message}`);
        process.exit(1);
        return;
    }
    const poll_spinner = start_spinner('Waiting for results...');
    try {
        const poll_result = await poll_until<Raw_response>({
            timeout_seconds: timeout,
            fetch_once: ()=>fetch_raw(api_key,
                `${GET_RESULT_ENDPOINT}?response_id=`
                +encodeURIComponent(response_id),
                {method: 'GET'}),
            get_status: r=>classify_result(r.status, r.body),
            running_statuses: [PENDING_SENTINEL],
            timeout_label: `results (response_id ${response_id})`,
            on_running: ({attempt, timeout_seconds})=>{
                console.error(dim(
                    `Polling (attempt ${attempt}/${timeout_seconds})`));
            },
        });
        poll_spinner.stop();
        const data = parse_result_body(poll_result.result.body);
        if (is_realtime_page_limit_error(data))
        {
            await run_batch(api_key, collector_id, url, opts);
            return;
        }
        print(data, {json: opts.json, pretty: opts.pretty,
            output: opts.output});
    } catch(e) {
        poll_spinner.stop();
        const msg = (e as Error).message;
        const suffix = msg.includes(response_id)
            ? '' : ` (response_id ${response_id})`;
        console.error(`${msg}${suffix}`);
        process.exit(1);
        return;
    }
};

const create_subcommand = new Command('create')
    .description(
        'Build a scraper from a natural-language description using AI')
    .argument('<url>', 'Target URL to scrape')
    .argument('<description>',
        'Natural-language description of data to extract (max 500 chars)')
    .option('--name <name>',
        'Scraper template name (default: cli-scraper-<timestamp>)')
    .option('--deliver-webhook <url>',
        'Webhook URL for the deliver stub '
        +'(default: https://example.com/webhook)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds (default: 600)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--legacy-output',
        'Emit the bare AI-progress payload (pre-v0.3 shape) instead '
        +'of the new {collector_id, name, status, ...} envelope. '
        +'For one-version migration only.')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_create_scraper);

const run_subcommand = new Command('run')
    .description('Run a Bright Data scraper on a URL and return the data')
    .argument('<collector_id>',
        'Collector ID of the scraper (returned by `scraper create`)')
    .argument('<url>', 'URL to scrape')
    .option('--sync',
        'Use the synchronous /dca/crawl endpoint (server-side 25-50s cap)')
    .option('--sync-timeout <seconds>',
        `Sync-mode server timeout (${SYNC_TIMEOUT_MIN}-${SYNC_TIMEOUT_MAX}, `
        +`default ${SYNC_TIMEOUT_DEFAULT})`)
    .option('--timeout <seconds>',
        'Polling timeout in async mode (default: 600)')
    .option('--name <name>', 'Human-readable job name')
    .option('--version <version>', 'Scraper version (e.g. "dev")')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_run_scraper);

const scraper_command = new Command('scraper')
    .description('Build and manage Bright Data scrapers')
    .addCommand(create_subcommand)
    .addCommand(run_subcommand);

export {
    scraper_command,
    handle_create_scraper,
    build_template_request,
    build_ai_request,
    extract_progress_status,
    format_create_summary,
    build_create_envelope,
    emit_create_output,
    handle_run_scraper,
    build_run_request,
    build_run_query,
    classify_result,
    parse_result_body,
    parse_sync_timeout,
    is_realtime_page_limit_error,
    classify_dataset,
    SCRAPER_BODY_HINTS,
};
