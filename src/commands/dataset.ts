import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {
    print,
    print_table,
    dim,
    fail,
    is_tty,
    success,
    sanitize_serialized_csv,
} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout} from '../utils/polling';
import {add_examples} from '../utils/help';
import {create_scraper_catalog} from '../utils/scraper_catalog';
import {
    all_failed,
    scraper_headers,
    trigger,
    results,
    wait_for_results,
} from '../utils/scraper_run';
import type {Record_error} from '../utils/scraper_run';
import {build_records, read_input} from '../utils/scraper_input';
import {pipelines_status_command} from './status';
import type {Webdata_format} from '../types/dataset';
import type {Scraper_details, Input_record} from '../types/pipelines';

const ALLOWED_FORMATS: Webdata_format[] = ['json', 'csv', 'ndjson', 'jsonl'];

type Pipelines_opts = {
    format?: string;
    timeout?: string;
    input?: string;
    async?: boolean;
    limit?: string;
    limitPerInput?: string;
    output?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
};

const out_opts = (opts: Pipelines_opts)=>({json: opts.json,
    pretty: opts.pretty, output: opts.output});

const is_human = (opts: Pipelines_opts)=>is_tty() && !opts.json
    && !opts.pretty && !opts.output;

const guard = <A extends unknown[]>(fn: (...args: A)=>Promise<void>)=>
    async(...args: A)=>{
        try {
            await fn(...args);
        } catch(e) {
            fail((e as Error).message);
        }
    };

const parse_int = (raw: string|undefined, name: string, def: number,
    max: number): number=>{
    if (raw === undefined)
        return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > max)
        throw new Error(`${name} must be a whole number from 1 to ${max}`);
    return n;
};

const resolve_format = (raw: string|undefined): Webdata_format=>{
    const format = (raw ?? 'json').toLowerCase() as Webdata_format;
    if (!ALLOWED_FORMATS.includes(format))
    {
        throw new Error(`Invalid format "${format}". Allowed formats: `
            +ALLOWED_FORMATS.join(', '));
    }
    return format;
};

// json/ndjson records carry {input: {url, ...}}; csv flattens it to input_url
const describe_input = (r: Record_error): string=>{
    const url = (r.input as {url?: unknown})?.url ?? r.input_url;
    return typeof url == 'string' && url ? url
        : JSON.stringify(r.input ?? null);
};

const print_data = (data: unknown, format: string, opts: Pipelines_opts)=>{
    const failed = all_failed(data, format);
    if (failed)
    {
        throw new Error(`All ${failed.length} input(s) failed, no records `
            +'returned:\n'+failed.map(r=>`  ${describe_input(r)}: `
            +r.error+(r.error_code ? ` [${r.error_code}]` : '')).join('\n'));
    }
    const safe = format == 'csv' && typeof data == 'string'
        ? sanitize_serialized_csv(data) : data;
    print(safe, out_opts(opts));
};

const quote = (s: string): string=>/^[\w:/.%@+,=-]+$/.test(s) ? s
    : `'${s.replace(/'/g, `'\\''`)}'`;

const flag_value = (value: unknown, type: string): string|null=>{
    if (value === undefined || value === null || value === '')
        return `<${type}>`;
    if (Array.isArray(value) && value.every(v=>typeof v != 'object'
        && !String(v).includes(',')))
    {
        return value.join(',');
    }
    return typeof value == 'object' ? null : String(value);
};

const run_example = (d: Scraper_details): string=>{
    const sample: Input_record = d.sample_input?.[0] ?? {};
    const required = d.input_fields.filter(f=>f.required);
    const shown = required.length ? required : d.input_fields.slice(0, 1);
    const values = shown.map(f=>flag_value(sample[f.name], f.type));
    const cmd = ['brightdata pipelines run', d.dataset_id, d.method];
    if (shown.some((f, i)=>/\s/.test(f.name) || values[i] === null))
    {
        const record = Object.fromEntries(shown.map(f=>[f.name,
            sample[f.name] ?? `<${f.type}>`]));
        return [...cmd, '--input', quote(JSON.stringify([record]))]
            .join(' ');
    }
    return [...cmd, ...shown.flatMap((f, i)=>[`--${f.name}`,
        quote(values[i]!)])].join(' ');
};

const format_details = (d: Scraper_details): string=>{
    const lines = [`${d.name} (${d.domain})`, `${d.dataset_id} ${d.method}`];
    if (d.description)
        lines.push('', d.description);
    if (d.input_fields.length)
        lines.push('', 'Input fields:');
    for (const f of d.input_fields)
    {
        const flag = /\s/.test(f.name) ? `"${f.name}" (only with --input)`
            : `--${f.name} <${f.type}>`;
        lines.push(`  ${flag}${f.required ? ' (required)' : ''}`
            +(f.description ? `  ${f.description}` : ''));
    }
    if (d.sample_input)
        lines.push('', `Example input: ${JSON.stringify(d.sample_input)}`);
    if (d.notes.length)
        lines.push('', ...d.notes);
    lines.push('', 'Run:', `  ${run_example(d)}`);
    return lines.join('\n');
};

const handle_search = async(words: string[], opts: Pipelines_opts)=>{
    const query = words.join(' ');
    const limit = parse_int(opts.limit, '--limit', 10, 50);
    const list = await create_scraper_catalog().search(query, limit);
    if (!is_human(opts))
        return void print(list, out_opts(opts));
    if (!list.length)
        return void console.error(`No scrapers match "${query}".`);
    print_table(list.map(s=>({...s,
        collection_methods: s.collection_methods.join(', ')})),
    ['dataset_id', 'name', 'domain', 'collection_methods']);
    console.error(dim('\nNext: brightdata pipelines info <dataset_id> '
        +'<method>'));
};

const handle_info = async(id: string, method: string|undefined,
    opts: Pipelines_opts)=>{
    const catalog = create_scraper_catalog();
    if (!method)
    {
        const entry = await catalog.find(id);
        if (!is_human(opts))
            return void print(entry, out_opts(opts));
        print([`${entry.name} (${entry.domain})`, entry.dataset_id, '',
            'Methods:', ...entry.collection_methods.map(m=>`  ${m}`), '',
            `Next: brightdata pipelines info ${id} <method>`].join('\n'));
        return;
    }
    const api_key = ensure_authenticated(opts.apiKey);
    const details = await catalog.get_details(api_key, id, method);
    print(is_human(opts) ? format_details(details) : details,
        out_opts(opts));
};

const build_input = async(api_key: string, id: string, method: string,
    args: string[], opts: Pipelines_opts): Promise<Input_record[]>=>{
    const catalog = create_scraper_catalog();
    if (!opts.input)
    {
        const details = await catalog.get_details(api_key, id, method);
        return build_records(details.input_fields, args);
    }
    if (args.length)
        throw new Error('Use either --input or URLs and field flags');
    const entry = await catalog.find(id);
    if (!entry.collection_methods.includes(method))
    {
        throw new Error(`${entry.name} has no method ${method}, available: `
            +entry.collection_methods.join(', '));
    }
    return read_input(opts.input);
};

const handle_run = async(id: string, method: string, args: string[],
    opts: Pipelines_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const timeout_seconds = parse_timeout(opts.timeout);
    const format = resolve_format(opts.format);
    const limit_per_input = parse_int(opts.limitPerInput,
        '--limit-per-input', 10, 1000);
    const input = await build_input(api_key, id, method, args, opts);
    const headers = scraper_headers(id, method);
    const spinner = start_spinner(`Starting ${method} on ${id} for `
        +`${input.length} input(s)...`);
    let snapshot_id: string;
    try {
        snapshot_id = await trigger(api_key, {dataset_id: id, method, input,
            limit_per_input}, {headers, timing: opts.timing});
    } finally {
        spinner.stop();
    }
    if (opts.async)
    {
        print({snapshot_id}, out_opts(opts));
        console.error(dim(`Check: brightdata pipelines status ${snapshot_id}`));
        return;
    }
    console.error(dim(`Snapshot ${snapshot_id} started. If you stop waiting, `
        +`get the data later with: brightdata pipelines results `
        +snapshot_id));
    const started = Date.now();
    const waiting = start_spinner(`Waiting for snapshot ${snapshot_id}...`);
    const on_running = ({attempt}: {attempt: number})=>{
        const msg = `Waiting for snapshot ${snapshot_id}: running, `
            +`${Math.round((Date.now()-started)/1000)}s`;
        if (is_tty())
            waiting.update(msg);
        else if (attempt % 30 == 0)
            console.error(msg);
    };
    let res;
    try {
        res = await wait_for_results(api_key, snapshot_id, {format,
            timeout_seconds, headers, timing: opts.timing, on_running});
    } finally {
        waiting.stop();
    }
    print_data(res.data, format, opts);
};

const handle_results = async(snapshot_id: string, opts: Pipelines_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const format = resolve_format(opts.format);
    const res = await results(api_key, snapshot_id, {format,
        timing: opts.timing});
    if (res.status == 'running')
    {
        throw new Error(`Snapshot ${snapshot_id} is not ready yet. Wait for `
            +`it with: brightdata pipelines status ${snapshot_id} --wait`);
    }
    print_data(res.data, format, opts);
};

const handle_refresh = async(opts: Pipelines_opts)=>{
    const list = await create_scraper_catalog().load_catalog({force: true});
    if (is_human(opts))
        return void success(`Loaded ${list.length} scrapers`);
    print({scrapers: list.length}, out_opts(opts));
};

const handle_removed_type = (type: string|undefined, _params: string[],
    _opts: unknown, cmd: Command)=>{
    if (!type)
        return void cmd.outputHelp();
    const words = type == 'list' ? '<site or data type>'
        : type.replace(/_/g, ' ');
    fail('Pipeline types were removed in 0.4.0. Find the scraper with:\n'
        +`  brightdata pipelines search ${words}`);
};

const add_output_opts = (cmd: Command): Command=>cmd
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing');

const search_subcommand = add_output_opts(new Command('search')
    .description('Find a pre-built scraper by site or data type')
    .argument('<query...>', 'Words to match, e.g. "amazon reviews"')
    .option('--limit <n>', 'Max results, 1-50 (default: 10)'))
    .action(guard(handle_search));

const info_subcommand = add_output_opts(new Command('info')
    .description('Show a scraper\'s methods, or one method\'s input fields '
        +'and example input')
    .argument('<dataset_id>', 'Scraper ID from "pipelines search"')
    .argument('[method]', 'Collection method, e.g. collect_by_url'))
    .action(guard(handle_info));

const run_subcommand = add_output_opts(new Command('run')
    .description('Run a scraper. Pass URLs, one --<field> <value> flag per '
        +'input field (see "pipelines info"), or --input')
    .argument('<dataset_id>', 'Scraper ID from "pipelines search"')
    .argument('<method>', 'Collection method from "pipelines info"')
    .argument('[inputs...]', 'URLs and --<field> <value> flags')
    .option('--input <json|@file>', 'Input records as JSON, or @path to a '
        +'JSON file')
    .option('--limit-per-input <n>', 'discover_by_* only: max records per '
        +'input, 1-1000 (default: 10). Every record is billed')
    .option('--async', 'Print the snapshot ID instead of waiting')
    .option('--format <fmt>', 'Result format: json, csv, ndjson, jsonl '
        +'(default: json)')
    .option('--timeout <seconds>', 'How long to wait (default: 600 or '
        +'BRIGHTDATA_POLLING_TIMEOUT)'))
    .allowUnknownOption()
    .allowExcessArguments()
    .action(guard(handle_run));

const results_subcommand = add_output_opts(new Command('results')
    .description('Get the records of a finished run')
    .argument('<snapshot_id>', 'Snapshot ID from "pipelines run"')
    .option('--format <fmt>', 'Result format: json, csv, ndjson, jsonl '
        +'(default: json)'))
    .action(guard(handle_results));

const refresh_subcommand = add_output_opts(new Command('refresh')
    .description('Reload the scraper list now instead of waiting for the '
        +'daily refresh'))
    .action(guard(handle_refresh));

const pipelines_command = new Command('pipelines')
    .description('Run any of the pre-built Scraper API scrapers and get '
        +'structured data')
    .argument('[type]')
    .argument('[params...]')
    .allowUnknownOption()
    .usage('<command> [options]')
    .addCommand(search_subcommand)
    .addCommand(info_subcommand)
    .addCommand(run_subcommand)
    .addCommand(pipelines_status_command)
    .addCommand(results_subcommand)
    .addCommand(refresh_subcommand)
    .action(handle_removed_type);

add_examples(pipelines_command, [
    {
        description: 'Find a scraper',
        command: 'brightdata pipelines search amazon reviews',
    },
    {
        description: 'See its input fields and an example',
        command: 'brightdata pipelines info gd_le8e811kzy4ggddlq '
            +'collect_by_url',
    },
    {
        description: 'Run it on a URL',
        command: 'brightdata pipelines run gd_le8e811kzy4ggddlq '
            +'collect_by_url https://www.amazon.com/dp/B08N5WRWNW --pretty',
    },
    {
        description: 'Pass input fields as flags',
        command: 'brightdata pipelines run gd_lwdb4vjm1ehb499uxs '
            +'collect_by_url --keyword laptop --url https://www.amazon.com',
    },
    {
        description: 'Start a run without waiting, then fetch it',
        command: 'brightdata pipelines run gd_le8e811kzy4ggddlq '
            +'collect_by_url https://www.amazon.com/dp/B08N5WRWNW --async',
    },
]);

export {
    pipelines_command,
    handle_search,
    handle_info,
    handle_run,
    handle_results,
    handle_refresh,
    handle_removed_type,
    format_details,
};
