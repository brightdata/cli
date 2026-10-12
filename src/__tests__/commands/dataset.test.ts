import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const mocks = vi.hoisted(()=>({
    ensure_authenticated: vi.fn(),
    search: vi.fn(),
    find: vi.fn(),
    get_details: vi.fn(),
    load_catalog: vi.fn(),
    trigger: vi.fn(),
    results: vi.fn(),
    wait_for_results: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
}));
vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));
vi.mock('../../utils/spinner', ()=>({start: ()=>({stop: vi.fn()})}));
vi.mock('../../utils/scraper_catalog', ()=>({
    create_scraper_catalog: ()=>({search: mocks.search, find: mocks.find,
        get_details: mocks.get_details, load_catalog: mocks.load_catalog}),
}));
vi.mock('../../utils/scraper_run', async import_original=>({
    ...await import_original<typeof import('../../utils/scraper_run')>(),
    trigger: mocks.trigger,
    results: mocks.results,
    wait_for_results: mocks.wait_for_results,
}));
vi.mock('../../utils/output', async import_original=>({
    ...await import_original<typeof import('../../utils/output')>(),
    fail: mocks.fail,
}));

import {Command} from 'commander';
import {
    handle_search,
    handle_info,
    handle_run,
    handle_results,
    handle_refresh,
    handle_removed_type,
    format_details,
} from '../../commands/dataset';

const entry = {dataset_id: 'gd_rev', name: 'Amazon Reviews',
    domain: 'amazon.com', collection_methods: ['collect_by_url',
        'discover_by_keyword']};
const details = {dataset_id: 'gd_rev', name: 'Amazon Reviews',
    domain: 'amazon.com', description: null, method: 'collect_by_url',
    source: 'api' as const,
    input_fields: [{name: 'url', type: 'url', required: true},
        {name: 'max_reviews', type: 'number', required: false}],
    output_fields: [], sample_input: [{url: 'https://amazon.com/dp/X'}],
    notes: []};
const headers = {'x-mcp-dataset-id': 'gd_rev',
    'x-mcp-method': 'collect_by_url'};

let stdout: string;
beforeEach(()=>{
    stdout = '';
    mocks.ensure_authenticated.mockReturnValue('key');
    mocks.find.mockResolvedValue(entry);
    mocks.get_details.mockResolvedValue(details);
    mocks.trigger.mockResolvedValue('s_1');
    mocks.wait_for_results.mockResolvedValue({snapshot_id: 's_1',
        status: 'ready', data: [{title: 'a'}]});
    vi.spyOn(process.stdout, 'write').mockImplementation(text=>{
        stdout += String(text);
        return true;
    });
    vi.spyOn(console, 'error').mockImplementation(()=>{});
});
afterEach(()=>{
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('commands/pipelines search, info, refresh', ()=>{
    it('search joins the words and prints JSON when piped', async()=>{
        mocks.search.mockResolvedValue([entry]);
        await handle_search(['amazon', 'reviews'], {limit: '5'});
        expect(mocks.search).toHaveBeenCalledWith('amazon reviews', 5);
        expect(JSON.parse(stdout)).toEqual([entry]);
    });
    it('search rejects a bad --limit', async()=>{
        await expect(handle_search(['x'], {limit: '99'}))
            .rejects.toThrow('--limit must be a whole number from 1 to 50');
    });
    it('info without a method lists the methods, no API call', async()=>{
        await handle_info('gd_rev', undefined, {});
        expect(JSON.parse(stdout)).toEqual(entry);
        expect(mocks.ensure_authenticated).not.toHaveBeenCalled();
    });
    it('info with a method prints the details', async()=>{
        await handle_info('gd_rev', 'collect_by_url', {});
        expect(mocks.get_details).toHaveBeenCalledWith('key', 'gd_rev',
            'collect_by_url');
        expect(JSON.parse(stdout).input_fields).toHaveLength(2);
    });
    it('details text shows flags and a runnable example', ()=>{
        const text = format_details(details);
        expect(text).toContain('  --url <url> (required)');
        expect(text).toContain('  --max_reviews <number>');
        expect(text).toContain('brightdata pipelines run gd_rev '
            +'collect_by_url --url https://amazon.com/dp/X');
    });
    it('refresh forces a reload', async()=>{
        mocks.load_catalog.mockResolvedValue([entry, entry]);
        await handle_refresh({});
        expect(mocks.load_catalog).toHaveBeenCalledWith({force: true});
        expect(JSON.parse(stdout)).toEqual({scrapers: 2});
    });
});

describe('commands/pipelines run', ()=>{
    it('builds records from URLs and flags, tags the calls', async()=>{
        await handle_run('gd_rev', 'collect_by_url',
            ['https://amazon.com/dp/X', '--max_reviews', '5'], {});
        expect(mocks.trigger).toHaveBeenCalledWith('key', {
            dataset_id: 'gd_rev', method: 'collect_by_url',
            input: [{url: 'https://amazon.com/dp/X', max_reviews: 5}],
            limit_per_input: 10}, {headers, timing: undefined});
        expect(mocks.wait_for_results).toHaveBeenCalledWith('key', 's_1',
            {format: 'json', timeout_seconds: 600, headers,
                timing: undefined});
        expect(JSON.parse(stdout)).toEqual([{title: 'a'}]);
    });
    it('validates flags before triggering', async()=>{
        await expect(handle_run('gd_rev', 'collect_by_url',
            ['--max_reviews', '5'], {}))
            .rejects.toThrow('Missing required field(s): --url');
        expect(mocks.trigger).not.toHaveBeenCalled();
    });
    it('--input skips the details call but checks the method', async()=>{
        await handle_run('gd_rev', 'discover_by_keyword', [],
            {input: '[{"keyword":"x"}]', limitPerInput: '50'});
        expect(mocks.get_details).not.toHaveBeenCalled();
        expect(mocks.trigger.mock.calls[0][1]).toMatchObject({
            input: [{keyword: 'x'}], limit_per_input: 50});
        await expect(handle_run('gd_rev', 'discover_by_nope', [],
            {input: '{}'})).rejects.toThrow('has no method discover_by_nope');
        await expect(handle_run('gd_rev', 'collect_by_url', ['u'],
            {input: '{}'})).rejects.toThrow('Use either --input');
    });
    it('--async prints the snapshot id and does not wait', async()=>{
        await handle_run('gd_rev', 'collect_by_url', ['https://a.com'],
            {async: true});
        expect(JSON.parse(stdout)).toEqual({snapshot_id: 's_1'});
        expect(mocks.wait_for_results).not.toHaveBeenCalled();
    });
    it('sanitizes CSV written to a file', async()=>{
        mocks.wait_for_results.mockResolvedValue({snapshot_id: 's_1',
            status: 'ready', data: 'name,value\nfoo,"=SUM(1,2)"\n'});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brightdata-'));
        const output = path.join(dir, 'result.csv');
        try {
            await handle_run('gd_rev', 'collect_by_url', ['https://a.com'],
                {format: 'csv', output});
            expect(fs.readFileSync(output, 'utf8')).toContain("'=SUM(1,2)");
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
    it('rejects a bad format before triggering', async()=>{
        await expect(handle_run('gd_rev', 'collect_by_url', ['u'],
            {format: 'xml'})).rejects.toThrow('Invalid format "xml"');
        expect(mocks.trigger).not.toHaveBeenCalled();
    });
});

describe('commands/pipelines results and old types', ()=>{
    it('results prints sanitized CSV to stdout', async()=>{
        mocks.results.mockResolvedValue({snapshot_id: 's_1',
            status: 'ready', data: 'name\n"=SUM(1,2)"\n'});
        await handle_results('s_1', {format: 'csv'});
        expect(mocks.results).toHaveBeenCalledWith('key', 's_1',
            {format: 'csv', timing: undefined});
        expect(stdout).toContain("'=SUM(1,2)");
    });
    it('results says when the run is not ready', async()=>{
        mocks.results.mockResolvedValue({snapshot_id: 's_1',
            status: 'running'});
        await expect(handle_results('s_1', {}))
            .rejects.toThrow('brightdata pipelines status s_1 --wait');
    });
    it('old type names point to search', ()=>{
        const cmd = new Command();
        expect(()=>handle_removed_type('amazon_product', [], {}, cmd))
            .toThrow('brightdata pipelines search amazon product');
        expect(()=>handle_removed_type('list', [], {}, cmd))
            .toThrow('brightdata pipelines search <site or data type>');
    });
});
