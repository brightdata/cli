import {Command} from 'commander';
import {post} from '../utils/client';
import {ensure_authenticated} from '../utils/auth';
import {resolve} from '../utils/config';
import {start as start_spinner} from '../utils/spinner';
import {print, success, fail} from '../utils/output';
import type {
    Scrape_format,
    Scrape_request,
    Scrape_response_json,
    Scrape_async_response,
    Scrape_opts,
} from '../types/scrape';

const ENDPOINT = '/request';

const build_request = (
    url: string,
    zone: string,
    fmt: Scrape_format,
    opts: Scrape_opts
): Scrape_request=>{
    const req: Scrape_request = {
        zone,
        url,
        format: 'raw',
    };
    if (fmt == 'markdown')
        req.data_format = 'markdown';
    else if (fmt == 'screenshot')
        req.data_format = 'screenshot';
    else if (fmt == 'json')
        req.format = 'json';
    if (opts.country)
        req.country = opts.country;
    if (opts.async)
        req.async = true;
    return req;
};

const handle_scrape = async(url: string, opts: Scrape_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const zone = resolve(opts.zone, 'BRIGHTDATA_UNLOCKER_ZONE', 'default_zone_unlocker');
    if (!zone)
    {
        fail(
            'No Web Unlocker zone specified.\n'
            +'  Use --zone <name> or set BRIGHTDATA_UNLOCKER_ZONE env variable.\n'
            +'  Run \'brightdata config set default_zone_unlocker <name>\' to set a default.'
        );
        return;
    }
    const fmt: Scrape_format = (opts.format as Scrape_format) ?? 'markdown';
    const req = build_request(url, zone, fmt, opts);
    const spinner = start_spinner(`Scraping ${url}...`);
    try {
        const result = await post<string|Scrape_response_json|Scrape_async_response>(
            api_key,
            ENDPOINT,
            req,
            {timing: opts.timing}
        );
        spinner.stop();
        if (opts.async)
        {
            const async_res = result as Scrape_async_response;
            success(`Async job submitted. Response ID: ${async_res.response_id}`);
            return;
        }
        const print_opts = {json: opts.json, pretty: opts.pretty, output: opts.output};
        if (fmt == 'json')
        {
            const json_res = result as Scrape_response_json;
            print(json_res, print_opts);
            return;
        }
        print(result as string, print_opts);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const scrape_command = new Command('scrape')
    .description('Scrape a URL using the Web Unlocker API')
    .argument('<url>', 'URL to scrape')
    .option('-f, --format <format>',
        'Output format: markdown, html, screenshot, json (default: markdown)')
    .option('--country <code>', 'ISO country code for geo-targeting (e.g. us, de)')
    .option('--zone <name>', 'Web Unlocker zone name')
    .option('--mobile', 'Use mobile user agent')
    .option('--async', 'Submit asynchronously and return job ID')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_scrape);

export {scrape_command, handle_scrape};
