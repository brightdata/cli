import {describe, it, expect} from 'vitest';
import {setup_e2e, type Route} from './harness';

const URL_1 = 'https://books.toscrape.com/';
const URL_2 = 'https://books.toscrape.com/catalogue/page-2.html';
const COLLECTOR = 'c_e2e_test';
const LIMIT_MSG = 'Request generated 70 pages and exceeded realtime job '
    +'limit of 51 pages';

// Wire shapes. v1 was captured from api.brightdata.com on 2026-10-25; v0 is
// what svc/dca2 realtime_runner _mk_data_file writes for collectors with
// output_format_ver 0 (inherited from the account's newest collector).
const v1_error = (error: string, error_code: string)=>
    [{input: {url: URL_1}, error, error_code}];
const v0_error = (message: string, error_code: string)=>
    ({input: {url: URL_1}, message, error: true, error_code});
const SHAPES = [
    {ver: 'v1', error: v1_error},
    {ver: 'v0', error: v0_error},
];

const REALTIME_ROWS = [{title: 'realtime row', input: {url: URL_1}}];
const BATCH_ROWS = [{title: 'batch row 1'}, {title: 'batch row 2'}];
const PENDING = {pending: true, message: 'Request is pending'};
const TRIGGERED = {status: 202, body: {response_id: 'd2t_e2e'}};
const BATCH_ROUTES: Record<string, Route> = {
    'POST /dca/trigger': {body: {collection_id: 'j_e2e'}},
    'GET /dca/dataset': {body: BATCH_ROWS},
};

describe('e2e: scraper run (real CLI vs fake API)', ()=>{
    const e2e = setup_e2e();
    const {api} = e2e;
    const run = (...args: string[])=>e2e.run('scraper', 'run', COLLECTOR,
        ...args, '-o', e2e.out);
    const written = ()=>e2e.written();
    const out_exists = ()=>e2e.out_exists();

    it('single URL: polls until ready and writes rows, exit 0', async()=>{
        api.set({
            'POST /dca/trigger_immediate': TRIGGERED,
            'GET /dca/get_result': [{status: 202, body: PENDING},
                {body: REALTIME_ROWS}],
        });
        const res = await run(URL_1);
        expect(res.code).toBe(0);
        expect(written()).toEqual(REALTIME_ROWS);
        expect(api.called('GET', '/dca/get_result')).toHaveLength(2);
        expect(api.called('POST', '/dca/trigger')).toHaveLength(0);
    });

    it('multi URL: one batch trigger with every URL, exit 0', async()=>{
        api.set(BATCH_ROUTES);
        const res = await run('--urls', `${URL_1},${URL_2}`);
        expect(res.code).toBe(0);
        expect(written()).toEqual(BATCH_ROWS);
        const [trigger] = api.called('POST', '/dca/trigger');
        expect(JSON.parse(trigger.body)).toEqual(
            [{url: URL_1}, {url: URL_2}]);
    });

    it('rows with a null error field are data, not an error', async()=>{
        const rows = [{title: 'ok', error: null, error_code: null}];
        api.set({
            'POST /dca/trigger_immediate': TRIGGERED,
            'GET /dca/get_result': {body: rows},
        });
        const res = await run(URL_1);
        expect(res.code).toBe(0);
        expect(written()).toEqual(rows);
    });

    it('trigger HTTP error: exit 1, nothing written', async()=>{
        api.set({'POST /dca/trigger_immediate':
            {status: 401, body: {error: 'Unauthorized'}}});
        const res = await run(URL_1);
        expect(res.code).toBe(1);
        expect(out_exists()).toBe(false);
    });

    describe.each(SHAPES)('output_format_ver $ver', ({error})=>{
        const limit = error(LIMIT_MSG, 'too_many_pages');

        it('async: page limit falls back to batch, exit 0', async()=>{
            api.set({
                'POST /dca/trigger_immediate': TRIGGERED,
                'GET /dca/get_result': {body: limit},
                ...BATCH_ROUTES,
            });
            const res = await run(URL_1);
            expect(res.code).toBe(0);
            expect(res.stderr).toContain('switching to batch mode');
            expect(written()).toEqual(BATCH_ROWS);
            const [trigger] = api.called('POST', '/dca/trigger');
            expect(JSON.parse(trigger.body)).toEqual([{url: URL_1}]);
            expect(trigger.query.get('collector')).toBe(COLLECTOR);
        });

        it('sync: page limit falls back to batch, exit 0', async()=>{
            api.set({'POST /dca/crawl': {body: limit}, ...BATCH_ROUTES});
            const res = await run(URL_1, '--sync');
            expect(res.code).toBe(0);
            expect(written()).toEqual(BATCH_ROWS);
        });

        it('scraper error: exit 1, message on stderr, no file', async()=>{
            api.set({
                'POST /dca/trigger_immediate': TRIGGERED,
                'GET /dca/get_result':
                    {body: error('Job reached timeout', 'deadline_timeout')},
            });
            const res = await run(URL_1);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('Job reached timeout');
            expect(out_exists()).toBe(false);
            expect(api.called('POST', '/dca/trigger')).toHaveLength(0);
        });

        it('sync scraper error: exit 1, no file', async()=>{
            api.set({'POST /dca/crawl':
                {body: error('Job reached timeout', 'deadline_timeout')}});
            const res = await run(URL_1, '--sync');
            expect(res.code).toBe(1);
            expect(out_exists()).toBe(false);
        });

        it('batch returns only errors: exit 1, no file', async()=>{
            api.set({
                'POST /dca/trigger': {body: {collection_id: 'j_e2e'}},
                'GET /dca/dataset':
                    {body: error('Page not found', 'dead_page')},
            });
            const res = await run('--urls', `${URL_1},${URL_2}`);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('Page not found');
            expect(out_exists()).toBe(false);
        });
    });
});
