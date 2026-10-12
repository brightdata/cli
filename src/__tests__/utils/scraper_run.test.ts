import {describe, it, expect, vi, beforeEach} from 'vitest';

const mocks = vi.hoisted(()=>({get: vi.fn(), post: vi.fn()}));
vi.mock('../../utils/client', ()=>({get: mocks.get, post: mocks.post}));

import {
    trigger,
    progress,
    results,
    wait_for_results,
    scraper_headers,
} from '../../utils/scraper_run';

const query = (endpoint: string)=>Object.fromEntries(
    new URL(endpoint, 'http://x').searchParams);

beforeEach(()=>{
    vi.clearAllMocks();
    mocks.post.mockResolvedValue({snapshot_id: 's_1'});
});

describe('scraper_run trigger', ()=>{
    it('collect_by_url sends no discover params', async()=>{
        const headers = scraper_headers('gd_1', 'collect_by_url');
        expect(await trigger('k', {dataset_id: 'gd_1',
            method: 'collect_by_url', input: [{url: 'https://a.com'}]},
        {headers})).toBe('s_1');
        const [key, endpoint, body, opts] = mocks.post.mock.calls[0];
        expect(key).toBe('k');
        expect(endpoint.startsWith('/datasets/v3/trigger?')).toBe(true);
        expect(query(endpoint))
            .toEqual({dataset_id: 'gd_1', include_errors: 'true'});
        expect(body).toEqual([{url: 'https://a.com'}]);
        expect(opts.headers).toEqual({'x-mcp-dataset-id': 'gd_1',
            'x-mcp-method': 'collect_by_url'});
    });
    it('discover methods pass discover_by and limit_per_input', async()=>{
        await trigger('k', {dataset_id: 'gd_1',
            method: 'discover_by_sietmap', input: [{url: 'https://a.com'}]});
        expect(query(mocks.post.mock.calls[0][1])).toEqual({
            dataset_id: 'gd_1', include_errors: 'true',
            type: 'discover_new', discover_by: 'sietmap',
            limit_per_input: '10'});
        await trigger('k', {dataset_id: 'gd_1',
            method: 'discover_by_keyword', input: [{keyword: 'x'}],
            limit_per_input: 50});
        expect(query(mocks.post.mock.calls[1][1]).limit_per_input)
            .toBe('50');
    });
    it('without snapshot_id is an error', async()=>{
        mocks.post.mockResolvedValue({});
        await expect(trigger('k', {dataset_id: 'gd_1',
            method: 'collect_by_url', input: [{}]}))
            .rejects.toThrow('trigger failed. No snapshot_id returned.');
    });
});

describe('scraper_run progress and results', ()=>{
    it('report status and strip nulls from JSON', async()=>{
        mocks.get.mockResolvedValueOnce({status: 'running'})
            .mockResolvedValueOnce({status: 'running', message: 'not ready'})
            .mockResolvedValueOnce([{title: 'a', price: null}]);
        expect(await progress('k', 's_1')).toEqual({status: 'running'});
        expect(await results('k', 's_1'))
            .toEqual({snapshot_id: 's_1', status: 'running'});
        expect(await results('k', 's_1')).toEqual({snapshot_id: 's_1',
            status: 'ready', data: [{title: 'a'}]});
    });
    it('keep CSV text as is', async()=>{
        mocks.get.mockResolvedValue('a,b\n1,\n');
        expect((await results('k', 's_1', {format: 'csv'})).data)
            .toBe('a,b\n1,\n');
        expect(mocks.get.mock.calls[0][1])
            .toBe('/datasets/v3/snapshot/s_1?format=csv');
    });
    it('encode the snapshot id into the path', async()=>{
        mocks.get.mockResolvedValue([]);
        await results('k', '../../zone');
        await progress('k', '../../zone');
        expect(mocks.get.mock.calls.map(c=>c[1])).toEqual([
            '/datasets/v3/snapshot/..%2F..%2Fzone?format=json',
            '/datasets/v3/progress/..%2F..%2Fzone',
        ]);
    });
    it('wait polls until the snapshot is ready', async()=>{
        mocks.get.mockResolvedValueOnce({status: 'starting'})
            .mockResolvedValueOnce({status: 'running'})
            .mockResolvedValueOnce([{a: 1}]);
        const res = await wait_for_results('k', 's_1',
            {timeout_seconds: 10, interval_ms: 1});
        expect(res.data).toEqual([{a: 1}]);
        expect(mocks.get).toHaveBeenCalledTimes(3);
    });
    it('wait gives up after the timeout', async()=>{
        mocks.get.mockResolvedValue({status: 'running'});
        await expect(wait_for_results('k', 's_1',
            {timeout_seconds: 2, interval_ms: 1}))
            .rejects.toThrow('Timeout after 2 seconds waiting for snapshot '
                +'s_1.');
    });
});

describe('scraper_run errors', ()=>{
    const api_error = new Error('Error: {"error":"boom"}\n  Status: 400');
    it('name the failed step', async()=>{
        mocks.post.mockRejectedValue(api_error);
        mocks.get.mockRejectedValue(api_error);
        await expect(trigger('k', {dataset_id: 'gd_1',
            method: 'collect_by_url', input: [{}]}))
            .rejects.toThrow(/^trigger failed\. Error: \{"error":"boom"\}/);
        await expect(progress('k', 's_1'))
            .rejects.toThrow(/^progress failed\. .*Status: 400/s);
        await expect(results('k', 's_1'))
            .rejects.toThrow(/^results failed\. /);
    });
});
