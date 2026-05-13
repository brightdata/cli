import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    get: vi.fn(),
    ensure_authenticated: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    print_table: vi.fn(),
    success: vi.fn(),
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
    print_table: mocks.print_table,
    success: mocks.success,
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
});
