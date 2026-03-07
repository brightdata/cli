import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    ensure_authenticated: vi.fn(),
    resolve: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    success: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
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
    success: mocks.success,
    fail: mocks.fail,
}));

import {handle_scrape} from '../../commands/scrape';

describe('commands/scrape', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.resolve.mockReturnValue('cli_unlocker');
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    it('fails when no zone is resolved', async()=>{
        mocks.resolve.mockReturnValue(undefined);
        await expect(handle_scrape('https://example.com', {}))
            .rejects.toThrow('fail:No Web Unlocker zone specified.');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('submits markdown scrape request by default and prints text response',
        async()=>{
            mocks.post.mockResolvedValue('# hello');
            await handle_scrape('https://example.com', {});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/request',
                {
                    zone: 'cli_unlocker',
                    url: 'https://example.com',
                    format: 'raw',
                    data_format: 'markdown',
                },
                {timing: undefined}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                '# hello',
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

    it('submits json scrape request and prints json response', async()=>{
        mocks.post.mockResolvedValue({status: 200, body: '{}', headers: {}});
        await handle_scrape('https://example.com', {format: 'json'});
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            '/request',
            {
                zone: 'cli_unlocker',
                url: 'https://example.com',
                format: 'json',
            },
            {timing: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {status: 200, body: '{}', headers: {}},
            {json: undefined, pretty: undefined, output: undefined}
        );
    });

    it('handles async scrape mode with success message', async()=>{
        mocks.post.mockResolvedValue({response_id: 'resp_123'});
        await handle_scrape('https://example.com', {async: true});
        expect(mocks.success).toHaveBeenCalledWith(
            'Async job submitted. Response ID: resp_123'
        );
        expect(mocks.print).not.toHaveBeenCalled();
    });
});
