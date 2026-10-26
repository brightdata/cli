import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it, expect} from 'vitest';
import {setup_e2e, type Route} from './harness';

const DS = 'gd_l7q7dkf244hwjntr0';
const SID = 'sd_e2e';
const OK_URL = 'https://www.amazon.com/dp/B09B8V1LZ3';
const DEAD_URL = 'https://www.amazon.com/dp/B000000000XX';
const DEAD_MSG = 'The navigation resulted in a dead page (404 status code)';

// Shapes below were captured from api.brightdata.com on 2026-10-25 and
// trimmed to the fields the CLI reads.
const CATALOG = {loaded_at: Date.now(), scrapers: [{dataset_id: DS,
    name: 'Amazon products', domain: 'amazon.com',
    collection_methods: ['collect_by_url', 'discover_by_keyword']}]};
const DETAILS = [{id: DS, name: 'Amazon products', domain: 'amazon.com',
    description: 'eCommerce product Datasets', scrapers: {
        collect_by_url: {
            input_schema: [{name: 'url', type: 'url', required: true},
                {name: 'zipcode', type: 'text', required: false}],
            sample_input: [{url: OK_URL}],
        },
        discover_by_keyword: {
            input_schema: [{name: 'keyword', type: 'text',
                required: true}],
        },
    }}];
const input = (url: string)=>({url, zipcode: ''});
const OK_RECORD = {title: 'Amazon Echo Dot', asin: 'B09B8V1LZ3',
    final_price: 79.99, input: input(OK_URL)};
const DEAD_RECORD = {timestamp: '2026-10-25T10:48:25.684Z',
    input: input(DEAD_URL), error: DEAD_MSG, error_code: 'dead_page'};
const CSV = 'text/csv; charset=utf-8';
const JSONL = 'application/jsonl; charset=utf-8';
const RUNNING = {status: 202, body: {status: 'running',
    message: 'Snapshot is not ready yet, try again in 30s'}};
const DEAD_CSV = 'title,asin,timestamp,input_url,input_zipcode,error,'
    +`error_code\n,,2026-10-25T10:48:25.684Z,${DEAD_URL},,"${DEAD_MSG}",`
    +'dead_page\n';
const OK_CSV = 'title,asin,timestamp,input_url,input_zipcode,error,'
    +`error_code\nAmazon Echo Dot,B09B8V1LZ3,,${OK_URL},,,\n`;

const run_routes = (snapshot: Route): Record<string, Route>=>({
    'GET /datasets/v3/scrapers': {body: DETAILS},
    'POST /datasets/v3/trigger': {body: {snapshot_id: SID}},
    [`GET /datasets/v3/snapshot/${SID}`]: snapshot,
});

describe('e2e: pipelines (real CLI vs fake API)', ()=>{
    const e2e = setup_e2e({cfg_files: {'scrapers.json': CATALOG}});
    const {api} = e2e;
    const with_out = (...args: string[])=>e2e.run(...args, '-o', e2e.out);

    describe('run', ()=>{
        it('waits for the snapshot and writes records, exit 0', async()=>{
            api.set(run_routes([RUNNING, {body: [OK_RECORD]}]));
            const res = await with_out('pipelines', 'run', DS,
                'collect_by_url', OK_URL);
            expect(res.code).toBe(0);
            expect(e2e.written()).toEqual([OK_RECORD]);
            const [trigger] = api.called('POST', '/datasets/v3/trigger');
            expect(trigger.query.get('dataset_id')).toBe(DS);
            expect(trigger.query.get('include_errors')).toBe('true');
            expect(trigger.headers['x-mcp-dataset-id']).toBe(DS);
            expect(JSON.parse(trigger.body)[0].url).toBe(OK_URL);
        });

        it('partial failure is data: all records written, exit 0',
            async()=>{
            api.set(run_routes({body: [DEAD_RECORD, OK_RECORD]}));
            const res = await with_out('pipelines', 'run', DS,
                'collect_by_url', OK_URL, DEAD_URL);
            expect(res.code).toBe(0);
            expect(e2e.written()).toEqual([DEAD_RECORD, OK_RECORD]);
        });

        it('every input failed: exit 1, errors on stderr, no file',
            async()=>{
            api.set(run_routes({body: [DEAD_RECORD]}));
            const res = await with_out('pipelines', 'run', DS,
                'collect_by_url', DEAD_URL);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain(`${DEAD_URL}: ${DEAD_MSG} `
                +'[dead_page]');
            expect(e2e.out_exists()).toBe(false);
        });

        it('--async prints the snapshot id and does not poll', async()=>{
            api.set(run_routes({body: [OK_RECORD]}));
            const res = await e2e.run('pipelines', 'run', DS,
                'collect_by_url', OK_URL, '--async', '--json');
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual({snapshot_id: SID});
            expect(api.called('GET', `/datasets/v3/snapshot/${SID}`))
                .toHaveLength(0);
        });

        it('discover_by_* sends discover params', async()=>{
            api.set(run_routes({body: [OK_RECORD]}));
            const res = await with_out('pipelines', 'run', DS,
                'discover_by_keyword', '--keyword', 'echo dot');
            expect(res.code).toBe(0);
            const [trigger] = api.called('POST', '/datasets/v3/trigger');
            expect(trigger.query.get('type')).toBe('discover_new');
            expect(trigger.query.get('discover_by')).toBe('keyword');
            expect(trigger.query.get('limit_per_input')).toBe('10');
            expect(JSON.parse(trigger.body)).toEqual([{keyword: 'echo dot'}]);
        });

        it('trigger validation error: exit 1, API message shown',
            async()=>{
            api.set({...run_routes({body: []}),
                'POST /datasets/v3/trigger': {status: 400, body: {
                    error: 'Invalid input provided',
                    code: 'validation_error'}}});
            const res = await with_out('pipelines', 'run', DS,
                'collect_by_url', OK_URL);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('Invalid input provided');
            expect(e2e.out_exists()).toBe(false);
        });
    });

    describe('results', ()=>{
        it.each([
            ['ndjson', JSONL, JSON.stringify(DEAD_RECORD)+'\n'],
            ['csv', CSV, DEAD_CSV],
        ])('every input failed (%s): exit 1, no file', async(fmt, type,
            body)=>{
            api.set({[`GET /datasets/v3/snapshot/${SID}`]: {type, body}});
            const res = await with_out('pipelines', 'results', SID,
                '--format', fmt);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain(`${DEAD_URL}: ${DEAD_MSG}`);
            expect(e2e.out_exists()).toBe(false);
        });

        it('csv with an empty error column is data, exit 0', async()=>{
            api.set({[`GET /datasets/v3/snapshot/${SID}`]:
                {type: CSV, body: OK_CSV}});
            const res = await with_out('pipelines', 'results', SID,
                '--format', 'csv');
            expect(res.code).toBe(0);
            expect(e2e.out_exists()).toBe(true);
        });

        it.each(['ndjson', 'jsonl'])('multi-record %s is written line by '
            +'line, exit 0', async fmt=>{
            const body = [OK_RECORD, DEAD_RECORD].map(r=>JSON.stringify(r))
                .join('\n')+'\n';
            api.set({[`GET /datasets/v3/snapshot/${SID}`]:
                {type: JSONL, body}});
            const out = join(e2e.home, `out.${fmt}`);
            const res = await e2e.run('pipelines', 'results', SID,
                '--format', fmt, '-o', out);
            expect(res.code).toBe(0);
            expect(readFileSync(out, 'utf8')).toBe(body);
        });

        it('snapshot still running: exit 1 with a hint', async()=>{
            api.set({[`GET /datasets/v3/snapshot/${SID}`]: RUNNING});
            const res = await with_out('pipelines', 'results', SID);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('not ready yet');
        });
    });

    it('status prints snapshot progress', async()=>{
        const progress = {status: 'ready', snapshot_id: SID, dataset_id: DS,
            records: 1, errors: 0};
        api.set({[`GET /datasets/v3/progress/${SID}`]: {body: progress}});
        const res = await e2e.run('pipelines', 'status', SID, '--json');
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout)).toEqual(progress);
    });

    it('search and info read the cached catalog, no API calls', async()=>{
        api.set({});
        const search = await e2e.run('pipelines', 'search', 'amazon',
            '--json');
        expect(search.code).toBe(0);
        expect(JSON.parse(search.stdout)[0].dataset_id).toBe(DS);
        const info = await e2e.run('pipelines', 'info', DS, '--json');
        expect(info.code).toBe(0);
        expect(JSON.parse(info.stdout).collection_methods)
            .toContain('collect_by_url');
        expect(api.calls).toHaveLength(0);
    });

    it('info <method> shows input fields from the details API', async()=>{
        api.set({'GET /datasets/v3/scrapers': {body: DETAILS}});
        const res = await e2e.run('pipelines', 'info', DS, 'collect_by_url',
            '--json');
        expect(res.code).toBe(0);
        const details = JSON.parse(res.stdout);
        expect(details.source).toBe('api');
        expect(details.input_fields[0]).toMatchObject({name: 'url',
            required: true});
    });

    it('unknown dataset id: exit 1 with a search hint', async()=>{
        api.set({});
        const res = await e2e.run('pipelines', 'run', 'gd_nope',
            'collect_by_url', OK_URL);
        expect(res.code).toBe(1);
        expect(res.stderr).toContain('pipelines search');
    });
});
