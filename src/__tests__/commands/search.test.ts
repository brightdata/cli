import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    ensure_authenticated: vi.fn(),
    resolve: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    print_table: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    dim: vi.fn((msg: string)=>msg),
}));

vi.mock('../../utils/client', ()=>({
    post: mocks.post,
}));

vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));

vi.mock('../../utils/config', ()=>({
    resolve: mocks.resolve,
}));

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}));

vi.mock('../../utils/output', ()=>({
    print: mocks.print,
    print_table: mocks.print_table,
    fail: mocks.fail,
    dim: mocks.dim,
}));

import {handle_search} from '../../commands/search';

describe('commands/search', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.resolve.mockReturnValue('cli_serp');
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    it('fails when no zone is resolved', async()=>{
        mocks.resolve.mockReturnValue(undefined);
        await expect(handle_search('hello', {}))
            .rejects.toThrow('fail:No zone specified.');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('renders google default output as table', async()=>{
        mocks.post.mockResolvedValue({
            organic: [
                {
                    rank: 1,
                    title: 'Result One',
                    link: 'https://example.com/one',
                    description: 'Description',
                },
            ],
        });
        await handle_search('hello world', {});
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            '/request',
            {
                zone: 'cli_serp',
                url: 'https://www.google.com/search?q=hello+world&brd_json=1',
                format: 'raw',
            },
            {timing: undefined}
        );
        expect(mocks.print_table).toHaveBeenCalledTimes(1);
        expect(mocks.print).not.toHaveBeenCalled();
    });

    it('prints markdown when google output file is provided', async()=>{
        mocks.post.mockResolvedValue({
            general: {search_engine: 'google', results_cnt: 1000},
            organic: [
                {
                    rank: 1,
                    title: 'Title',
                    link: 'https://example.com',
                    description: 'Desc',
                },
            ],
        });
        await handle_search('query', {output: 'out.md'});
        expect(mocks.print).toHaveBeenCalledTimes(1);
        const printed = mocks.print.mock.calls[0][0] as string;
        expect(printed.includes('# google results for "query"')).toBe(true);
    });

    it('prints raw result for non-google engines', async()=>{
        mocks.post.mockResolvedValue('raw bing markdown');
        await handle_search('query', {engine: 'bing'});
        expect(mocks.print).toHaveBeenCalledWith(
            'raw bing markdown',
            {json: undefined, pretty: undefined, output: undefined}
        );
    });

    it('prints json result when --json is used', async()=>{
        mocks.post.mockResolvedValue({organic: []});
        await handle_search('query', {json: true});
        expect(mocks.print).toHaveBeenCalledWith(
            {organic: []},
            {json: true, pretty: undefined, output: undefined}
        );
    });
});
