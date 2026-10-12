import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(()=>({get: vi.fn()}));
vi.mock('../../utils/client', ()=>({get: mocks.get}));

import {create_scraper_catalog} from '../../utils/scraper_catalog';

const DAY_MS = 24*60*60*1000;
const DOCS = 'http://docs.test';
const scrapers = [
    {dataset_id: 'gd_amz_prod', name: ' Amazon Products ',
        domain: 'amazon.com', collection_methods: ['collect_by_url']},
    {dataset_id: 'gd_amz_rev', name: 'Amazon Reviews', domain: 'amazon.com',
        collection_methods: ['collect_by_url', 'discover_by_keyword']},
    {dataset_id: 'gd_ebay', name: 'eBay Products', domain: 'ebay.com',
        collection_methods: ['collect_by_url']},
    {dataset_id: 'gd_jobs_a', name: 'Jobs', domain: 'a.com',
        collection_methods: ['collect_by_url']},
    {dataset_id: 'gd_jobs_b', name: 'Jobs', domain: 'b.com',
        collection_methods: ['discover_by_sietmap']},
];
const url_field = {name: 'url', type: 'url', required: true,
    description: 'Review URL'};
const details: Record<string, Record<string, unknown>> = {
    gd_amz_rev: {
        collect_by_url: {input_schema: [url_field],
            output_fields: [{name: 'rating', type: 'number',
                description: 'Star rating'}],
            sample_input: [{url: 'https://amazon.com/r/1'}]},
        discover_by_keyword: {
            input_schema: [{name: 'keyword', type: 'text', required: false}],
            output_fields: [], sample_input: []},
    },
    gd_jobs_b: {discover_by_sietmap: {input_schema: [], output_fields: [],
        sample_input: []}},
};

const state = {hits: 0, fail: false};
const json = (code: number, body: unknown)=>new Response(JSON.stringify(body),
    {status: code, headers: {'content-type': 'application/json'}});
const docs_fetch = async(url: string)=>{
    if (url == `${DOCS}/scrapers.json`)
    {
        state.hits++;
        return state.fail ? json(500, {}) : json(200, {scrapers});
    }
    const m = url.match(/\/scrapers\/(\w+)\.json$/);
    if (m && details[m[1]])
        return json(200, {collection_methods: details[m[1]]});
    return json(404, {});
};
const api_ok = ()=>mocks.get.mockImplementation(async(_k: string,
    endpoint: string)=>{
    const id = new URL(endpoint, 'http://x').searchParams.get('dataset_id')!;
    return details[id] ? [{id, description: `About ${id}`,
        scrapers: details[id]}] : [];
});

let dir: string;
let clock: {ms: number};
const make = ()=>create_scraper_catalog({docs_url: DOCS,
    cache_path: path.join(dir, 'scrapers.json'), now: ()=>clock.ms});
const ids = (list: {dataset_id: string}[])=>list.map(s=>s.dataset_id);

beforeEach(()=>{
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-catalog-'));
    clock = {ms: 1000};
    Object.assign(state, {hits: 0, fail: false});
    vi.stubGlobal('fetch', vi.fn(docs_fetch));
    vi.spyOn(console, 'error').mockImplementation(()=>{});
    api_ok();
});
afterEach(()=>{
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mocks.get.mockReset();
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('scraper_catalog search', ()=>{
    it('matches name, domain or id', async()=>{
        const c = make();
        expect(ids(await c.search('ebay products')))
            .toEqual(['gd_ebay', 'gd_amz_prod']);
        expect(ids(await c.search('EBAY.COM'))).toEqual(['gd_ebay']);
        expect(ids(await c.search('gd_amz_rev'))).toEqual(['gd_amz_rev']);
    });
    it('ignores ids unless the word starts with gd_', async()=>{
        const c = make();
        expect(await c.search('amz')).toEqual([]);
        expect(ids(await c.search('gd_amz')))
            .toEqual(['gd_amz_prod', 'gd_amz_rev']);
    });
    it('ranks by matched words, trims names, honours limit', async()=>{
        const c = make();
        const res = await c.search('amazon reviews');
        expect(ids(res)).toEqual(['gd_amz_rev', 'gd_amz_prod']);
        expect(res[1].name).toBe('Amazon Products');
        expect(await c.search('amazon', 1)).toHaveLength(1);
        expect(await c.search('nothing here')).toEqual([]);
    });
    it('returns both scrapers sharing a name', async()=>{
        expect(ids(await make().search('jobs')).sort())
            .toEqual(['gd_jobs_a', 'gd_jobs_b']);
    });
});

describe('scraper_catalog cache', ()=>{
    it('is shared between processes through the cache file', async()=>{
        await make().search('amazon');
        await make().search('ebay');
        expect(state.hits).toBe(1);
    });
    it('is refetched after the TTL', async()=>{
        await make().load_catalog();
        clock.ms += DAY_MS;
        await make().load_catalog();
        expect(state.hits).toBe(2);
    });
    it('force refetches', async()=>{
        const c = make();
        await c.load_catalog();
        await c.load_catalog({force: true});
        expect(state.hits).toBe(2);
    });
    it('failed refresh keeps serving the old catalog', async()=>{
        await make().load_catalog();
        state.fail = true;
        clock.ms += DAY_MS;
        expect(await make().load_catalog()).toHaveLength(scrapers.length);
        expect(state.hits).toBe(2);
    });
    it('failed forced refresh reaches the caller, cache stays', async()=>{
        await make().load_catalog();
        state.fail = true;
        await expect(make().load_catalog({force: true}))
            .rejects.toThrow(/HTTP 500/);
        expect(ids(await make().search('ebay'))).toEqual(['gd_ebay']);
    });
    it('failed first load reaches the caller', async()=>{
        state.fail = true;
        await expect(make().search('amazon')).rejects.toThrow(/HTTP 500/);
    });
    it('ignores a corrupt cache file', async()=>{
        fs.writeFileSync(path.join(dir, 'scrapers.json'), '{nope');
        expect(await make().load_catalog()).toHaveLength(scrapers.length);
    });
});

describe('scraper_catalog details', ()=>{
    it('come from the API with the example input', async()=>{
        const d = await make().get_details('k', 'gd_amz_rev',
            'collect_by_url');
        expect(mocks.get).toHaveBeenCalledWith('k',
            '/datasets/v3/scrapers?dataset_id=gd_amz_rev');
        expect(d).toEqual({dataset_id: 'gd_amz_rev',
            name: 'Amazon Reviews', domain: 'amazon.com',
            description: 'About gd_amz_rev', method: 'collect_by_url',
            source: 'api',
            input_fields: [{name: 'url', type: 'url', required: true,
                description: 'Review URL'}],
            output_fields: [{name: 'rating', description: 'Star rating'}],
            sample_input: [{url: 'https://amazon.com/r/1'}], notes: []});
    });
    it('say when there is no example or required field', async()=>{
        const d = await make().get_details('k', 'gd_amz_rev',
            'discover_by_keyword');
        expect(d.sample_input).toBeNull();
        expect(d.notes).toEqual(['No example input for this method.',
            'This method has no required input fields.']);
    });
    it('say when the schema is empty', async()=>{
        const d = await make().get_details('k', 'gd_jobs_b',
            'discover_by_sietmap');
        expect(d.notes).toEqual(['No example input for this method.',
            'This method has no documented input fields.']);
    });
    it('fall back to docs when the API fails', async()=>{
        mocks.get.mockRejectedValue(new Error('Error: HTTP 500'));
        const d = await make().get_details('k', 'gd_amz_rev',
            'collect_by_url');
        expect(d.source).toBe('docs');
        expect(d.sample_input).toBeNull();
        expect(d.input_fields.map(f=>f.name)).toEqual(['url']);
        expect(d.notes)
            .toEqual(['Example input unavailable: details API failed.']);
    });
    it('reject unknown ids and methods', async()=>{
        const c = make();
        await expect(c.get_details('k', 'gd_nope', 'collect_by_url'))
            .rejects.toThrow(/Unknown dataset_id gd_nope/);
        await expect(c.get_details('k', 'gd_amz_rev', 'discover_by_x'))
            .rejects.toThrow(/no method discover_by_x, available: /);
    });
    it('fail when API and docs both fail', async()=>{
        mocks.get.mockRejectedValue(new Error('Error: HTTP 500'));
        await expect(make().get_details('k', 'gd_ebay', 'collect_by_url'))
            .rejects.toThrow(/HTTP 404/);
    });
});
