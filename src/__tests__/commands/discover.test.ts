import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    get: vi.fn(),
    ensure_authenticated: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    print_table: vi.fn(),
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
    fail: mocks.fail,
    dim: mocks.dim,
}));

vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

import {
    handle_discover,
    build_request,
    extract_status,
    format_markdown,
    print_discover_table,
} from '../../commands/discover';

describe('commands/discover', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.parse_timeout.mockReturnValue(600);
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    describe('build_request', ()=>{
        it('builds minimal request with only query', ()=>{
            const req = build_request('AI trends', {});
            expect(req).toEqual({query: 'AI trends'});
        });

        it('includes all optional params', ()=>{
            const req = build_request('AI trends', {
                intent: 'find research papers',
                city: 'New York',
                country: 'US',
                language: 'en',
                numResults: '10',
                filterKeywords: 'AI, machine learning',
                includeContent: true,
                startDate: '2025-01-01',
                endDate: '2025-12-31',
            });
            expect(req).toEqual({
                query: 'AI trends',
                intent: 'find research papers',
                city: 'New York',
                country: 'US',
                language: 'en',
                num_results: 10,
                filter_keywords: ['AI', 'machine learning'],
                include_content: true,
                start_date: '2025-01-01',
                end_date: '2025-12-31',
            });
        });

        it('parses comma-separated filter keywords with whitespace', ()=>{
            const req = build_request('q', {filterKeywords: ' a , b , c '});
            expect(req.filter_keywords).toEqual(['a', 'b', 'c']);
        });

        it('does not set format by default (API returns JSON)', ()=>{
            const req = build_request('test', {});
            expect(req.format).toBeUndefined();
        });

        it('does not set format when include-content is used', ()=>{
            const req = build_request('test', {includeContent: true});
            expect(req.format).toBeUndefined();
            expect(req.include_content).toBe(true);
        });
    });

    describe('extract_status', ()=>{
        it('returns status from valid response', ()=>{
            expect(extract_status({status: 'processing'})).toBe('processing');
            expect(extract_status({status: 'done'})).toBe('done');
        });

        it('returns undefined for invalid input', ()=>{
            expect(extract_status(null as never)).toBeUndefined();
            expect(extract_status(undefined as never)).toBeUndefined();
        });
    });

    describe('format_markdown', ()=>{
        it('formats results as markdown', ()=>{
            const md = format_markdown([
                {
                    link: 'https://example.com',
                    title: 'Example',
                    description: 'A description',
                    relevance_score: 0.95,
                },
            ], 'test query');
            expect(md).toContain('# Discover results for "test query"');
            expect(md).toContain('**1. [Example](https://example.com)** (95.0%)');
            expect(md).toContain('A description');
        });

        it('includes content when present', ()=>{
            const md = format_markdown([
                {
                    link: 'https://example.com',
                    title: 'Example',
                    description: 'Desc',
                    relevance_score: 0.5,
                    content: '# Page content here',
                },
            ], 'q');
            expect(md).toContain('# Page content here');
        });
    });

    describe('print_discover_table', ()=>{
        it('calls print_table with formatted rows', ()=>{
            const results = [
                {
                    link: 'https://example.com',
                    title: 'Example Title',
                    description: 'Desc',
                    relevance_score: 0.98184747,
                },
            ];
            print_discover_table(results);
            expect(mocks.print_table).toHaveBeenCalledWith(
                [{
                    '#': '1',
                    title: 'Example Title',
                    score: '98.2%',
                    url: 'https://example.com',
                }],
                ['#', 'title', 'score', 'url']
            );
        });

        it('prints dim message when no results', ()=>{
            const log = vi.spyOn(console, 'log').mockImplementation(()=>{});
            print_discover_table([]);
            expect(log).toHaveBeenCalled();
            expect(mocks.print_table).not.toHaveBeenCalled();
            log.mockRestore();
        });
    });

    describe('handle_discover', ()=>{
        it('triggers and polls then prints table', async()=>{
            mocks.post.mockResolvedValue({status: 'ok', task_id: 'abc123'});
            mocks.poll_until.mockResolvedValue({
                result: {
                    status: 'done',
                    duration_seconds: 5,
                    results: [
                        {
                            link: 'https://example.com',
                            title: 'Result',
                            description: 'Desc',
                            relevance_score: 0.9,
                        },
                    ],
                },
                attempts: 3,
            });
            await handle_discover('AI trends', {});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/discover',
                {query: 'AI trends'},
                {timing: undefined}
            );
            expect(mocks.poll_until).toHaveBeenCalledTimes(1);
            expect(mocks.print_table).toHaveBeenCalledTimes(1);
        });

        it('prints json when --json is set', async()=>{
            const response = {
                status: 'done',
                duration_seconds: 2,
                results: [{
                    link: 'https://example.com',
                    title: 'R',
                    description: 'D',
                    relevance_score: 0.8,
                }],
            };
            mocks.post.mockResolvedValue({status: 'ok', task_id: 't1'});
            mocks.poll_until.mockResolvedValue({result: response, attempts: 1});
            await handle_discover('q', {json: true});
            expect(mocks.print).toHaveBeenCalledWith(
                response,
                {json: true, pretty: undefined, output: undefined}
            );
            expect(mocks.print_table).not.toHaveBeenCalled();
        });

        it('prints raw JSON when --output is set', async()=>{
            const response = {
                status: 'done',
                results: [{
                    link: 'https://example.com',
                    title: 'R',
                    description: 'D',
                    relevance_score: 0.7,
                }],
            };
            mocks.post.mockResolvedValue({status: 'ok', task_id: 't2'});
            mocks.poll_until.mockResolvedValue({result: response, attempts: 1});
            await handle_discover('q', {output: 'out.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                response,
                {json: undefined, pretty: undefined, output: 'out.json'}
            );
        });

        it('fails when trigger returns no task_id', async()=>{
            mocks.post.mockResolvedValue({status: 'ok'});
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_discover('q', {});
            expect(mocks.fail).toHaveBeenCalled();
            exit.mockRestore();
            error.mockRestore();
        });
    });
});
