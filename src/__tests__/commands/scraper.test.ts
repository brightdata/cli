import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    get: vi.fn(),
    ensure_authenticated: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    dim: vi.fn((msg: string)=>msg),
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
    fail: mocks.fail,
    dim: mocks.dim,
    is_tty: false,
}));

vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

import {
    build_template_request,
    build_ai_request,
    extract_progress_status,
    format_create_summary,
    handle_create_scraper,
} from '../../commands/scraper';

describe('commands/scraper', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.parse_timeout.mockReturnValue(600);
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    describe('build_template_request', ()=>{
        it('uses auto-generated name and stub webhook by default', ()=>{
            const before = Math.floor(Date.now()/1000);
            const req = build_template_request({});
            const after = Math.floor(Date.now()/1000);
            expect(req.name).toMatch(/^cli-scraper-\d+$/);
            const ts = +req.name.replace('cli-scraper-', '');
            expect(ts).toBeGreaterThanOrEqual(before);
            expect(ts).toBeLessThanOrEqual(after);
            expect(req.deliver).toEqual({
                type: 'webhook',
                endpoint: 'https://example.com/webhook',
                filename: {template: 'data', extension: 'json'},
            });
        });

        it('honors --name override', ()=>{
            const req = build_template_request({name: 'my-scraper'});
            expect(req.name).toBe('my-scraper');
        });

        it('honors --deliver-webhook override', ()=>{
            const req = build_template_request({
                deliverWebhook: 'https://hooks.example.com/abc',
            });
            expect(req.deliver.endpoint).toBe('https://hooks.example.com/abc');
        });
    });

    describe('build_ai_request', ()=>{
        it('builds request with url wrapped in array', ()=>{
            const req = build_ai_request(
                'https://example.com/product/1',
                'extract title and price'
            );
            expect(req).toEqual({
                description: 'extract title and price',
                urls: ['https://example.com/product/1'],
            });
        });
    });

    describe('extract_progress_status', ()=>{
        it('returns "done" for completed jobs', ()=>{
            expect(extract_progress_status({status: 'done'})).toBe('done');
        });

        it('returns sentinel running token for any non-done status', ()=>{
            expect(extract_progress_status({status: 'running'}))
                .toBe('__running__');
            expect(extract_progress_status({status: 'queued'}))
                .toBe('__running__');
            expect(extract_progress_status({status: 'planner'}))
                .toBe('__running__');
        });

        it('returns undefined for missing/invalid input', ()=>{
            expect(extract_progress_status(null as never)).toBeUndefined();
            expect(extract_progress_status({} as never)).toBeUndefined();
        });
    });

    describe('format_create_summary', ()=>{
        it('formats a summary with id, name, and step count', ()=>{
            const out = format_create_summary('c_abc', 'cli-scraper-123', {
                step: 'preview_picker',
                completed_steps: ['a', 'b', 'c'],
                status: 'done',
            });
            expect(out).toContain('c_abc');
            expect(out).toContain('cli-scraper-123');
            expect(out).toContain('3');
        });

        it('handles missing completed_steps gracefully', ()=>{
            const out = format_create_summary('c_abc', 'name', {status: 'done'});
            expect(out).toContain('c_abc');
            expect(out).toContain('0');
        });
    });

    describe('handle_create_scraper', ()=>{
        it('chains create → trigger → poll and prints JSON in non-TTY',
            async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc', name: 'cli-scraper-1'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            const progress = {
                step: 'preview_picker',
                completed_steps: ['a', 'b'],
                status: 'done',
            };
            mocks.poll_until.mockResolvedValue({
                result: progress,
                attempts: 4,
            });
            await handle_create_scraper(
                'https://example.com/p/1',
                'extract title',
                {}
            );
            expect(mocks.post).toHaveBeenNthCalledWith(
                1,
                'api_key',
                '/dca/collector',
                expect.objectContaining({
                    deliver: expect.objectContaining({type: 'webhook'}),
                }),
                {timing: undefined}
            );
            expect(mocks.post).toHaveBeenNthCalledWith(
                2,
                'api_key',
                '/dca/collectors/c_abc/automate_template',
                {description: 'extract title',
                    urls: ['https://example.com/p/1']},
                {timing: undefined}
            );
            expect(mocks.poll_until).toHaveBeenCalledTimes(1);
            expect(mocks.print).toHaveBeenCalledWith(
                progress,
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('passes --json through to print', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            const progress = {status: 'done', completed_steps: []};
            mocks.poll_until.mockResolvedValue({
                result: progress, attempts: 1});
            await handle_create_scraper('https://x.com', 'd', {json: true});
            expect(mocks.print).toHaveBeenCalledWith(
                progress,
                {json: true, pretty: undefined, output: undefined}
            );
        });

        it('exits when template creation has no id', async()=>{
            mocks.post.mockResolvedValueOnce({});
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            expect(mocks.fail).toHaveBeenCalled();
            expect(mocks.post).toHaveBeenCalledTimes(1);
            exit.mockRestore();
            error.mockRestore();
        });

        it('surfaces collector_id when AI trigger fails', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockRejectedValueOnce(new Error('Error: 422 bad input'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            const messages = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(messages).toContain('c_abc');
            exit.mockRestore();
            error.mockRestore();
        });

        it('exits when poll returns non-done terminal status', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'failed', completed_steps: []},
                attempts: 2,
            });
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            const messages = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(messages).toContain('failed');
            expect(messages).toContain('c_abc');
            exit.mockRestore();
            error.mockRestore();
        });
    });
});
