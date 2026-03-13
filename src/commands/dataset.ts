import {Command} from 'commander';
import {ensure_authenticated} from '../utils/auth';
import {get, post} from '../utils/client';
import {print, dim, fail} from '../utils/output';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import type {
    Webdata_format,
    Webdata_opts,
    Trigger_response,
    Snapshot_meta,
} from '../types/dataset';

const TRIGGER_ENDPOINT = '/datasets/v3/trigger';
const SNAPSHOT_ENDPOINT = '/datasets/v3/snapshot';
const RUNNING_STATUSES = ['starting', 'building', 'running'];

const DATASET_IDS = {
    amazon_product:            'gd_l7q7dkf244hwjntr0',
    amazon_product_reviews:    'gd_le8e811kzy4ggddlq',
    amazon_product_search:     'gd_lwdb4vjm1ehb499uxs',
    walmart_product:           'gd_l95fol7l1ru6rlo116',
    walmart_seller:            'gd_m7ke48w81ocyu4hhz0',
    ebay_product:              'gd_ltr9mjt81n0zzdk1fb',
    homedepot_products:        'gd_lmusivh019i7g97q2n',
    zara_products:             'gd_lct4vafw1tgx27d4o0',
    etsy_products:             'gd_ltppk0jdv1jqz25mz',
    bestbuy_products:          'gd_ltre1jqe1jfr7cccf',
    linkedin_person_profile:   'gd_l1viktl72bvl7bjuj0',
    linkedin_company_profile:  'gd_l1vikfnt1wgvvqz95w',
    linkedin_job_listings:     'gd_lpfll7v5hcqtkxl6l',
    linkedin_posts:            'gd_lyy3tktm25m4avu764',
    linkedin_people_search:    'gd_m8d03he47z8nwb5xc',
    crunchbase_company:        'gd_l1vijqt9jfj7olije',
    zoominfo_company_profile:  'gd_m0ci4a4ivx3j5l6nx',
    instagram_profiles:        'gd_l1vikfch901nx3by4',
    instagram_posts:           'gd_lk5ns7kz21pck8jpis',
    instagram_reels:           'gd_lyclm20il4r5helnj',
    instagram_comments:        'gd_ltppn085pokosxh13',
    facebook_posts:            'gd_lyclm1571iy3mv57zw',
    facebook_marketplace_listings: 'gd_lvt9iwuh6fbcwmx1a',
    facebook_company_reviews:  'gd_m0dtqpiu1mbcyc2g86',
    facebook_events:           'gd_m14sd0to1jz48ppm51',
    tiktok_profiles:           'gd_l1villgoiiidt09ci',
    tiktok_posts:              'gd_lu702nij2f790tmv9h',
    tiktok_shop:               'gd_m45m1u911dsa4274pi',
    tiktok_comments:           'gd_lkf2st302ap89utw5k',
    x_posts:                   'gd_lwxkxvnf1cynvib9co',
    youtube_profiles:          'gd_lk538t2k2p1k3oos71',
    youtube_videos:            'gd_lk56epmy2i5g7lzu0k',
    youtube_comments:          'gd_lk9q0ew71spt1mxywf',
    reddit_posts:              'gd_lvz8ah06191smkebj4',
    google_maps_reviews:       'gd_luzfs1dn2oa0teb81',
    google_shopping:           'gd_ltppk50q18kdw67omz',
    google_play_store:         'gd_lsk382l8xei8vzm4u',
    apple_app_store:           'gd_lsk9ki3u2iishmwrui',
    reuter_news:               'gd_lyptx9h74wtlvpnfu',
    github_repository_file:    'gd_lyrexgxc24b3d4imjt',
    yahoo_finance_business:    'gd_lmrpz3vxmz972ghd7',
    zillow_properties_listing: 'gd_lfqkr8wm13ixtbd8f5',
    booking_hotel_listings:    'gd_m5mbdl081229ln6t4a',
} as const;

type Dataset_type = keyof typeof DATASET_IDS;
type Webdata_input = Record<string, string>;

const ALLOWED_FORMATS: Webdata_format[] = ['json', 'csv', 'ndjson', 'jsonl'];

const strip_nulls = (data: unknown): unknown=>{
    if (data === null)
        return undefined;
    if (Array.isArray(data))
    {
        const cleaned: unknown[] = [];
        for (let i=0; i<data.length; i++)
        {
            const item = strip_nulls(data[i]);
            if (item !== undefined)
                cleaned.push(item);
        }
        return cleaned;
    }
    if (typeof data == 'object')
    {
        const cleaned: Record<string, unknown> = {};
        const entries = Object.entries(data as Record<string, unknown>);
        for (let i=0; i<entries.length; i++)
        {
            const [key, value] = entries[i];
            const item = strip_nulls(value);
            if (item !== undefined)
                cleaned[key] = item;
        }
        return cleaned;
    }
    return data;
};

const list_dataset_types = ()=>{
    const types = Object.keys(DATASET_IDS).sort();
    process.stdout.write(types.join('\n')+'\n');
};

const resolve_dataset_type = (dataset_type: string): Dataset_type|undefined=>{
    if (dataset_type in DATASET_IDS)
        return dataset_type as Dataset_type;
    return undefined;
};

const resolve_format = (raw_format: string|undefined): Webdata_format=>{
    const format = (raw_format ?? 'json').toLowerCase();
    if (ALLOWED_FORMATS.includes(format as Webdata_format))
        return format as Webdata_format;
    fail(
        `Invalid format "${format}".\n`
        +'  Allowed formats: json, csv, ndjson, jsonl.'
    );
    return 'json';
};

const build_input = (dataset_type: Dataset_type, 
    params: string[]): Webdata_input=>{
    if (dataset_type == 'amazon_product_search')
    {
        const keyword = params[0];
        const url = params[1];
        if (!keyword || !url)
        {
            fail(
                'Usage: brightdata pipelines amazon_product_search '
                +'<keyword> <domain_url>'
            );
            return {};
        }
        return {keyword, url, pages_to_search: '1'};
    }
    if (dataset_type == 'linkedin_people_search')
    {
        const url = params[0];
        const first_name = params[1];
        const last_name = params[2];
        if (!url || !first_name || !last_name)
        {
            fail(
                'Usage: brightdata pipelines linkedin_people_search '
                +'<url> <first_name> <last_name>'
            );
            return {};
        }
        return {url, first_name, last_name};
    }
    if (dataset_type == 'facebook_company_reviews')
    {
        const url = params[0];
        const num_of_reviews = params[1] ?? '10';
        if (!url)
        {
            fail('Usage: brightdata pipelines facebook_company_reviews <url> '
                +'[num_reviews]');
            return {};
        }
        return {url, num_of_reviews};
    }
    if (dataset_type == 'google_maps_reviews')
    {
        const url = params[0];
        const days_limit = params[1] ?? '3';
        if (!url)
        {
            fail('Usage: brightdata pipelines google_maps_reviews <url> '
                +'[days_limit]');
            return {};
        }
        return {url, days_limit};
    }
    if (dataset_type == 'youtube_comments')
    {
        const url = params[0];
        const num_of_comments = params[1] ?? '10';
        if (!url)
        {
            fail('Usage: brightdata pipelines youtube_comments <url> '
                +'[num_comments]');
            return {};
        }
        return {url, num_of_comments};
    }
    const url = params[0];
    if (!url)
    {
        fail(`Usage: brightdata pipelines ${dataset_type} <url>`);
        return {};
    }
    return {url};
};

const extract_status = (result: unknown): string|undefined=>{
    if (!result || typeof result != 'object')
        return undefined;
    const status = (result as Snapshot_meta).status;
    if (typeof status == 'string')
        return status;
    return undefined;
};

const handle_pipelines = async(
    dataset_type_raw: string,
    params: string[],
    opts: Webdata_opts
)=>{
    if (dataset_type_raw == 'list')
    {
        list_dataset_types();
        return;
    }
    const dataset_type = resolve_dataset_type(dataset_type_raw);
    if (!dataset_type)
    {
        fail(
            `Unknown pipeline type "${dataset_type_raw}".\n`
            +'  Run \'brightdata pipelines list\' to see available types.'
        );
        return;
    }
    const api_key = ensure_authenticated(opts.apiKey);
    const dataset_id = DATASET_IDS[dataset_type];
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const format = resolve_format(opts.format);
    const input = build_input(dataset_type, params);
    const spinner = start_spinner(
        `Triggering pipeline collection for ${dataset_type}...`
    );
    try {
        const endpoint = `${TRIGGER_ENDPOINT}?dataset_id=${dataset_id}`
            +'&include_errors=true';
        const trigger = await post<Trigger_response>(
            api_key,
            endpoint,
            [input],
            {timing: opts.timing}
        );
        spinner.stop();
        const snapshot_id = trigger.snapshot_id;
        if (!snapshot_id)
        {
            fail('Failed to trigger pipeline collection' +
                '(missing snapshot_id).');
            return;
        }
        console.error(dim(`Triggered collection with snapshot ID:` +
            `${snapshot_id}`));
        const poll_result = await poll_until<unknown>({
            timeout_seconds: timeout,
            fetch_once: ()=>{
                const endpoint = `${SNAPSHOT_ENDPOINT}/${snapshot_id}`
                    +`?format=${format}`;
                return get<unknown>(api_key, endpoint, {timing: opts.timing});
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
        const cleaned_result = format == 'json' ? strip_nulls(result) : result;
        print(cleaned_result, {
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

const pipelines_command = new Command('pipelines')
    .description('Extract structured data using Bright Data Pipelines')
    .argument('<type>', 'Pipeline type or "list"')
    .argument('[params...]', 'Type-specific input arguments')
    .option('--format <fmt>',
        'Result format: json, csv, ndjson, jsonl (default: json)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds' +
        '(default: 600 or BRIGHTDATA_POLLING_TIMEOUT)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_pipelines);

export {pipelines_command, handle_pipelines};
