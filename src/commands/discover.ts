import {Command} from 'commander';
import {post, get} from '../utils/client';
import {ensure_authenticated} from '../utils/auth';
import {start as start_spinner} from '../utils/spinner';
import {parse_timeout, poll_until} from '../utils/polling';
import {print, print_table, dim, fail, is_tty} from '../utils/output';
import type {
    Discover_request,
    Discover_trigger_response,
    Discover_result,
    Discover_poll_response,
    Discover_opts,
} from '../types/discover';

const ENDPOINT = '/discover';
const RUNNING_STATUSES = ['processing'];

const build_request = (query: string, opts: Discover_opts): Discover_request=>{
    const req: Discover_request = {query};
    if (opts.intent)
        req.intent = opts.intent;
    if (opts.city)
        req.city = opts.city;
    if (opts.country)
        req.country = opts.country;
    if (opts.language)
        req.language = opts.language;
    if (opts.numResults)
        req.num_results = +opts.numResults;
    if (opts.filterKeywords)
        req.filter_keywords = opts.filterKeywords.split(',').map(k=>k.trim());
    if (opts.includeContent)
    {
        req.include_content = true;
    }
    if (opts.removeDuplicates === false)
        req.remove_duplicates = false;
    if (opts.startDate)
        req.start_date = opts.startDate;
    if (opts.endDate)
        req.end_date = opts.endDate;
    return req;
};

const format_markdown = (
    results: Discover_result[],
    query: string
): string=>{
    const lines: string[] = [];
    lines.push(`# Discover results for "${query}"`);
    lines.push(`_${results.length} results_`);
    lines.push('');
    for (let i=0; i<results.length; i++)
    {
        const r = results[i];
        const score = (r.relevance_score * 100).toFixed(1);
        lines.push(`**${i+1}. [${r.title}](${r.link})** (${score}%)`);
        if (r.description)
            lines.push(r.description);
        lines.push(`<${r.link}>`);
        if (r.content)
        {
            lines.push('');
            lines.push(r.content);
        }
        lines.push('');
    }
    return lines.join('\n');
};

const print_discover_table = (results: Discover_result[])=>{
    if (!results.length)
    {
        console.log(dim('No results found.'));
        return;
    }
    const rows = results.map((r, i)=>({
        '#':    String(i+1),
        title:  (r.title ?? '').slice(0, 50),
        score:  (r.relevance_score * 100).toFixed(1)+'%',
        url:    (r.link ?? '').slice(0, 60),
    }));
    print_table(rows, ['#', 'title', 'score', 'url']);
};

const extract_status = (result: Discover_poll_response): string|undefined=>{
    if (!result || typeof result != 'object')
        return undefined;
    return result.status;
};

const handle_discover = async(query: string, opts: Discover_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    let timeout = 600;
    try {
        timeout = parse_timeout(opts.timeout);
    } catch(e) {
        fail((e as Error).message);
        return;
    }
    const body = build_request(query, opts);
    const spinner = start_spinner(`Discovering results for "${query}"...`);
    try {
        const trigger = await post<Discover_trigger_response>(
            api_key,
            ENDPOINT,
            body,
            {timing: opts.timing}
        );
        const task_id = trigger.task_id;
        if (!task_id)
        {
            spinner.stop();
            fail('Failed to trigger discover (missing task_id).');
            return;
        }
        spinner.stop();
        console.error(dim(`Task submitted: ${task_id}`));
        const poll_spinner = start_spinner('Waiting for results...');
        const poll_result = await poll_until<Discover_poll_response>({
            timeout_seconds: timeout,
            fetch_once: ()=>get<Discover_poll_response>(
                api_key,
                `${ENDPOINT}?task_id=${task_id}`,
                {timing: opts.timing}
            ),
            get_status: extract_status,
            running_statuses: RUNNING_STATUSES,
            timeout_label: 'discover results',
            on_running: ({attempt, timeout_seconds, status})=>{
                console.error(dim(
                    `Status: ${status} — polling `
                    +`(attempt ${attempt}/${timeout_seconds})`
                ));
            },
        });
        poll_spinner.stop();
        const response = poll_result.result;
        const results = response.results ?? [];
        if (response.duration_seconds != null)
        {
            console.error(dim(
                `Done in ${response.duration_seconds}s `
                +`(${poll_result.attempts} poll attempts)`
            ));
        }
        const print_opts = {json: opts.json, pretty: opts.pretty,
            output: opts.output};
        if (opts.json || opts.pretty || opts.output || !is_tty)
        {
            print(response, print_opts);
            return;
        }
        print_discover_table(results);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const discover_command = new Command('discover')
    .description('Search and rank web results using AI-driven intent')
    .argument('<query>', 'Search query')
    .option('--intent <text>',
        'AI intent to evaluate and rank result relevance')
    .option('--country <code>',
        'ISO country code for localized results (default: US)')
    .option('--city <name>', 'City for localized results (e.g. "New York")')
    .option('--language <code>', 'Language code (default: en)')
    .option('--num-results <n>', 'Number of results to return')
    .option('--filter-keywords <words>',
        'Comma-separated keywords that must appear in results')
    .option('--include-content', 'Include page content in markdown format')
    .option('--no-remove-duplicates', 'Keep duplicate results')
    .option('--start-date <date>', 'Only content updated from date (YYYY-MM-DD)')
    .option('--end-date <date>', 'Only content updated until date (YYYY-MM-DD)')
    .option('--timeout <seconds>',
        'Polling timeout in seconds (default: 600)')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_discover);

export {discover_command, handle_discover, build_request, extract_status,
    format_markdown, print_discover_table};
