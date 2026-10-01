import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    get: vi.fn(),
    post: vi.fn(),
    ensure_authenticated: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    print: vi.fn(),
    print_table: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    parse_timeout: vi.fn(),
    poll_until: vi.fn(),
}));

vi.mock('../../utils/client', ()=>({get: mocks.get, post: mocks.post}));
vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));
vi.mock('../../utils/spinner', ()=>({start: mocks.start}));
vi.mock('../../utils/output', ()=>({
    print: mocks.print,
    print_table: mocks.print_table,
    dim: (s: string)=>s,
    fail: mocks.fail,
    info: mocks.info,
    success: mocks.success,
    warn: mocks.warn,
}));
vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

import {
    handle_list,
    handle_fields,
    handle_filter,
    handle_status,
    handle_download,
    FEATURED_DATASETS,
} from '../../commands/marketplace';

const LINKEDIN_PEOPLE = 'gd_l1viktl72bvl7bjuj0';

describe('commands/marketplace', ()=>{
    let exit_spy: ReturnType<typeof vi.spyOn>;

    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.start.mockReturnValue({stop: mocks.stop});
        mocks.parse_timeout.mockReturnValue(600);
        exit_spy = vi.spyOn(process, 'exit')
            .mockImplementation(((..._a: unknown[])=>undefined) as never);
        vi.spyOn(console, 'error').mockImplementation(()=>{});
    });

    afterEach(()=>{
        vi.restoreAllMocks();
    });

    describe('the curated alias map', ()=>{
        it('covers 48 datasets and every id looks like a dataset id', ()=>{
            const entries = Object.entries(FEATURED_DATASETS);
            expect(entries).toHaveLength(48);
            for (const [, id] of entries)
                expect(id).toMatch(/^gd_[a-z0-9]+$/);
        });

        it('maps no two names to the same id', ()=>{
            const ids = Object.values(FEATURED_DATASETS);
            expect(new Set(ids).size).toBe(ids.length);
        });
    });

    describe('list', ()=>{
        it('fetches the catalogue and renders a table', async()=>{
            mocks.get.mockResolvedValue([
                {id: 'gd_a', name: 'Alpha ', size: 1000},
            ]);
            await handle_list({});
            expect(mocks.get).toHaveBeenCalledWith(
                'api_key', '/datasets/list', {timing: undefined});
            // the catalogue carries stray whitespace; display trims it
            expect(mocks.print_table).toHaveBeenCalledWith(
                [{name: 'Alpha', id: 'gd_a', records: '1,000'}],
                ['name', 'id', 'records']
            );
        });

        it('--featured keeps only curated datasets', async()=>{
            mocks.get.mockResolvedValue([
                {id: LINKEDIN_PEOPLE, name: 'LinkedIn people profiles'},
                {id: 'gd_not_curated', name: 'Something else'},
            ]);
            await handle_list({featured: true});
            const rows = mocks.print_table.mock.calls[0][0];
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(LINKEDIN_PEOPLE);
        });

        it('--search matches name or id, case-insensitively', async()=>{
            mocks.get.mockResolvedValue([
                {id: 'gd_a', name: 'Zillow properties'},
                {id: 'gd_zillow_b', name: 'Something'},
                {id: 'gd_c', name: 'Unrelated'},
            ]);
            await handle_list({search: 'ZILLOW'});
            expect(mocks.print_table.mock.calls[0][0]).toHaveLength(2);
        });

        it('says so when nothing matches instead of printing nothing',
            async()=>{
                // print_table returns silently on an empty array, so an empty
                // result would otherwise be indistinguishable from a failure.
                mocks.get.mockResolvedValue([{id: 'gd_a', name: 'Alpha'}]);
                await handle_list({search: 'nothing-matches-this'});
                expect(mocks.info).toHaveBeenCalledWith(
                    expect.stringContaining('No datasets match'));
                expect(mocks.print_table).not.toHaveBeenCalled();
            });

        it('passes --json straight through to print', async()=>{
            const rows = [{id: 'gd_a', name: 'Alpha'}];
            mocks.get.mockResolvedValue(rows);
            await handle_list({json: true});
            expect(mocks.print).toHaveBeenCalledWith(
                rows, {json: true, pretty: undefined, output: undefined});
            expect(mocks.print_table).not.toHaveBeenCalled();
        });
    });

    describe('fields', ()=>{
        it('resolves a curated alias without touching the catalogue',
            async()=>{
                mocks.get.mockResolvedValue({fields: {url: {type: 'url'}}});
                await handle_fields('linkedin_people_profiles', {});
                expect(mocks.get).toHaveBeenCalledTimes(1);
                expect(mocks.get).toHaveBeenCalledWith(
                    'api_key',
                    `/datasets/${LINKEDIN_PEOPLE}/metadata`,
                    {timing: undefined}
                );
            });

        it('accepts a raw gd_ id', async()=>{
            mocks.get.mockResolvedValue({fields: {a: {type: 'text'}}});
            await handle_fields('gd_anything', {});
            expect(mocks.get).toHaveBeenCalledWith(
                'api_key', '/datasets/gd_anything/metadata',
                {timing: undefined});
        });

        it('rejects an unknown name and points at list/search', async()=>{
            await expect(handle_fields('not_a_dataset', {}))
                .rejects.toThrow(/Unknown dataset "not_a_dataset"/);
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringContaining('--search not_a_dataset'));
            expect(mocks.get).not.toHaveBeenCalled();
        });

        it('truncates long descriptions for the table but not for --json',
            async()=>{
                const long = 'x'.repeat(200);
                mocks.get.mockResolvedValue({fields: {a: {description: long}}});
                await handle_fields('gd_x', {});
                const row = mocks.print_table.mock.calls[0][0][0];
                expect(row.description.length).toBeLessThan(80);
                expect(row.description.endsWith('…')).toBe(true);
            });
    });

    describe('filter — the billable path', ()=>{
        const base = {
            dataset: 'crunchbase_companies',
            filter: '{"name":"industry","operator":"=","value":"Tech"}',
            recordsLimit: '100',
        };

        it('refuses to run without --records-limit', async()=>{
            // The billing guard: omitting the cap means "no limit" on datasets
            // holding hundreds of millions of records, and cost is only known
            // after the query is committed.
            await expect(handle_filter({
                dataset: base.dataset,
                filter: base.filter,
            })).rejects.toThrow(/--records-limit is required/);
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('rejects a non-positive --records-limit', async()=>{
            await expect(handle_filter({...base, recordsLimit: '0'}))
                .rejects.toThrow(/Invalid --records-limit/);
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('sends dataset_id, the parsed filter, and the cap', async()=>{
            mocks.post.mockResolvedValue({snapshot_id: 's_1'});
            await handle_filter({...base, async: true});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/datasets/filter',
                {
                    dataset_id: FEATURED_DATASETS['crunchbase_companies'],
                    filter: {
                        name: 'industry', operator: '=', value: 'Tech',
                    },
                    records_limit: 100,
                },
                {timing: undefined}
            );
        });

        it('fails before the network on invalid filter JSON', async()=>{
            await expect(handle_filter({...base, filter: 'not json'}))
                .rejects.toThrow(/Invalid JSON in filter/);
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('rejects --filter and --filter-file together', async()=>{
            await expect(handle_filter({
                ...base, filterFile: 'f.json',
            })).rejects.toThrow(/not both/);
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('surfaces the API error when no snapshot_id comes back',
            async()=>{
                mocks.post.mockResolvedValue({error: 'bad filter field'});
                await expect(handle_filter(base))
                    .rejects.toThrow(/bad filter field/);
            });

        it('--async prints the id and does not poll', async()=>{
            mocks.post.mockResolvedValue({snapshot_id: 's_1'});
            await handle_filter({...base, async: true});
            expect(mocks.success).toHaveBeenCalledWith(
                expect.stringContaining('s_1'));
            expect(mocks.poll_until).not.toHaveBeenCalled();
        });
    });

    describe('status', ()=>{
        it('surfaces cost, record count and file size', async()=>{
            mocks.get.mockResolvedValue({
                status: 'ready', dataset_size: 1234, file_size: 2097152,
                cost: 4.5,
            });
            await handle_status('s_1', {});
            expect(mocks.get).toHaveBeenCalledWith(
                'api_key', '/datasets/snapshots/s_1', {timing: undefined});
            expect(mocks.info).toHaveBeenCalledWith(
                expect.stringContaining('cost 4.5'));
        });

        it('fails loudly on a failed snapshot', async()=>{
            mocks.get.mockResolvedValue({
                status: 'failed', failure_reason: 'filter referenced no field',
            });
            await expect(handle_status('s_1', {}))
                .rejects.toThrow(/filter referenced no field/);
        });
    });

    describe('download', ()=>{
        it('exits NOT_READY (3) when still building and no --wait',
            async()=>{
                mocks.get.mockResolvedValue({status: 'building'});
                await handle_download('s_1', {});
                expect(exit_spy).toHaveBeenCalledWith(3);
                expect(mocks.poll_until).not.toHaveBeenCalled();
                expect(mocks.print).not.toHaveBeenCalled();
            });

        it('downloads a ready snapshot as parsed json', async()=>{
            mocks.get
                .mockResolvedValueOnce({status: 'ready', dataset_size: 2})
                .mockResolvedValueOnce([{a: 1}]);
            await handle_download('s_1', {format: 'json'});
            expect(mocks.get).toHaveBeenLastCalledWith(
                'api_key',
                '/datasets/snapshots/s_1/download?format=json',
                {timing: undefined}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                [{a: 1}],
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('requests non-json formats as raw bytes, not parsed json',
            async()=>{
                // The endpoint returns content-type application/jsonl, which
                // the client's `includes('application/json')` check would
                // treat as JSON — parsing the body and re-serialising it as
                // indented JSON. raw_buffer keeps it byte-exact.
                mocks.get
                    .mockResolvedValueOnce({status: 'ready'})
                    .mockResolvedValueOnce(Buffer.from('{"a":1}\n'));
                await handle_download('s_1', {format: 'jsonl'});
                expect(mocks.get).toHaveBeenLastCalledWith(
                    'api_key',
                    '/datasets/snapshots/s_1/download?format=jsonl',
                    {timing: undefined, raw_buffer: true}
                );
                expect(mocks.print).toHaveBeenCalledWith(
                    '{"a":1}\n',
                    {json: undefined, pretty: undefined, output: undefined}
                );
            });

        it('reports a zero-match query as an empty result, not a failure',
            async()=>{
                // A filter matching nothing comes back as status:failed with
                // warning_code no_records_found — a successful empty query.
                mocks.get.mockResolvedValue({
                    status: 'failed',
                    warning: 'Provided filter did not match any records',
                    warning_code: 'no_records_found',
                });
                await handle_download('s_1', {});
                expect(mocks.info).toHaveBeenCalledWith(
                    expect.stringContaining('matched no records'));
                expect(exit_spy).not.toHaveBeenCalled();
            });

        it('--wait polls on the marketplace status vocabulary', async()=>{
            mocks.get.mockResolvedValueOnce({status: 'scheduled'});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'ready'}, attempts: 2,
            });
            mocks.get.mockResolvedValueOnce([{a: 1}]);
            await handle_download('s_1', {wait: true});
            expect(mocks.poll_until).toHaveBeenCalledWith(
                expect.objectContaining({
                    running_statuses: ['scheduled', 'building'],
                })
            );
        });

        it('reports an empty snapshot instead of printing nothing',
            async()=>{
                mocks.get
                    .mockResolvedValueOnce({status: 'ready'})
                    .mockResolvedValueOnce([]);
                await handle_download('s_1', {});
                expect(mocks.info).toHaveBeenCalledWith(
                    expect.stringContaining('No records'));
                expect(mocks.print).not.toHaveBeenCalled();
            });

        it('fails with the API reason on a failed snapshot', async()=>{
            mocks.get.mockResolvedValue({status: 'failed', error: 'boom'});
            await expect(handle_download('s_1', {})).rejects.toThrow(/boom/);
        });

        it('rejects ndjson, which is a pipelines format', async()=>{
            await expect(handle_download('s_1', {format: 'ndjson'}))
                .rejects.toThrow(/Invalid format "ndjson"/);
            expect(mocks.get).not.toHaveBeenCalled();
        });
    });
});
