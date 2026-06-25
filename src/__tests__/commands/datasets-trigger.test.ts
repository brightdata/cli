import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import os from 'os';
import path from 'path';
import {writeFileSync, rmSync} from 'fs';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    get: vi.fn(),
    ensure_authenticated: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    print: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    parse_timeout: vi.fn(),
    poll_until: vi.fn(),
}));

vi.mock('../../utils/client', ()=>({
    post: mocks.post,
    get: mocks.get,
}));

vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}));

vi.mock('../../utils/output', ()=>({
    print: mocks.print,
    dim: (s: string)=>s,
    fail: mocks.fail,
    success: mocks.success,
    info: mocks.info,
}));

vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

import {handle_datasets_trigger} from '../../commands/datasets-trigger';

const X_POSTS_ID = 'gd_lwxkxvnf1cynvib9co';

describe('commands/datasets trigger', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.start.mockReturnValue({stop: mocks.stop});
        mocks.parse_timeout.mockReturnValue(600);
        vi.spyOn(console, 'error').mockImplementation(()=>{});
    });

    afterEach(()=>{
        vi.restoreAllMocks();
    });

    it('triggers collect-by-URL by dataset name and sends input verbatim',
        async()=>{
            mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
            await handle_datasets_trigger({
                dataset: 'x_posts',
                input: '[{"url":"https://x.com/sama"}]',
                async: true,
            });
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                `/datasets/v3/trigger?dataset_id=${X_POSTS_ID}`
                    +'&include_errors=true',
                [{url: 'https://x.com/sama'}],
                {timing: undefined}
            );
            expect(mocks.success).toHaveBeenCalledWith(
                'Trigger submitted. Snapshot ID: snap_1'
            );
            expect(mocks.poll_until).not.toHaveBeenCalled();
        });

    it('adds discovery params to the trigger query string', async()=>{
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        await handle_datasets_trigger({
            dataset: 'x_posts',
            type: 'discover_new',
            discoverBy: 'profile_url',
            limit: '15000',
            input: '[{"url":"https://x.com/sama"}]',
            async: true,
        });
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            `/datasets/v3/trigger?dataset_id=${X_POSTS_ID}`
                +'&type=discover_new&discover_by=profile_url'
                +'&limit_per_input=15000&include_errors=true',
            [{url: 'https://x.com/sama'}],
            {timing: undefined}
        );
    });

    it('accepts a raw --dataset-id for any dataset', async()=>{
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        await handle_datasets_trigger({
            datasetId: 'gd_brand_new_dataset',
            input: '[{"x":1}]',
            async: true,
        });
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            '/datasets/v3/trigger?dataset_id=gd_brand_new_dataset'
                +'&include_errors=true',
            [{x: 1}],
            {timing: undefined}
        );
    });

    it('fails when both --dataset and --dataset-id are given', async()=>{
        await expect(handle_datasets_trigger({
            dataset: 'x_posts',
            datasetId: 'gd_x',
            input: '[{}]',
        })).rejects.toThrow(
            'fail:Provide either --dataset or --dataset-id, not both.'
        );
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('fails on an unknown dataset name', async()=>{
        await expect(handle_datasets_trigger({
            dataset: 'not_a_dataset',
            input: '[{}]',
        })).rejects.toThrow('Unknown dataset "not_a_dataset"');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('fails when no input is provided', async()=>{
        await expect(handle_datasets_trigger({dataset: 'x_posts'}))
            .rejects.toThrow('No input provided');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('fails on an empty input array', async()=>{
        await expect(handle_datasets_trigger({
            dataset: 'x_posts',
            input: '[]',
        })).rejects.toThrow('Input is empty');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('fails when both --input-file and --input are given', async()=>{
        await expect(handle_datasets_trigger({
            dataset: 'x_posts',
            inputFile: 'seeds.jsonl',
            input: '[{}]',
        })).rejects.toThrow(
            'Provide either --input-file or --input, not both.'
        );
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('fails on an invalid --limit', async()=>{
        await expect(handle_datasets_trigger({
            dataset: 'x_posts',
            input: '[{"x":1}]',
            limit: '-5',
        })).rejects.toThrow('Invalid --limit "-5"');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('--no-include-errors sets include_errors=false', async()=>{
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        await handle_datasets_trigger({
            dataset: 'x_posts',
            input: '[{"x":1}]',
            includeErrors: false,
            async: true,
        });
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            `/datasets/v3/trigger?dataset_id=${X_POSTS_ID}`
                +'&include_errors=false',
            [{x: 1}],
            {timing: undefined}
        );
    });

    it('wraps a single inline JSON object into an array', async()=>{
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        await handle_datasets_trigger({
            dataset: 'x_posts',
            input: '{"url":"u"}',
            async: true,
        });
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            expect.any(String),
            [{url: 'u'}],
            {timing: undefined}
        );
    });

    it('reads and parses a JSONL input file (real temp file)', async()=>{
        const tmp = path.join(
            os.tmpdir(), `bd-trigger-${process.pid}.jsonl`
        );
        writeFileSync(tmp, '{"url":"u1"}\n{"url":"u2"}\n');
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        try {
            await handle_datasets_trigger({
                dataset: 'x_posts',
                inputFile: tmp,
                async: true,
            });
        } finally {
            rmSync(tmp, {force: true});
        }
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            expect.stringContaining(`dataset_id=${X_POSTS_ID}`),
            [{url: 'u1'}, {url: 'u2'}],
            {timing: undefined}
        );
    });

    it('sync mode polls until ready and prints the data', async()=>{
        mocks.post.mockResolvedValue({snapshot_id: 'snap_1'});
        mocks.poll_until.mockResolvedValue({
            result: [{a: 1}],
            attempts: 1,
        });
        await handle_datasets_trigger({
            dataset: 'x_posts',
            input: '[{"url":"u"}]',
        });
        expect(mocks.poll_until).toHaveBeenCalledTimes(1);
        expect(mocks.print).toHaveBeenCalledWith(
            [{a: 1}],
            {json: undefined, pretty: undefined, output: undefined}
        );
        expect(mocks.success).not.toHaveBeenCalled();
    });
});
