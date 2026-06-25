import fs from 'fs';
import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {get, post} from '../utils/client';
import {print, dim, fail, success, info} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import {add_examples} from '../utils/help';
import {
    DATASET_IDS,
    resolve_dataset_type,
    resolve_format,
    strip_nulls,
    extract_status,
    TRIGGER_ENDPOINT,
    SNAPSHOT_ENDPOINT,
    RUNNING_STATUSES,
} from './dataset';
import type {Trigger_response} from '../types/dataset';

// A faithful, dataset-agnostic wrapper over /datasets/v3/trigger. Unlike
// `pipelines <type>` (which hardcodes a bare-{url} body via build_input),
// this command forwards the user's input array verbatim and exposes the
// trigger's mode/filter params (type / discover_by / limit_per_input /
// include_errors). It bakes in NO per-dataset schema knowledge — the user
// owns the input shape, exactly as the REST API expects it.

type Trigger_opts = {
    dataset?: string;
    datasetId?: string;
    type?: string;
    discoverBy?: string;
    inputFile?: string;
    input?: string;
    limit?: string;
    includeErrors?: boolean;
    format?: string;
    timeout?: string;
    async?: boolean;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

const resolve_dataset_id = (opts: Trigger_opts): string|undefined=>{
    if (opts.dataset && opts.datasetId)
    {
        fail('Provide either --dataset or --dataset-id, not both.');
        return undefined;
    }
    if (opts.datasetId)
        return opts.datasetId;
    if (opts.dataset)
    {
        const type_key = resolve_dataset_type(opts.dataset);
        if (!type_key)
        {
            fail(
                `Unknown dataset "${opts.dataset}".\n`
                +'  Run \'brightdata pipelines list\' to see available names,\n'
                +'  or pass a raw id with --dataset-id <gd_...>.'
            );
            return undefined;
        }
        return DATASET_IDS[type_key];
    }
    fail(
        'No dataset specified.\n'
        +'  Use --dataset <name> (e.g. x_posts) or --dataset-id <gd_...>.'
    );
    return undefined;
};

const parse_input_text = (text: string, source: string): unknown[]=>{
    const trimmed = text.trim();
    if (!trimmed)
    {
        fail(`No input found in ${source}.`);
        return [];
    }
    // Prefer whole-document JSON (an array, or a single object we wrap).
    try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch(_e) {
        // Fall back to JSONL: one JSON value per non-empty line.
        const lines = trimmed.split(/\r?\n/)
            .map(line=>line.trim())
            .filter(Boolean);
        const out: unknown[] = [];
        for (let i=0; i<lines.length; i++)
        {
            try {
                out.push(JSON.parse(lines[i]));
            } catch(_e2) {
                fail(
                    `Invalid JSON in ${source} at line ${i+1}.\n`
                    +'  Provide a JSON array, a single JSON object, or one '
                    +'JSON object per line (JSONL).'
                );
                return [];
            }
        }
        return out;
    }
};

const load_input = (opts: Trigger_opts): unknown[]|undefined=>{
    if (opts.inputFile && opts.input !== undefined)
    {
        fail('Provide either --input-file or --input, not both.');
        return undefined;
    }
    let array: unknown[];
    if (opts.inputFile)
    {
        let text: string;
        try {
            text = fs.readFileSync(opts.inputFile, 'utf8');
        } catch(e) {
            fail(
                `Cannot read input file "${opts.inputFile}": `
                +`${(e as Error).message}`
            );
            return undefined;
        }
        array = parse_input_text(text, `input file "${opts.inputFile}"`);
    }
    else if (opts.input !== undefined)
        array = parse_input_text(opts.input, '--input');
    else
    {
        fail(
            'No input provided.\n'
            +'  Pass --input-file <path> (JSON or JSONL) or --input \'<json>\'.\n'
            +'  The input is the array sent verbatim to the trigger API.'
        );
        return undefined;
    }
    if (!array.length)
    {
        fail('Input is empty; provide at least one input object.');
        return undefined;
    }
    return array;
};

const parse_limit = (raw: string|undefined): number|undefined=>{
    if (raw === undefined)
        return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0)
    {
        fail(
            `Invalid --limit "${raw}".\n`
            +'  Use a positive integer (maps to limit_per_input).'
        );
        return undefined;
    }
    return value;
};

const build_trigger_endpoint = (
    dataset_id: string,
    opts: Trigger_opts,
    limit_per_input: number|undefined,
    include_errors: boolean
): string=>{
    const params = [`dataset_id=${encodeURIComponent(dataset_id)}`];
    if (opts.type)
        params.push(`type=${encodeURIComponent(opts.type)}`);
    if (opts.discoverBy)
        params.push(`discover_by=${encodeURIComponent(opts.discoverBy)}`);
    if (limit_per_input !== undefined)
        params.push(`limit_per_input=${limit_per_input}`);
    params.push(`include_errors=${include_errors}`);
    return `${TRIGGER_ENDPOINT}?${params.join('&')}`;
};

const handle_datasets_trigger = async(opts: Trigger_opts)=>{
    const dataset_id = resolve_dataset_id(opts);
    if (!dataset_id)
        return;
    const input = load_input(opts);
    if (!input)
        return;
    const limit_per_input = parse_limit(opts.limit);
    // include_errors defaults to true (matching `pipelines`); only an
    // explicit --no-include-errors turns it off.
    const include_errors = opts.includeErrors !== false;
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const format = resolve_format(opts.format);
    const endpoint = build_trigger_endpoint(
        dataset_id, opts, limit_per_input, include_errors
    );
    const spinner = start_spinner(
        `Triggering dataset collection (${dataset_id})...`
    );
    try {
        const trigger = await post<Trigger_response>(
            api_key,
            endpoint,
            input,
            {timing: opts.timing}
        );
        spinner.stop();
        const snapshot_id = trigger.snapshot_id;
        if (!snapshot_id)
        {
            fail('Failed to trigger collection (missing snapshot_id).');
            return;
        }
        if (opts.async)
        {
            success(`Trigger submitted. Snapshot ID: ${snapshot_id}`);
            info(`Track it with: brightdata status ${snapshot_id} --wait`);
            return;
        }
        console.error(dim(
            `Triggered collection with snapshot ID: ${snapshot_id}`
        ));
        const poll_result = await poll_until<unknown>({
            timeout_seconds: timeout,
            fetch_once: ()=>{
                const snapshot = `${SNAPSHOT_ENDPOINT}/${snapshot_id}`
                    +`?format=${format}`;
                return get<unknown>(api_key, snapshot, {timing: opts.timing});
            },
            get_status: extract_status,
            running_statuses: RUNNING_STATUSES,
            timeout_label: 'data',
            on_running: ({attempt, timeout_seconds, status})=>{
                console.error(dim(
                    `Status: ${status} - polling again `
                    +`(attempt ${attempt}/${timeout_seconds})`
                ));
            },
        });
        console.error(dim(
            `Data received after ${poll_result.attempts} attempts`
        ));
        const result = poll_result.result;
        const cleaned = format == 'json' ? strip_nulls(result) : result;
        print(cleaned, {
            json: opts.json,
            pretty: opts.pretty,
            output: opts.output,
        });
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const trigger_command = new Command('trigger')
    .description(
        'Trigger a Datasets v3 collection job (collect-by-URL or discovery)'
    )
    .option('--dataset <name>',
        'Dataset name (e.g. x_posts); see \'brightdata pipelines list\'')
    .option('--dataset-id <id>',
        'Raw dataset id (gd_...); works for any dataset, no code change')
    .option('--type <type>',
        'Trigger type, e.g. discover_new (omit for collect-by-URL)')
    .option('--discover-by <field>',
        'Discovery seed field, e.g. profile_url or url')
    .option('--input-file <path>',
        'Input array file (JSON or JSONL), sent verbatim to the API')
    .option('--input <json>',
        'Inline JSON input (array or single object), sent verbatim')
    .option('--limit <n>',
        'Max records per input (maps to limit_per_input)')
    .option('--include-errors',
        'Include per-row errors in the snapshot (default: true)')
    .option('--no-include-errors',
        'Exclude per-row errors from the snapshot')
    .option('--format <fmt>',
        'Result format: json, csv, ndjson, jsonl (default: json)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds '
        +'(default: 600 or BRIGHTDATA_POLLING_TIMEOUT)')
    .option('--async',
        'Trigger only; print the snapshot ID and exit (no polling)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_datasets_trigger);

add_examples(trigger_command, [
    {
        description: 'Discovery mode: crawl an X profile\'s posts by date '
            +'range (input array in a JSONL file)',
        command: 'brightdata datasets trigger --dataset x_posts '
            +'--type discover_new --discover-by profile_url '
            +'--input-file seeds.jsonl --limit 15000 --format jsonl',
    },
    {
        description: 'Collect-by-URL with inline input (no per-dataset flags)',
        command: 'brightdata datasets trigger --dataset linkedin_posts '
            +'--input \'[{"url":"https://www.linkedin.com/posts/example"}]\'',
    },
    {
        description: 'Trigger asynchronously by raw dataset id, then poll '
            +'with status',
        command: 'brightdata datasets trigger '
            +'--dataset-id gd_lwxkxvnf1cynvib9co '
            +'--input-file seeds.jsonl --async',
    },
]);

const datasets_command = new Command('datasets')
    .description('Trigger Bright Data Datasets v3 collection jobs')
    .addCommand(trigger_command);

export {datasets_command, trigger_command, handle_datasets_trigger};
