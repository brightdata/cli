import {Command} from 'commander';
import {post} from '../utils/client';
import {ensure_authenticated} from '../utils/auth';
import {resolve} from '../utils/config';
import {start as start_spinner} from '../utils/spinner';
import {print, print_table, fail, dim} from '../utils/output';
import type {
    Search_engine,
    Search_type,
    Search_response,
    Search_opts,
} from '../types/search';

const ENDPOINT = '/request';

const ENGINE_URLS: Record<Search_engine, string> = {
    google: 'https://www.google.com/search',
    bing:   'https://www.bing.com/search',
    yandex: 'https://www.yandex.com/search',
};

const SEARCH_TYPE_PARAMS: Record<string, string> = {
    news:     'tbm=nws',
    images:   'tbm=isch',
    shopping: 'udm=28',
};

const build_url = (
    query: string,
    engine: Search_engine,
    opts: Search_opts,
    parsed_json: boolean
): string=>{
    const base = ENGINE_URLS[engine];
    const params = new URLSearchParams();
    params.set('q', query);
    if (parsed_json)
        params.set('brd_json', '1');
    if (opts.country)
    {
        if (engine == 'google')
            params.set('gl', opts.country);
        else if (engine == 'bing')
            params.set('cc', opts.country);
    }
    if (opts.language)
    {
        if (engine == 'google')
            params.set('hl', opts.language);
        else if (engine == 'bing')
            params.set('setLang', opts.language);
    }
    if (opts.page)
    {
        const page_num = +opts.page;
        if (engine == 'google')
            params.set('start', String(page_num * 10));
        else if (engine == 'bing')
            params.set('first', String(page_num * 10 + 1));
    }
    if (opts.device == 'mobile')
        params.set('brd_mobile', '1');
    const search_type = opts.type as Search_type;
    if (search_type && search_type != 'web')
    {
        const type_param = SEARCH_TYPE_PARAMS[search_type];
        if (type_param)
        {
            const [key, val] = type_param.split('=');
            params.set(key, val);
        }
    }
    return `${base}?${params.toString()}`;
};

const format_markdown = (data: Search_response, query: string): string=>{
    const lines: string[] = [];
    const engine = data.general?.search_engine ?? 'search';
    const cnt = data.general?.results_cnt;
    lines.push(`# ${engine} results for "${query}"`);
    if (cnt)
        lines.push(`_About ${cnt.toLocaleString()} results_`);
    lines.push('');
    if (data.organic?.length)
    {
        lines.push('## Organic Results');
        lines.push('');
        for (let i=0; i<data.organic.length; i++)
        {
            const r = data.organic[i];
            lines.push(`**${r.rank ?? i+1}. [${r.title}](${r.link})**`);
            if (r.description)
                lines.push(r.description);
            lines.push(`<${r.link}>`);
            lines.push('');
        }
    }
    if (data.people_also_ask?.length)
    {
        lines.push('## People Also Ask');
        lines.push('');
        for (const item of data.people_also_ask as Array<{question?: string}>)
        {
            if (item.question)
                lines.push(`- ${item.question}`);
        }
        lines.push('');
    }
    if (data.related_searches?.length)
    {
        lines.push('## Related Searches');
        lines.push('');
        for (const item of data.related_searches as Array<{query?: string}>)
        {
            if (item.query)
                lines.push(`- ${item.query}`);
        }
        lines.push('');
    }
    return lines.join('\n');
};

const print_news_table = (data: Search_response)=>{
    const news = data.news ?? [];
    if (!news.length)
    {
        console.log(dim('No news results found.'));
        return;
    }
    const rows = news.map(r=>({
        rank:   String(r.global_rank ?? ''),
        title:  (r.title ?? '').slice(0, 50),
        source: (r.source ?? '').slice(0, 20),
        date:   (r.date ?? '').slice(0, 20),
        url:    (r.link ?? '').slice(0, 60),
    }));
    print_table(rows, ['rank', 'title', 'source', 'date', 'url']);
};

const print_shopping_table = (data: Search_response)=>{
    const shopping = data.shopping ?? [];
    if (!shopping.length)
    {
        console.log(dim('No shopping results found.'));
        return;
    }
    const rows = shopping.map(r=>({
        rank:   String(r.rank ?? ''),
        title:  (r.title ?? '').slice(0, 40),
        price:  (r.price ?? ''),
        shop:   (r.shop ?? '').slice(0, 20),
        rating: r.rating ? String(r.rating) : '',
        url:    (r.link ?? '').slice(0, 60),
    }));
    print_table(rows, ['rank', 'title', 'price', 'shop', 'rating', 'url']);
};

const print_images_table = (data: Search_response)=>{
    const images = data.images ?? [];
    if (!images.length)
    {
        console.log(dim('No image results found.'));
        return;
    }
    const rows = images.map((r, i)=>({
        '#':     String(i+1),
        title:   (r.title ?? '').slice(0, 40),
        source:  (r.source ?? '').slice(0, 20),
        image:   (r.original_image ?? '').slice(0, 60),
    }));
    print_table(rows, ['#', 'title', 'source', 'image']);
};

const print_google_table = (data: Search_response)=>{
    const organic = data.organic ?? [];
    if (!organic.length)
    {
        console.log(dim('No organic results found.'));
        return;
    }
    const rows = organic.map(r=>({
        rank:        String(r.rank ?? ''),
        title:       (r.title ?? '').slice(0, 50),
        url:         (r.link ?? '').slice(0, 60),
        description: (r.description ?? '').slice(0, 80),
    }));
    print_table(rows, ['rank', 'title', 'url', 'description']);
};

const handle_search = async(query: string, opts: Search_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey);
    const zone = resolve(opts.zone, 'BRIGHTDATA_SERP_ZONE', 
            'default_zone_serp')
        ?? resolve(opts.zone, 'BRIGHTDATA_UNLOCKER_ZONE', 
            'default_zone_unlocker');
    if (!zone)
    {
        fail(
            'No zone specified.\n'
            +'  Use --zone <name>, set BRIGHTDATA_SERP_ZONE '
            +'or BRIGHTDATA_UNLOCKER_ZONE env variable.\n'
            +'  Run \'brightdata config set default_zone_serp <name>\' '
            +'or \'brightdata config set default_zone_unlocker <name>\' '
            +'to set a default.'
        );
        return;
    }
    const engine = (opts.engine ?? 'google') as Search_engine;
    // google default: parsed JSON (table/json output); others: raw markdown
    const google_json = engine == 'google' && !opts.json && !opts.pretty;
    const search_url = build_url(query, engine, opts, google_json ||
         !!opts.json || !!opts.pretty);
    const body = {zone, url: search_url, format: 'raw'};
    const spinner = start_spinner(`Searching ${engine} for "${query}"...`);
    try {
        const result = await post<Search_response|string>(
            api_key,
            ENDPOINT,
            body,
            {timing: opts.timing}
        );
        spinner.stop();
        const print_opts = {json: opts.json, pretty: opts.pretty, 
            output: opts.output};
        if (engine != 'google')
        {
            if (opts.json || opts.pretty)
            {
                print(result, print_opts);
                return;
            }
            print(result as string, print_opts);
            return;
        }
        if (opts.output && !opts.json && !opts.pretty)
        {
            print(format_markdown(result as Search_response, query), 
                print_opts);
            return;
        }
        if (opts.json || opts.pretty)
        {
            print(result, print_opts);
            return;
        }
        if (opts.type == 'news')
            print_news_table(result as Search_response);
        else if (opts.type == 'images')
            print_images_table(result as Search_response);
        else if (opts.type == 'shopping')
            print_shopping_table(result as Search_response);
        else
            print_google_table(result as Search_response);
    } catch(e) {
        spinner.stop();
        console.error((e as Error).message);
        process.exit(1);
    }
};

const search_command = new Command('search')
    .description('Search the web using the SERP API')
    .argument('<query>', 'Search query')
    .option('--engine <name>',
        'Search engine: google, bing, yandex (default: google)')
    .option('--country <code>',
        'Country code for localized results (e.g. us, de)')
    .option('--language <code>',
        'Language code (e.g. en, fr)')
    .option('--page <n>',
        'Results page number, 0-indexed (default: 0)', '0')
    .option('--type <type>',
        'Search type: web, news, images, shopping (default: web)')
    .option('--zone <name>', 'SERP zone name')
    .option('--device <type>', 'Device type: desktop, mobile')
    .option('-o, --output <path>', 'Write output to file')
    .option('--json', 'Force JSON output')
    .option('--pretty', 'Pretty-print JSON output')
    .option('--timing', 'Show request timing')
    .option('-k, --api-key <key>', 'Override API key')
    .action(handle_search);

export {search_command, handle_search};
