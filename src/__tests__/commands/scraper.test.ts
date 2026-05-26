import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    get: vi.fn(),
    ensure_authenticated: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    success: vi.fn(),
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
    success: mocks.success,
    dim: mocks.dim,
    is_tty: false,
}));

vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

vi.mock('../../utils/config', ()=>({
    load: ()=>({api_url: 'https://api.test.local'}),
}));

import {
    build_template_request,
    build_ai_request,
    extract_progress_status,
    format_create_summary,
    handle_create_scraper,
    handle_run_scraper,
    build_run_request,
    build_run_query,
    classify_result,
    parse_result_body,
    parse_sync_timeout,
    is_realtime_page_limit_error,
    classify_dataset,
    SCRAPER_BODY_HINTS,
} from '../../commands/scraper';

describe('commands/scraper', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.parse_timeout.mockReturnValue(600);
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    // Scraper hints live with this command, not the shared client, and
    // must travel to the HTTP layer on every API call the command makes.
    describe('SCRAPER_BODY_HINTS', ()=>{
        it('contains a hint for the stub-collector 403 response body',
            ()=>{
            const stub_hint = SCRAPER_BODY_HINTS.find(h=>
                h.pattern.test('Collector does not have a template'));
            expect(stub_hint).toBeDefined();
            expect(stub_hint!.hint).toMatch(/AI generation has not completed/);
            expect(stub_hint!.hint).toMatch(/bdata scraper create/);
            // Must NOT echo the misleading generic 403 hint.
            expect(stub_hint!.hint).not.toMatch(/zone permissions/);
        });

        it('contains a hint for the parallel-job cap 429 response body',
            ()=>{
            const cap_hint = SCRAPER_BODY_HINTS.find(h=>
                h.pattern.test('Cannot run more than 3 jobs in parallel'));
            expect(cap_hint).toBeDefined();
            expect(cap_hint!.hint).toMatch(/concurrent-job cap/);
            expect(cap_hint!.hint).toMatch(/serialise/);
        });

        it('cap pattern is case-insensitive and number-agnostic '
            +'(future-proof if the cap changes)', ()=>{
            const cap_pattern = SCRAPER_BODY_HINTS[1].pattern;
            expect(cap_pattern.test('cannot run more than 5 jobs '
                +'in parallel')).toBe(true);
            expect(cap_pattern.test('CANNOT RUN MORE THAN 100 JOBS '
                +'IN PARALLEL')).toBe(true);
        });

        it('is passed via `hints` opt to client.post on every '
            +'AI-Flow call in handle_create_scraper', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc', name: 'cli-scraper-1'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_create_scraper(
                'https://example.com/p/1',
                'extract title',
                {}
            );
            for (const call of mocks.post.mock.calls)
            {
                const opts = call[3] as {hints?: unknown};
                expect(opts).toBeDefined();
                expect(opts.hints).toBe(SCRAPER_BODY_HINTS);
            }
        });

        it('is passed via `hints` opt to client.post on the '
            +'trigger_immediate call in handle_run_scraper', async()=>{
            mocks.post.mockResolvedValueOnce({response_id: 'r_xyz'});
            const fetch_spy = vi.spyOn(global, 'fetch')
                .mockImplementation(()=>Promise.resolve({
                    status: 200,
                    text: ()=>Promise.resolve('{"title":"ok"}'),
                } as unknown as Response));
            mocks.poll_until.mockImplementation(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1};
            });
            await handle_run_scraper('c_abc', 'https://x.com/p/1', {});
            const opts = mocks.post.mock.calls[0][3] as {hints?: unknown};
            expect(opts.hints).toBe(SCRAPER_BODY_HINTS);
            fetch_spy.mockRestore();
        });
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
                expect.objectContaining({timing: undefined})
            );
            expect(mocks.post).toHaveBeenNthCalledWith(
                2,
                'api_key',
                '/dca/collectors/c_abc/automate_template',
                {description: 'extract title',
                    urls: ['https://example.com/p/1']},
                expect.objectContaining({timing: undefined})
            );
            expect(mocks.poll_until).toHaveBeenCalledTimes(1);
            expect(mocks.poll_until).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeout_seconds: 600,
                    running_statuses: ['__running__'],
                    timeout_label: expect.stringContaining('c_abc'),
                })
            );
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

        it('surfaces collector_id when polling times out', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockRejectedValue(
                new Error('Timeout after 600 seconds waiting for AI generation'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            const messages = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(messages).toContain('Timeout');
            expect(messages).toContain('c_abc');
            exit.mockRestore();
            error.mockRestore();
        });
    });

    describe('build_run_request', ()=>{
        it('wraps url in {url}', ()=>{
            expect(build_run_request('https://x.com/p/1'))
                .toEqual({url: 'https://x.com/p/1'});
        });
    });

    describe('build_run_query', ()=>{
        it('includes collector and optional flags', ()=>{
            const q = build_run_query('c_abc',
                {name: 'job-1', version: 'dev'});
            const p = new URLSearchParams(q);
            expect(p.get('collector')).toBe('c_abc');
            expect(p.get('name')).toBe('job-1');
            expect(p.get('version')).toBe('dev');
        });

        it('omits unset name/version and merges extras', ()=>{
            const q = build_run_query('c_abc', {}, {timeout: '50s'});
            const p = new URLSearchParams(q);
            expect(p.get('collector')).toBe('c_abc');
            expect(p.get('timeout')).toBe('50s');
            expect(p.has('name')).toBe(false);
            expect(p.has('version')).toBe(false);
        });
    });

    describe('classify_result', ()=>{
        it('marks 200 with JSON body as ready', ()=>{
            expect(classify_result(200, '{"k":"v"}')).toBe('__ready__');
        });

        it('marks 200 with empty body as pending', ()=>{
            expect(classify_result(200, '')).toBe('__pending__');
            expect(classify_result(200, '   ')).toBe('__pending__');
            expect(classify_result(200, 'null')).toBe('__pending__');
        });

        it('marks 202 as pending', ()=>{
            expect(classify_result(202, '')).toBe('__pending__');
        });

        it('marks 4xx/5xx as pending so poll keeps trying briefly',
            ()=>{
            expect(classify_result(404, 'not found')).toBe('__pending__');
        });

        it('marks {"pending": true} body as pending', ()=>{
            expect(classify_result(200,
                '{"pending":true,"message":"Request is pending"}'))
                .toBe('__pending__');
        });

        it('still ready when body has other shape', ()=>{
            expect(classify_result(200, '{"price":99,"pending":false}'))
                .toBe('__ready__');
            expect(classify_result(200, '[{"a":1}]')).toBe('__ready__');
        });
    });

    describe('parse_result_body', ()=>{
        it('parses JSON when possible', ()=>{
            expect(parse_result_body('{"a":1}')).toEqual({a: 1});
            expect(parse_result_body('[1,2]')).toEqual([1, 2]);
        });

        it('returns trimmed string when not JSON', ()=>{
            expect(parse_result_body('  hello  ')).toBe('hello');
        });
    });

    describe('parse_sync_timeout', ()=>{
        it('defaults to 50 when undefined', ()=>{
            expect(parse_sync_timeout(undefined)).toBe(50);
        });

        it('accepts values in range', ()=>{
            expect(parse_sync_timeout('25')).toBe(25);
            expect(parse_sync_timeout('40')).toBe(40);
            expect(parse_sync_timeout('50')).toBe(50);
        });

        it('rejects out-of-range and non-numeric', ()=>{
            expect(()=>parse_sync_timeout('24')).toThrow();
            expect(()=>parse_sync_timeout('51')).toThrow();
            expect(()=>parse_sync_timeout('xyz')).toThrow();
        });
    });

    describe('handle_run_scraper (async + poll)', ()=>{
        let fetch_spy: ReturnType<typeof vi.spyOn>;

        beforeEach(()=>{
            fetch_spy = vi.spyOn(global, 'fetch')
                .mockImplementation(()=>Promise.reject(
                    new Error('unstubbed fetch'))) as never;
        });

        afterEach(()=>{
            fetch_spy.mockRestore();
        });

        const stub_fetch = (status: number, body: string)=>{
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status,
                text: ()=>Promise.resolve(body),
            } as unknown as Response));
        };

        it('triggers via post and polls get_result', async()=>{
            mocks.post.mockResolvedValueOnce({response_id: 'r_xyz'});
            stub_fetch(200, '{"title":"hello"}');
            mocks.poll_until.mockImplementation(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1};
            });
            await handle_run_scraper('c_abc', 'https://x.com/p/1', {});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                expect.stringMatching(
                    /\/dca\/trigger_immediate\?collector=c_abc/),
                {url: 'https://x.com/p/1'},
                expect.objectContaining({timing: undefined})
            );
            expect(mocks.print).toHaveBeenCalledWith(
                {title: 'hello'},
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('exits when trigger returns no response_id', async()=>{
            mocks.post.mockResolvedValueOnce({});
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_run_scraper('c_abc', 'https://x.com', {});
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toContain('response_id');
            expect(msg).toContain('c_abc');
            exit.mockRestore();
            error.mockRestore();
        });
    });

    describe('handle_run_scraper (--sync)', ()=>{
        let fetch_spy: ReturnType<typeof vi.spyOn>;

        beforeEach(()=>{
            fetch_spy = vi.spyOn(global, 'fetch') as never;
        });

        afterEach(()=>{
            fetch_spy.mockRestore();
        });

        const stub_fetch = (status: number, body: string)=>{
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status,
                text: ()=>Promise.resolve(body),
            } as unknown as Response));
        };

        it('calls /dca/crawl and prints body on 200', async()=>{
            stub_fetch(200, '{"price":99}');
            await handle_run_scraper('c_abc', 'https://x.com/p/1',
                {sync: true});
            expect(fetch_spy).toHaveBeenCalledTimes(1);
            const call = fetch_spy.mock.calls[0];
            expect(String(call[0])).toMatch(
                /\/dca\/crawl\?collector=c_abc.*timeout=50s/);
            expect(mocks.print).toHaveBeenCalledWith(
                {price: 99},
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('surfaces response_id and exits on 202 timeout', async()=>{
            stub_fetch(202,
                JSON.stringify({error: 'crawl_results_timeout',
                    response_id: 'r_late'}));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_run_scraper('c_abc', 'https://x.com',
                {sync: true});
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toContain('r_late');
            expect(msg).toContain('Re-run without --sync');
            exit.mockRestore();
            error.mockRestore();
        });

        it('honors --sync-timeout', async()=>{
            stub_fetch(200, '{}');
            await handle_run_scraper('c_abc', 'https://x.com',
                {sync: true, syncTimeout: '30'});
            const url = String(fetch_spy.mock.calls[0][0]);
            expect(url).toMatch(/timeout=30s/);
        });

        it('rejects --sync-timeout out of range', async()=>{
            await expect(
                handle_run_scraper('c_abc', 'https://x.com',
                    {sync: true, syncTimeout: '10'})
            ).rejects.toThrow(/25 and 50/);
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringContaining('25 and 50'));
        });
    });

    describe('is_realtime_page_limit_error', ()=>{
        it('detects the page-limit error shape', ()=>{
            expect(is_realtime_page_limit_error([{
                input: {url: 'https://x.com'},
                error: 'Request generated 501 pages and exceeded '
                    +'realtime job limit of 51 pages',
            }])).toBe(true);
        });

        it('is case-insensitive on the marker', ()=>{
            expect(is_realtime_page_limit_error([{
                error: 'EXCEEDED REALTIME JOB LIMIT',
            }])).toBe(true);
        });

        it('returns false for normal result arrays', ()=>{
            expect(is_realtime_page_limit_error([{title: 'ok'}]))
                .toBe(false);
            expect(is_realtime_page_limit_error([{a: 1}, {b: 2}]))
                .toBe(false);
        });

        it('returns false for objects, strings, empty arrays', ()=>{
            expect(is_realtime_page_limit_error({error: 'x'})).toBe(false);
            expect(is_realtime_page_limit_error([])).toBe(false);
            expect(is_realtime_page_limit_error(null)).toBe(false);
            expect(is_realtime_page_limit_error('string')).toBe(false);
        });
    });

    describe('classify_dataset', ()=>{
        it('treats 202 as pending', ()=>{
            expect(classify_dataset(202, '')).toBe('__pending__');
        });

        it('treats {status: "building"} body as pending', ()=>{
            expect(classify_dataset(200,
                '{"status":"building","message":"try again"}'))
                .toBe('__pending__');
        });

        it('treats a data array as ready', ()=>{
            expect(classify_dataset(200, '[{"Title":"x"}]'))
                .toBe('__ready__');
        });

        it('treats empty body as pending', ()=>{
            expect(classify_dataset(200, '   ')).toBe('__pending__');
        });
    });

    describe('handle_run_scraper auto-fallback to batch', ()=>{
        let fetch_spy: ReturnType<typeof vi.spyOn>;

        beforeEach(()=>{
            fetch_spy = vi.spyOn(global, 'fetch') as never;
        });

        afterEach(()=>{
            fetch_spy.mockRestore();
        });

        it('falls back to batch when realtime returns page-limit error',
            async()=>{
            const limit_error = JSON.stringify([{
                input: {url: 'https://x.com/p/1'},
                error: 'Request generated 501 pages and '
                    +'exceeded realtime job limit of 51 pages',
            }]);
            mocks.post
                .mockResolvedValueOnce({response_id: 'r_xyz'})
                .mockResolvedValueOnce({collection_id: 'd_batch',
                    start_eta: '2026-05-13T12:00:00Z'});
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve('[{"Title":"final"}]'),
            } as unknown as Response));
            mocks.poll_until
                .mockImplementationOnce(async(o: never)=>{
                    const cfg = o as {fetch_once: ()=>Promise<unknown>};
                    return {result: {status: 200, body: limit_error},
                        attempts: 1, last_status: '__ready__'};
                })
                .mockImplementationOnce(async(o: never)=>{
                    const cfg = o as {fetch_once: ()=>Promise<unknown>};
                    const r = await cfg.fetch_once();
                    return {result: r, attempts: 1,
                        last_status: '__ready__'};
                });
            await handle_run_scraper('c_abc', 'https://x.com/p/1', {});
            expect(mocks.post).toHaveBeenCalledTimes(2);
            const second_call = mocks.post.mock.calls[1];
            expect(String(second_call[1])).toMatch(
                /\/dca\/trigger\?collector=c_abc/);
            expect(second_call[2]).toEqual([{url: 'https://x.com/p/1'}]);
            expect(mocks.print).toHaveBeenCalledWith(
                [{Title: 'final'}],
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('falls back to batch from --sync mode too', async()=>{
            const limit_error = JSON.stringify([{
                error: 'exceeded realtime job limit',
            }]);
            fetch_spy.mockImplementationOnce(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve(limit_error),
            } as unknown as Response));
            mocks.post.mockResolvedValueOnce({collection_id: 'd_batch'});
            fetch_spy.mockImplementationOnce(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve('[{"ok":1}]'),
            } as unknown as Response));
            mocks.poll_until.mockImplementationOnce(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1, last_status: '__ready__'};
            });
            await handle_run_scraper('c_abc', 'https://x.com',
                {sync: true});
            expect(mocks.post).toHaveBeenCalledTimes(1);
            expect(String(mocks.post.mock.calls[0][1])).toMatch(
                /\/dca\/trigger\?collector=c_abc/);
            expect(mocks.print).toHaveBeenCalledWith(
                [{ok: 1}],
                {json: undefined, pretty: undefined, output: undefined}
            );
        });
    });
});
