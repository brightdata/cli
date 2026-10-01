import fs from 'fs';
import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {get, post} from '../utils/client';
import {
    print, print_table, dim, fail, info, success,
} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import {add_examples} from '../utils/help';
import {EXIT} from '../utils/exit-codes';
import type {
    Marketplace_format,
    Dataset_info,
    Dataset_metadata,
    Snapshot_status,
    Filter_request,
    Filter_response,
    Marketplace_opts,
} from '../types/marketplace';

// The Dataset Marketplace API: query records Bright Data has already
// collected. Unversioned, and entirely separate from the /datasets/v3/*
// endpoints `pipelines` uses to collect new data.
const LIST_ENDPOINT = '/datasets/list';
const FILTER_ENDPOINT = '/datasets/filter';
const metadata_endpoint = (id: string)=>`/datasets/${id}/metadata`;
const snapshot_endpoint = (id: string)=>`/datasets/snapshots/${id}`;
const download_endpoint = (id: string)=>`/datasets/snapshots/${id}/download`;

// Marketplace status vocabulary — differs from v3's
// starting/building/running.
const RUNNING_STATUSES = ['scheduled', 'building'];
const FAILED_STATUS = 'failed';
const ALLOWED_FORMATS: Marketplace_format[] = ['json', 'jsonl', 'csv'];
const LIST_WARN_THRESHOLD = 200;

// Named shortcuts for the datasets people reach for most. This is the ONLY way
// to address a dataset by name: the catalogue's own `name` field is a human
// display string ("Instagram - Profiles", "Facebook -  Comments" with a double
// space, "Manta businesses " with a trailing one), 43 names are shared across
// different ids, and the catalogue holds internal entries. So names are for
// reading, not for resolving. Everything outside this map is reachable with
// --dataset-id; `marketplace list --search` finds the id.
// Each comment records the catalogue's own name for that id (validated against
// a live GET /datasets/list on 2026-08-27: 48/48 resolve).
const FEATURED_DATASETS: Record<string, string> = {
    // --- social / content (32) ---
    // Bluesky - Posts
    bluesky_posts: 'gd_m6hn4r5s27zfhc7w4',
    // Top 500 Bluesky Profiles
    bluesky_top_profiles: 'gd_m45p78dl1m017wi5lj',
    // Facebook -  Comments
    facebook_comments: 'gd_lkay758p1eanlolqw8',
    // Facebook Company Reviews
    facebook_company_reviews: 'gd_m0dtqpiu1mbcyc2g86',
    // Facebook Events
    facebook_events: 'gd_m14sd0to1jz48ppm51',
    // Facebook - Posts by group URL
    facebook_group_posts: 'gd_lz11l67o2cb3r0lkj3',
    // Facebook Marketplace
    facebook_marketplace: 'gd_lvt9iwuh6fbcwmx1a',
    // Facebook - Pages Posts by Profile URL
    facebook_pages_posts: 'gd_lkaxegm826bjpoo9m5',
    // Facebook - Pages and Profiles
    facebook_pages_profiles: 'gd_mf124a0511bauquyow',
    // Facebook - Posts by post URL
    facebook_posts_by_url: 'gd_lyclm1571iy3mv57zw',
    // Facebook - Profiles
    facebook_profiles: 'gd_mf0urb782734ik94dz',
    // Facebook - Reels by profile URL
    facebook_reels: 'gd_lyclm3ey2q6rww027t',
    // Instagram - Comments
    instagram_comments: 'gd_ltppn085pokosxh13',
    // Instagram - Posts
    instagram_posts: 'gd_lk5ns7kz21pck8jpis',
    // Instagram - Profiles
    instagram_profiles: 'gd_l1vikfch901nx3by4',
    // Instagram - Reels
    instagram_reels: 'gd_lyclm20il4r5helnj',
    // Pinterest - Posts
    pinterest_posts: 'gd_lk0sjs4d21kdr7cnlv',
    // Pinterest - Profiles
    pinterest_profiles: 'gd_lk0zv93c2m9qdph46z',
    // Quora posts
    quora_posts: 'gd_lvz1rbj81afv3m6n5y',
    // Reddit - Comments
    reddit_comments: 'gd_lvzdpsdlw09j6t702',
    // Reddit- Posts
    reddit_posts: 'gd_lvz8ah06191smkebj4',
    // Snapchat posts
    snapchat_posts: 'gd_ma0ydx431w6stl16ge',
    // TikTok - Comments
    tiktok_comments: 'gd_lkf2st302ap89utw5k',
    // TikTok - Posts
    tiktok_posts: 'gd_lu702nij2f790tmv9h',
    // TikTok - Profiles
    tiktok_profiles: 'gd_l1villgoiiidt09ci',
    // TikTok Shop
    tiktok_shop: 'gd_m45m1u911dsa4274pi',
    // Vimeo - Videos posts
    vimeo_videos: 'gd_lxk88z3v1ketji4pn',
    // X (formerly Twitter) - Posts
    x_twitter_posts: 'gd_lwxkxvnf1cynvib9co',
    // X (formerly Twitter) - Profiles
    x_twitter_profiles: 'gd_lwxmeb2u1cniijd7t4',
    // Youtube - Comments
    youtube_comments: 'gd_lk9q0ew71spt1mxywf',
    // YouTube - Channels
    youtube_profiles: 'gd_lk538t2k2p1k3oos71',
    // Youtube - Videos posts
    youtube_videos: 'gd_lk56epmy2i5g7lzu0k',
    // --- business / people intelligence (16) ---
    // Companies information enriched dataset
    companies_enriched: 'gd_m3fl0mwzmfpfn4cw4',
    // Crunchbase companies information
    crunchbase_companies: 'gd_l1vijqt9jfj7olije',
    // Employees business enriched dataset
    employees_enriched: 'gd_m18zt6ec11wfqohyrs',
    // LinkedIn company information
    linkedin_company_profiles: 'gd_l1vikfnt1wgvvqz95w',
    // Linkedin job listings information
    linkedin_job_listings: 'gd_lpfll7v5hcqtkxl6l',
    // LinkedIn people profiles
    linkedin_people_profiles: 'gd_l1viktl72bvl7bjuj0',
    // LinkedIn posts
    linkedin_posts: 'gd_lyy3tktm25m4avu764',
    // LinkedIn profiles Jobs Listings
    linkedin_profiles_job_listings: 'gd_m487ihp32jtc4ujg45',
    // Manta businesses
    manta_businesses: 'gd_l1vil1d81g0u8763b2',
    // Owler companies information
    owler_companies: 'gd_l1vilaxi10wutoage7',
    // pitchbook companies information
    pitchbook_companies: 'gd_m4ijiqfp2n9oe3oluj',
    // Slintel 6sense company information
    slintel_companies: 'gd_l1vilg5a1decoahvgq',
    // US lawyers directory
    us_lawyers: 'gd_l1vil5n11okchcbvax',
    // VentureRadar company information
    ventureradar_companies: 'gd_l1vilsfd1xpsndbtpr',
    // Xing social network
    xing_profiles: 'gd_l3lh4ev31oqrvvblv6',
    // Zoominfo companies information
    zoominfo_companies: 'gd_m0ci4a4ivx3j5l6nx',
};

const resolve_format = (raw: string|undefined): Marketplace_format=>{
    const format = (raw ?? 'json').toLowerCase();
    if (ALLOWED_FORMATS.includes(format as Marketplace_format))
        return format as Marketplace_format;
    fail(
        `Invalid format "${format}".\n`
        +'  Allowed formats: json, jsonl, csv.\n'
        +'  (ndjson is a pipelines format; the marketplace API does not '
        +'accept it.)'
    );
    return 'json';
};

// gd_ id -> used as-is; curated alias -> its id; anything else -> fail with a
// pointer. There is deliberately no lookup against the catalogue's `name`
// field: it is a display string, not an identifier, and 43 names are shared
// across ids, so a "match" could not identify one dataset anyway.
const resolve_dataset_id = (opts: Marketplace_opts): string|undefined=>{
    if (opts.dataset && opts.datasetId)
    {
        fail('Provide either --dataset or --dataset-id, not both.');
        return undefined;
    }
    if (opts.datasetId)
        return opts.datasetId.trim();
    const ref = opts.dataset?.trim();
    if (!ref)
    {
        fail(
            'No dataset specified.\n'
            +'  Use --dataset <name> (see \'brightdata marketplace list '
            +'--featured\')\n'
            +'  or --dataset-id <gd_...> for any other dataset.'
        );
        return undefined;
    }
    if (ref.startsWith('gd_'))
        return ref;
    const featured = FEATURED_DATASETS[ref.toLowerCase()];
    if (featured)
        return featured;
    fail(
        `Unknown dataset "${ref}".\n`
        +'  Named datasets: brightdata marketplace list --featured\n'
        +`  Anything else:  brightdata marketplace list --search ${ref}\n`
        +'                  then pass its id with --dataset-id <gd_...>'
    );
    return undefined;
};

const parse_records_limit = (raw: string|undefined): number|undefined=>{
    // Required, unlike the API, which treats it as optional. Omitting it means
    // "no cap" on datasets holding hundreds of millions of records, and cost
    // is only observable after the query is committed — so there is no way to
    // undo an accidentally huge query, and no way to preview its price.
    if (raw === undefined)
    {
        fail(
            '--records-limit is required.\n'
            +'  Marketplace queries are billed by records returned, and some '
            +'datasets\n'
            +'  hold hundreds of millions. Pass an explicit cap, e.g. '
            +'--records-limit 1000.'
        );
        return undefined;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0)
    {
        fail(
            `Invalid --records-limit "${raw}".\n`
            +'  Use a positive integer.'
        );
        return undefined;
    }
    return value;
};

const load_filter = (opts: Marketplace_opts): unknown|undefined=>{
    if (opts.filter !== undefined && opts.filterFile !== undefined)
    {
        fail('Provide either --filter or --filter-file, not both.');
        return undefined;
    }
    let text: string;
    if (opts.filterFile !== undefined)
    {
        try {
            text = fs.readFileSync(opts.filterFile, 'utf8');
        } catch(e) {
            fail(
                `Cannot read filter file "${opts.filterFile}": `
                +`${(e as Error).message}`
            );
            return undefined;
        }
    }
    else if (opts.filter !== undefined)
        text = opts.filter;
    else
    {
        fail(
            'No filter provided.\n'
            +'  Pass --filter \'<json>\' or --filter-file <path>.\n'
            +'  Example: --filter \'{"name":"industry","operator":"=",'
            +'"value":"Technology"}\''
        );
        return undefined;
    }
    const trimmed = text.trim();
    if (!trimmed)
    {
        fail('Filter is empty.');
        return undefined;
    }
    try {
        return JSON.parse(trimmed) as unknown;
    } catch(e) {
        fail(
            `Invalid JSON in filter: ${(e as Error).message}\n`
            +'  The filter is a JSON object, e.g. '
            +'{"name":"followers","operator":">","value":10000}'
        );
        return undefined;
    }
};

const DESCRIPTION_WIDTH = 68;

const truncate = (text: string|undefined): string=>{
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= DESCRIPTION_WIDTH)
        return clean;
    return clean.slice(0, DESCRIPTION_WIDTH-1)+'…';
};

const NO_RECORDS_CODE = 'no_records_found';

// The API reports a zero-match query as status:failed with warning_code
// no_records_found. That is a successful query with an empty result, not a
// failure, and it is reported as such (exit 0) — consistent with how
// `marketplace list --search` reports finding nothing.
const is_empty_result = (snap: Snapshot_status): boolean=>
    snap.warning_code == NO_RECORDS_CODE;

const snapshot_error = (snap: Snapshot_status): string=>
    snap.error || snap.error_message || snap.failure_reason || snap.warning
    || snap.message || 'no reason returned by the API';

const handle_list = async(opts: Marketplace_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner('Fetching dataset catalogue...');
    try {
        const all = await get<Dataset_info[]>(api_key, LIST_ENDPOINT,
            {timing: opts.timing});
        spinner.stop();
        let rows = Array.isArray(all) ? all : [];
        if (opts.featured)
        {
            const ids = new Set(Object.values(FEATURED_DATASETS));
            rows = rows.filter(d=>ids.has(d.id));
        }
        if (opts.search)
        {
            const needle = opts.search.toLowerCase();
            rows = rows.filter(d=>
                (d.name ?? '').toLowerCase().includes(needle)
                || d.id.toLowerCase().includes(needle));
        }
        if (!rows.length)
        {
            info(opts.search
                ? `No datasets match "${opts.search}".`
                : 'No datasets returned.');
            return;
        }
        if (opts.json || opts.pretty || opts.output)
        {
            print(rows, {
                json: opts.json,
                pretty: opts.pretty,
                output: opts.output,
            });
            return;
        }
        // Names carry stray whitespace in the catalogue; trim for display only.
        print_table(rows.map(d=>({
            name: (d.name ?? '').trim(),
            id: d.id,
            records: d.size === undefined ? '' : d.size.toLocaleString(),
        })), ['name', 'id', 'records']);
        if (rows.length > LIST_WARN_THRESHOLD)
        {
            info(`${rows.length} datasets listed. Narrow with --search <text>, `
                +'or use --featured for the named shortcuts.');
        }
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
    }
};

const handle_fields = async(dataset: string, opts: Marketplace_opts)=>{
    const dataset_id = resolve_dataset_id({...opts, dataset});
    if (!dataset_id)
        return;
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner(`Fetching fields for ${dataset_id}...`);
    try {
        const meta = await get<Dataset_metadata>(
            api_key, metadata_endpoint(dataset_id), {timing: opts.timing});
        spinner.stop();
        const fields = meta?.fields ?? {};
        const names = Object.keys(fields);
        if (!names.length)
        {
            info(`No fields reported for ${dataset_id}.`);
            return;
        }
        if (opts.json || opts.pretty || opts.output)
        {
            print(meta, {
                json: opts.json,
                pretty: opts.pretty,
                output: opts.output,
            });
            return;
        }
        print_table(names.sort().map(name=>({
            field: name,
            type: fields[name]?.type ?? '',
            required: fields[name]?.required ? 'yes' : '',
            // Descriptions run to several hundred characters; the table is for
            // scanning. --json gives the untruncated text.
            description: truncate(fields[name]?.description),
        })), ['field', 'type', 'required', 'description']);
        info(`${names.length} fields — any of them can be used in a filter.`);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
    }
};

const fetch_snapshot_status = (
    api_key: string,
    snapshot_id: string,
    timing: boolean|undefined
): Promise<Snapshot_status>=>
    get<Snapshot_status>(api_key, snapshot_endpoint(snapshot_id), {timing});

const print_snapshot_summary = (snap: Snapshot_status)=>{
    const bits: string[] = [];
    if (snap.dataset_size !== undefined)
        bits.push(`${snap.dataset_size.toLocaleString()} records`);
    if (snap.file_size !== undefined)
        bits.push(`${(snap.file_size/1024/1024).toFixed(2)} MB`);
    if (snap.cost !== undefined)
        bits.push(`cost ${snap.cost}`);
    if (bits.length)
        info(bits.join(' · '));
};

// Waits for a snapshot to leave scheduled/building, then hands back the final
// status. Note the 1s cadence: poll_until counts attempts rather than elapsed
// time, so timeout_seconds only means seconds while the interval stays 1s.
// (PR #20 upstream converts that loop to a wall-clock deadline; once it lands,
// this can move to the SDK's gentler 5s pacing without changing --timeout.)
const wait_for_snapshot = async(
    api_key: string,
    snapshot_id: string,
    timeout: number,
    opts: Marketplace_opts
): Promise<Snapshot_status>=>{
    const poll_result = await poll_until<Snapshot_status>({
        timeout_seconds: timeout,
        fetch_once: ()=>fetch_snapshot_status(api_key, snapshot_id,
            opts.timing),
        get_status: snap=>snap.status,
        running_statuses: RUNNING_STATUSES,
        timeout_label: `snapshot ${snapshot_id}`,
        on_running: ({attempt, timeout_seconds, status})=>{
            console.error(dim(
                `Status: ${status} - polling again `
                +`(attempt ${attempt}/${timeout_seconds})`
            ));
        },
    });
    return poll_result.result;
};

const download_snapshot = async(
    api_key: string,
    snapshot_id: string,
    format: Marketplace_format,
    opts: Marketplace_opts
)=>{
    const endpoint = `${download_endpoint(snapshot_id)}?format=${format}`;
    // csv/jsonl must reach the user byte-for-byte. They cannot go through the
    // client's JSON path: it selects it with content_type.includes(
    // 'application/json'), which is also true for the 'application/jsonl' this
    // endpoint returns — so a JSONL body would be parsed into an object and
    // re-serialised as indented JSON. raw_buffer bypasses that entirely.
    const data = format == 'json'
        ? await get<unknown>(api_key, endpoint, {timing: opts.timing})
        : (await get<Buffer>(api_key, endpoint,
            {timing: opts.timing, raw_buffer: true})).toString('utf8');
    // An empty result is a normal outcome of a filter query and must be said
    // out loud — otherwise it is indistinguishable from a silent failure.
    const empty = data === undefined || data === null || data === ''
        || (Array.isArray(data) && !data.length);
    if (empty)
    {
        info('No records in this snapshot (the filter matched nothing).');
        return;
    }
    print(data, {
        json: opts.json,
        pretty: opts.pretty,
        output: opts.output,
    });
};

const handle_status = async(snapshot_id: string, opts: Marketplace_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const spinner = start_spinner(`Checking snapshot "${snapshot_id}"...`);
    let snap: Snapshot_status;
    // The try covers only the request: a failed *snapshot* is a verdict to
    // report, not an exception to swallow.
    try {
        snap = await fetch_snapshot_status(api_key, snapshot_id, opts.timing);
        spinner.stop();
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
        return;
    }
    if (opts.json || opts.pretty || opts.output)
    {
        print(snap, {
            json: opts.json,
            pretty: opts.pretty,
            output: opts.output,
        });
        return;
    }
    info(`Status: ${snap.status ?? 'unknown'}`);
    print_snapshot_summary(snap);
    if (snap.status == FAILED_STATUS && is_empty_result(snap))
    {
        info('The filter matched no records.');
        return;
    }
    if (snap.status == FAILED_STATUS)
        fail(`Snapshot ${snapshot_id} failed: ${snapshot_error(snap)}`);
};

const handle_download = async(snapshot_id: string, opts: Marketplace_opts)=>{
    const format = resolve_format(opts.format);
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const spinner = start_spinner(`Fetching snapshot "${snapshot_id}"...`);
    let snap: Snapshot_status;
    try {
        snap = await fetch_snapshot_status(api_key, snapshot_id, opts.timing);
        spinner.stop();
        const running = !!snap.status && RUNNING_STATUSES.includes(snap.status);
        if (running && !opts.wait)
        {
            info(`Snapshot "${snapshot_id}" is not ready yet `
                +`(status: ${snap.status}).`);
            info('Re-run with --wait, or check it with: '
                +`brightdata marketplace status ${snapshot_id}`);
            // 3 = not ready (retryable), distinct from 1 = error.
            process.exit(EXIT.NOT_READY);
            return;
        }
        if (running)
            snap = await wait_for_snapshot(api_key, snapshot_id, timeout, opts);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
        return;
    }
    // A failed snapshot is a verdict, reported outside the request try/catch.
    if (snap.status == FAILED_STATUS && is_empty_result(snap))
    {
        info('The filter matched no records — nothing to download.');
        return;
    }
    if (snap.status == FAILED_STATUS)
    {
        fail(`Snapshot ${snapshot_id} failed: ${snapshot_error(snap)}`);
        return;
    }
    print_snapshot_summary(snap);
    try {
        await download_snapshot(api_key, snapshot_id, format, opts);
    } catch(e) {
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
    }
};

const handle_filter = async(opts: Marketplace_opts)=>{
    const dataset_id = resolve_dataset_id(opts);
    if (!dataset_id)
        return;
    const filter = load_filter(opts);
    if (filter === undefined)
        return;
    const records_limit = parse_records_limit(opts.recordsLimit);
    if (records_limit === undefined)
        return;
    const format = resolve_format(opts.format);
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const body: Filter_request = {dataset_id, filter, records_limit};
    const spinner = start_spinner(`Filtering ${dataset_id}...`);
    // Each try wraps one request only; verdicts about the result are reported
    // after it, so the handler's own catch cannot swallow them.
    let res: Filter_response;
    try {
        res = await post<Filter_response>(api_key, FILTER_ENDPOINT, body,
            {timing: opts.timing});
        spinner.stop();
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
        return;
    }
    const snapshot_id = res?.snapshot_id;
    if (!snapshot_id)
    {
        fail(
            'Failed to create snapshot: '
            +(res?.error || res?.message || res?.failure_reason
                || 'no snapshot_id in response')
        );
        return;
    }
    if (opts.async)
    {
        success(`Filter submitted. Snapshot ID: ${snapshot_id}`);
        info(`Check it with:       brightdata marketplace status `
            +`${snapshot_id}`);
        info('Download when ready: brightdata marketplace download '
            +`${snapshot_id} --wait`);
        return;
    }
    console.error(dim(`Created snapshot ${snapshot_id}`));
    let snap: Snapshot_status;
    try {
        snap = await wait_for_snapshot(api_key, snapshot_id, timeout, opts);
    } catch(e) {
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
        return;
    }
    if (snap.status == FAILED_STATUS && is_empty_result(snap))
    {
        info('The filter matched no records.');
        return;
    }
    if (snap.status == FAILED_STATUS)
    {
        fail(`Snapshot ${snapshot_id} failed: ${snapshot_error(snap)}`);
        return;
    }
    print_snapshot_summary(snap);
    try {
        await download_snapshot(api_key, snapshot_id, format, opts);
    } catch(e) {
        console.error((e as Error).message);
        process.exit(EXIT.ERROR);
    }
};

const list_command = new Command('list')
    .description('List datasets in the marketplace catalogue')
    .option('--featured', 'Only the datasets with named shortcuts')
    .option('--search <text>', 'Filter by text in the name or id')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_list);

const fields_command = new Command('fields')
    .description('Show a dataset\'s filterable fields and their types')
    .argument('<dataset>', 'Dataset name (see list --featured) or gd_ id')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_fields);

const filter_command = new Command('filter')
    .description('Query a dataset and download the matching records')
    .option('--dataset <name>',
        'Dataset name (see \'marketplace list --featured\')')
    .option('--dataset-id <id>', 'Raw dataset id (gd_...), for any dataset')
    .option('--filter <json>', 'Filter tree as inline JSON')
    .option('--filter-file <path>', 'Filter tree from a JSON file')
    .option('--records-limit <n>',
        'Maximum records to return (REQUIRED — queries are billed '
        +'by records)')
    .option('--format <fmt>', 'Result format: json, jsonl, csv (default: json)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds '
        +'(default: 600 or BRIGHTDATA_POLLING_TIMEOUT)')
    .option('--async', 'Submit only; print the snapshot ID and exit')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_filter);

const status_command = new Command('status')
    .description('Check a marketplace snapshot (status, records, size, cost)')
    .argument('<snapshot-id>', 'Snapshot ID returned by marketplace filter')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_status);

const download_command = new Command('download')
    .description(
        'Download a marketplace snapshot '
        +'(exit codes: 0 data, 1 error, 3 not ready yet)'
    )
    .argument('<snapshot-id>', 'Snapshot ID returned by marketplace filter')
    .option('--wait', 'Poll until the snapshot is ready, then download')
    .option('--format <fmt>', 'Result format: json, jsonl, csv (default: json)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds with --wait '
        +'(default: 600 or BRIGHTDATA_POLLING_TIMEOUT)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .action(handle_download);

const marketplace_command = new Command('marketplace')
    .description(
        'Query Bright Data\'s pre-collected datasets '
        +'(pipelines collects new data; this queries data that already exists)'
    )
    .addCommand(list_command)
    .addCommand(fields_command)
    .addCommand(filter_command)
    .addCommand(status_command)
    .addCommand(download_command);

add_examples(marketplace_command, [
    {
        description: 'See the datasets that have named shortcuts',
        command: 'brightdata marketplace list --featured',
    },
    {
        description: 'Find any other dataset in the catalogue',
        command: 'brightdata marketplace list --search zillow',
    },
    {
        description: 'Inspect what you can filter on before spending anything',
        command: 'brightdata marketplace fields linkedin_people_profiles',
    },
    {
        description: 'Query a dataset (a record cap is always required)',
        command: 'brightdata marketplace filter '
            +'--dataset linkedin_company_profiles '
            +'--filter \'{"name":"industry","operator":"=",'
            +'"value":"Technology"}\' --records-limit 1000 '
            +'--format jsonl -o tech.jsonl',
    },
    {
        description: 'Submit now, collect later',
        command: 'brightdata marketplace filter --dataset x_twitter_posts '
            +'--filter \'{"name":"likes","operator":">","value":10000}\' '
            +'--records-limit 500 --async',
    },
]);

export {marketplace_command, handle_list, handle_fields, handle_filter,
    handle_status, handle_download, resolve_dataset_id, FEATURED_DATASETS};
