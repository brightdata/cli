import {writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {Command} from 'commander';
import type {Scraper_create_opts, Scraper_heal_opts,
    Scraper_approve_opts} from '../../types/scraper';

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
    scraper_command,
    build_template_request,
    build_ai_request,
    extract_progress_status,
    format_create_summary,
    handle_create_scraper,
    build_create_envelope,
    handle_run_scraper,
    build_run_request,
    build_run_query,
    classify_result,
    parse_result_body,
    parse_sync_timeout,
    is_realtime_page_limit_error,
    classify_dataset,
    SCRAPER_BODY_HINTS,
    parse_max_retries,
    build_ai_trigger_retry,
    print_stub_recovery_note,
    AI_TRIGGER_DEFAULT_RETRIES,
    AI_TRIGGER_RETRY_BASE_MS,
    AI_TRIGGER_RETRY_MAX_MS,
    parse_urls_arg,
    read_input_file,
    resolve_run_inputs,
    is_valid_url,
    validate_heal_prompt,
    build_refactor_request,
    build_next_step,
    build_diff_summary,
    build_approve_next_step,
    build_heal_envelope,
    print_heal_recovery_note,
    handle_heal_scraper,
    format_heal_summary,
    resume_and_poll,
    handle_approve_scraper,
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

        it('returns sentinel running token for in-progress statuses', ()=>{
            expect(extract_progress_status({status: 'running'}))
                .toBe('__running__');
            expect(extract_progress_status({status: 'queued'}))
                .toBe('__running__');
            expect(extract_progress_status({status: 'planner'}))
                .toBe('__running__');
        });

        it('returns terminal failure statuses verbatim so polling stops',
            ()=>{
            expect(extract_progress_status({status: 'failed'}))
                .toBe('failed');
            expect(extract_progress_status({status: 'error'}))
                .toBe('error');
            expect(extract_progress_status({status: 'cancelled'}))
                .toBe('cancelled');
        });

        it('returns undefined for missing/invalid input', ()=>{
            expect(extract_progress_status(null as never)).toBeUndefined();
            expect(extract_progress_status({} as never)).toBeUndefined();
        });

        it('returns the awaiting-approval sentinel for pending_answer', ()=>{
            expect(extract_progress_status({status: 'pending_answer'}))
                .toBe('__awaiting_approval__');
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

    describe('format_heal_summary', ()=>{
        it('includes the collector id, prompt, step count, and '
            +'next-step command', ()=>{
            const out = format_heal_summary(
                'c_abc',
                'fix the price selector',
                'bdata scraper run c_abc https://x.com/p/1',
                {status: 'done', completed_steps: ['plan', 'patch']}
            );
            expect(out).toContain('c_abc');
            expect(out).toContain('fix the price selector');
            expect(out).toContain('2');
            expect(out).toContain(
                'bdata scraper run c_abc https://x.com/p/1');
        });

        it('handles missing completed_steps as zero', ()=>{
            const out = format_heal_summary('c_abc', 'p',
                'bdata scraper run c_abc <url>', {status: 'done'});
            expect(out).toContain('0');
        });
    });

    describe('build_create_envelope', ()=>{
        it('returns the documented success shape', ()=>{
            const env = build_create_envelope({
                collector_id: 'c_xyz',
                name: 'product-v1',
                status: 'done',
                progress: {status: 'done',
                    completed_steps: ['a', 'b', 'c']},
                created_at: '2026-05-18T07:28:30Z',
            });
            expect(env).toEqual({
                collector_id: 'c_xyz',
                name: 'product-v1',
                status: 'done',
                completed_steps: ['a', 'b', 'c'],
                view_url: 'https://brightdata.com/cp/scrapers/c_xyz',
                created_at: '2026-05-18T07:28:30Z',
            });
        });

        it('omits created_at when not known', ()=>{
            const env = build_create_envelope({
                collector_id: 'c_xyz',
                name: 'n',
                status: 'done',
                progress: {status: 'done', completed_steps: []},
            });
            expect(env).not.toHaveProperty('created_at');
        });

        it('records the error message and partial steps on failure',
            ()=>{
            const env = build_create_envelope({
                collector_id: 'c_xyz',
                name: 'n',
                status: 'ai_trigger_failed',
                error: 'Cannot run more than 3 jobs in parallel',
            });
            expect(env.collector_id).toBe('c_xyz');
            expect(env.status).toBe('ai_trigger_failed');
            expect(env.error).toMatch(/parallel/);
            expect(env.completed_steps).toEqual([]);
            expect(env.view_url)
                .toBe('https://brightdata.com/cp/scrapers/c_xyz');
        });

        it('still includes view_url on every termination path', ()=>{
            for (const status of ['done', 'failed', 'ai_trigger_failed',
                'poll_failed'])
            {
                const env = build_create_envelope({
                    collector_id: 'c_xyz', name: 'n', status,
                });
                expect(env.view_url)
                    .toBe('https://brightdata.com/cp/scrapers/c_xyz');
            }
        });
    });

    describe('handle_create_scraper envelope output', ()=>{
        const setup_success = ()=>{
            mocks.post
                .mockResolvedValueOnce({
                    id: 'c_xyz', name: 'product-v1',
                    created: '2026-05-18T07:28:30Z',
                })
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done',
                    completed_steps: ['a', 'b', 'c']},
                attempts: 4,
            });
        };

        it('writes the new envelope to -o on success', async()=>{
            setup_success();
            await handle_create_scraper(
                'https://x.com/p', 'd',
                {output: 'create.json', pretty: true}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_xyz',
                    name: 'product-v1',
                    status: 'done',
                    completed_steps: ['a', 'b', 'c'],
                    view_url: 'https://brightdata.com/cp/scrapers/c_xyz',
                    created_at: '2026-05-18T07:28:30Z',
                }),
                expect.objectContaining({output: 'create.json'})
            );
        });

        it('the documented `jq -r .collector_id` recipe works on the '
            +'envelope', async()=>{
            setup_success();
            await handle_create_scraper('https://x.com/p', 'd',
                {output: 'create.json'});
            const written = mocks.print.mock.calls[0][0] as {
                collector_id?: string};
            expect(written.collector_id).toBe('c_xyz');
        });

        it('--legacy-output preserves the bare progress payload',
            async()=>{
            setup_success();
            await handle_create_scraper(
                'https://x.com/p', 'd',
                {output: 'create.json', legacyOutput: true}
            );
            const written = mocks.print.mock.calls[0][0] as {
                collector_id?: unknown; status?: string};
            expect(written.collector_id).toBeUndefined();
            expect(written).not.toHaveProperty('view_url');
            expect(written.status).toBe('done');
        });

        it('writes the envelope when AI trigger fails (stub-collector '
            +'recovery path), with a single-line error', async()=>{
            // multi-line client error -> envelope keeps the first line.
            mocks.post
                .mockResolvedValueOnce({id: 'c_stub', name: 'n'})
                .mockRejectedValueOnce(new Error(
                    'Error: Cannot run more than 3 jobs in parallel\n'
                    +'  Status: 429\n  Hint: serialise your launches.'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper(
                'https://x.com/p', 'd',
                {output: 'create.json'}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_stub',
                    status: 'ai_trigger_failed',
                    error: 'Cannot run more than 3 jobs in parallel',
                    view_url: 'https://brightdata.com/cp/scrapers/c_stub',
                }),
                expect.objectContaining({output: 'create.json'})
            );
            exit.mockRestore();
            error.mockRestore();
        });

        it('writes the envelope when poll returns status != done',
            async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc', name: 'n'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'failed',
                    completed_steps: ['planner']},
                attempts: 2,
            });
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper(
                'https://x.com/p', 'd',
                {output: 'create.json'}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'failed',
                    completed_steps: ['planner'],
                    error: expect.stringMatching(/finished with status/),
                }),
                expect.objectContaining({output: 'create.json'})
            );
            exit.mockRestore();
            error.mockRestore();
        });

        it('writes the envelope when polling itself throws (timeout '
            +'or network)', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc', name: 'n'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockRejectedValue(
                new Error(
                    'Timeout after 600 seconds waiting for AI generation'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper(
                'https://x.com/p', 'd',
                {output: 'create.json'}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'poll_failed',
                    error: expect.stringMatching(/Timeout/),
                }),
                expect.objectContaining({output: 'create.json'})
            );
            exit.mockRestore();
            error.mockRestore();
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
                expect.objectContaining({
                    collector_id: 'c_abc',
                    name: 'cli-scraper-1',
                    status: 'done',
                    completed_steps: ['a', 'b'],
                    view_url: 'https://brightdata.com/cp/scrapers/c_abc',
                }),
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
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'done',
                }),
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

    describe('parse_max_retries', ()=>{
        it('defaults to the AI-trigger default when undefined', ()=>{
            expect(parse_max_retries(undefined))
                .toBe(AI_TRIGGER_DEFAULT_RETRIES);
        });

        it('parses a non-negative integer', ()=>{
            expect(parse_max_retries('0')).toBe(0);
            expect(parse_max_retries('1')).toBe(1);
            expect(parse_max_retries('8')).toBe(8);
        });

        it('rejects negatives, floats, and non-numeric', ()=>{
            expect(()=>parse_max_retries('-1')).toThrow(/non-negative/);
            expect(()=>parse_max_retries('1.5')).toThrow(/non-negative/);
            expect(()=>parse_max_retries('abc')).toThrow(/non-negative/);
        });
    });

    describe('build_ai_trigger_retry', ()=>{
        it('returns the default schedule when no flags are set', ()=>{
            const cfg = build_ai_trigger_retry({});
            expect(cfg.max_attempts).toBe(AI_TRIGGER_DEFAULT_RETRIES);
            expect(cfg.base_ms).toBe(AI_TRIGGER_RETRY_BASE_MS);
            expect(cfg.max_ms).toBe(AI_TRIGGER_RETRY_MAX_MS);
            expect(typeof cfg.on_retry).toBe('function');
        });

        it('--max-retries overrides max_attempts', ()=>{
            const cfg = build_ai_trigger_retry({maxRetries: '8'});
            expect(cfg.max_attempts).toBe(8);
            expect(cfg.base_ms).toBe(AI_TRIGGER_RETRY_BASE_MS);
        });

        it('--no-retry (retry===false) disables retries entirely', ()=>{
            const cfg = build_ai_trigger_retry({retry: false});
            expect(cfg.max_attempts).toBe(0);
        });

        it('on_retry emits a 429-specific stderr line when status=429',
            ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            build_ai_trigger_retry({}).on_retry!({
                attempt: 1, max_attempts: 4,
                delay_ms: 32_000, status: 429,
            });
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/AI-Flow concurrent-job cap/);
            expect(msg).toMatch(/32s/);
            expect(msg).toMatch(/retry 1\/4/);
            error.mockRestore();
        });

        it('on_retry emits a generic transient line for non-429', ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            build_ai_trigger_retry({}).on_retry!({
                attempt: 2, max_attempts: 4,
                delay_ms: 60_000, status: 503,
            });
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/Transient error/);
            expect(msg).toMatch(/status 503/);
            error.mockRestore();
        });

        it('on_retry handles network-error case (status=0)', ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            build_ai_trigger_retry({}).on_retry!({
                attempt: 1, max_attempts: 4,
                delay_ms: 30_000, status: 0,
            });
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/status network/);
            error.mockRestore();
        });
    });

    describe('--no-retry flag wiring (commander)', ()=>{
        it('maps --no-retry to retry===false so retries are disabled',
            ()=>{
            let captured: Scraper_create_opts|undefined;
            const cmd = new Command('create')
                .argument('[url]')
                .argument('[desc]')
                .option('--max-retries <n>', 'max')
                .option('--no-retry', 'fail fast')
                .action((_u, _d, opts: Scraper_create_opts)=>{
                    captured = opts;
                });
            cmd.parse(['u', 'd', '--no-retry'], {from: 'user'});
            expect(captured!.retry).toBe(false);
            expect(build_ai_trigger_retry(captured!).max_attempts)
                .toBe(0);
        });
    });

    describe('print_stub_recovery_note', ()=>{
        it('prints a dashboard URL and a manual-deletion notice', ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            print_stub_recovery_note('c_xyz');
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toContain('c_xyz');
            expect(msg).toMatch(
                /https:\/\/brightdata\.com\/cp\/scrapers\/c_xyz/);
            expect(msg).toMatch(/inspect or delete it manually/);
            expect(msg).toMatch(/does not yet expose programmatic/);
            error.mockRestore();
        });

        it('does nothing when collector_id is empty', ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            print_stub_recovery_note('');
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });
    });

    describe('handle_create_scraper retry + stub-nudge wiring', ()=>{
        it('passes the AI-trigger retry config to the second post call',
            async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_create_scraper('https://x.com', 'd', {});
            const ai_call_opts = mocks.post.mock.calls[1][3] as
                {retry?: {max_attempts: number; base_ms: number}};
            expect(ai_call_opts.retry).toBeDefined();
            expect(ai_call_opts.retry!.max_attempts)
                .toBe(AI_TRIGGER_DEFAULT_RETRIES);
            expect(ai_call_opts.retry!.base_ms)
                .toBe(AI_TRIGGER_RETRY_BASE_MS);
        });

        it('honors --max-retries on the AI-trigger', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_create_scraper('https://x.com', 'd',
                {maxRetries: '10'});
            const ai_call_opts = mocks.post.mock.calls[1][3] as
                {retry?: {max_attempts: number}};
            expect(ai_call_opts.retry!.max_attempts).toBe(10);
        });

        it('honors --no-retry (max_attempts = 0)', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_create_scraper('https://x.com', 'd',
                {retry: false});
            const ai_call_opts = mocks.post.mock.calls[1][3] as
                {retry?: {max_attempts: number}};
            expect(ai_call_opts.retry!.max_attempts).toBe(0);
        });

        it('emits the stub-recovery note when AI-trigger ultimately fails',
            async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_stub'})
                .mockRejectedValueOnce(
                    new Error('Cannot run more than 3 jobs in parallel'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toContain('c_stub');
            expect(msg).toMatch(/inspect or delete it manually/);
            exit.mockRestore();
            error.mockRestore();
        });

        it('emits the stub-recovery note when poll status != done',
            async()=>{
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
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/inspect or delete it manually/);
            expect(msg).toContain('c_abc');
            exit.mockRestore();
            error.mockRestore();
        });

        it('emits the stub-recovery note when polling itself throws',
            async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'c_abc'})
                .mockResolvedValueOnce({id: 'ia_xyz', queued: false});
            mocks.poll_until.mockRejectedValue(
                new Error('Timeout after 600 seconds'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_create_scraper('https://x.com', 'd', {});
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/inspect or delete it manually/);
            exit.mockRestore();
            error.mockRestore();
        });
    });

    describe('is_valid_url', ()=>{
        it('accepts http/https URLs', ()=>{
            expect(is_valid_url('https://example.com')).toBe(true);
            expect(is_valid_url('http://example.com/a/b?c=1')).toBe(true);
        });

        it('rejects garbage', ()=>{
            expect(is_valid_url('not a url')).toBe(false);
            expect(is_valid_url('')).toBe(false);
            expect(is_valid_url('  ')).toBe(false);
        });
    });

    describe('validate_heal_prompt', ()=>{
        it('returns the trimmed prompt for valid input', ()=>{
            expect(validate_heal_prompt('  fix the price selector  '))
                .toBe('fix the price selector');
        });

        it('throws on empty / whitespace-only prompt', ()=>{
            expect(()=>validate_heal_prompt('')).toThrow(/prompt/i);
            expect(()=>validate_heal_prompt('   ')).toThrow(/prompt/i);
        });

        it('throws when prompt exceeds 1000 chars', ()=>{
            expect(()=>validate_heal_prompt('x'.repeat(1001)))
                .toThrow(/1000/);
        });

        it('accepts a prompt exactly at the 1000-char limit', ()=>{
            const p = 'x'.repeat(1000);
            expect(validate_heal_prompt(p)).toBe(p);
        });
    });

    describe('build_refactor_request', ()=>{
        it('wraps the prompt with an empty custom_input array', ()=>{
            expect(build_refactor_request('fix selectors')).toEqual({
                prompt: 'fix selectors',
                custom_input: [],
            });
        });
    });

    describe('build_next_step', ()=>{
        it('bakes in the real url when provided', ()=>{
            expect(build_next_step('c_abc', 'https://x.com/p/1'))
                .toBe('bdata scraper run c_abc https://x.com/p/1');
        });

        it('uses a <url> placeholder when no url is provided', ()=>{
            expect(build_next_step('c_abc', undefined))
                .toBe('bdata scraper run c_abc <url>');
        });
    });

    describe('build_diff_summary', ()=>{
        it('summarizes a well-formed template diff by step count', ()=>{
            const diff = {
                template_a: {steps: [{name: 'a'}, {name: 'b'}]},
                template_b: {steps: [{name: 'a'}, {name: 'b'}, {name: 'c'}]},
            };
            const out = build_diff_summary(diff);
            expect(out).toMatch(/step/i);
            expect(out).toContain('3');
        });

        it('falls back to a generic note for a malformed diff', ()=>{
            expect(build_diff_summary(null)).toMatch(/see view_url/i);
            expect(build_diff_summary({nope: 1})).toMatch(/see view_url/i);
            expect(build_diff_summary('garbage')).toMatch(/see view_url/i);
        });
    });

    describe('build_approve_next_step', ()=>{
        it('builds an approve command with --url when url given', ()=>{
            expect(build_approve_next_step('c_abc', 'https://x.com/p/1'))
                .toBe('bdata scraper approve c_abc '
                    +'--url https://x.com/p/1');
        });

        it('omits --url when no url is provided', ()=>{
            expect(build_approve_next_step('c_abc', undefined))
                .toBe('bdata scraper approve c_abc');
        });
    });

    describe('build_heal_envelope', ()=>{
        it('returns the documented success shape', ()=>{
            const env = build_heal_envelope({
                collector_id: 'c_xyz',
                status: 'done',
                prompt: 'fix price',
                progress: {status: 'done', completed_steps: ['plan', 'patch']},
                url: 'https://x.com/p/1',
            });
            expect(env).toEqual({
                collector_id: 'c_xyz',
                status: 'done',
                completed_steps: ['plan', 'patch'],
                prompt: 'fix price',
                view_url: 'https://brightdata.com/cp/scrapers/c_xyz',
                next_step: 'bdata scraper run c_xyz https://x.com/p/1',
            });
        });

        it('uses a <url> placeholder in next_step when no url given', ()=>{
            const env = build_heal_envelope({
                collector_id: 'c_xyz',
                status: 'done',
                prompt: 'fix price',
                progress: {status: 'done', completed_steps: []},
            });
            expect(env.next_step)
                .toBe('bdata scraper run c_xyz <url>');
        });

        it('records error + empty steps on failure, keeps view_url '
            +'and next_step', ()=>{
            const env = build_heal_envelope({
                collector_id: 'c_xyz',
                status: 'heal_trigger_failed',
                prompt: 'fix price',
                error: 'Cannot run more than 3 jobs in parallel',
            });
            expect(env.status).toBe('heal_trigger_failed');
            expect(env.error).toMatch(/parallel/);
            expect(env.completed_steps).toEqual([]);
            expect(env.view_url)
                .toBe('https://brightdata.com/cp/scrapers/c_xyz');
            expect(env.next_step)
                .toBe('bdata scraper run c_xyz <url>');
        });

        it('on awaiting_approval includes preview_result, diff_summary, '
            +'and an approve next_step', ()=>{
            const env = build_heal_envelope({
                collector_id: 'c_xyz',
                status: 'awaiting_approval',
                prompt: 'fix it',
                progress: {
                    status: 'pending_answer',
                    completed_steps: ['planner', 'code_fixer'],
                    preview_result: [{title: 'A Light in the Attic'}],
                    diff: {template_b: {steps: [{name: 'x'}, {name: 'y'}]}},
                },
                url: 'https://x.com/p/1',
            });
            expect(env.status).toBe('awaiting_approval');
            expect(env.preview_result)
                .toEqual([{title: 'A Light in the Attic'}]);
            expect(env.diff_summary).toMatch(/2 step/);
            expect(env.next_step)
                .toBe('bdata scraper approve c_xyz '
                    +'--url https://x.com/p/1');
        });

        it('on done keeps the run next_step and omits gate fields', ()=>{
            const env = build_heal_envelope({
                collector_id: 'c_xyz',
                status: 'done',
                prompt: 'fix it',
                progress: {status: 'done', completed_steps: ['patch']},
                url: 'https://x.com/p/1',
            });
            expect(env.next_step)
                .toBe('bdata scraper run c_xyz https://x.com/p/1');
            expect(env).not.toHaveProperty('preview_result');
            expect(env).not.toHaveProperty('diff_summary');
        });
    });

    describe('print_heal_recovery_note', ()=>{
        it('reassures that the scraper is unchanged and points to the UI',
            ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            print_heal_recovery_note('c_xyz');
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toContain('c_xyz');
            expect(msg).toMatch(
                /https:\/\/brightdata\.com\/cp\/scrapers\/c_xyz/);
            expect(msg).toMatch(/unchanged|still works|was not modified/i);
            // Must NOT reuse create's destructive "half-built" wording.
            expect(msg).not.toMatch(/half-built/);
            error.mockRestore();
        });

        it('does nothing when collector_id is empty', ()=>{
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            print_heal_recovery_note('');
            expect(error).not.toHaveBeenCalled();
            error.mockRestore();
        });
    });

    describe('parse_urls_arg', ()=>{
        it('splits, trims, and drops empties', ()=>{
            expect(parse_urls_arg(
                ' https://a.com , https://b.com ,, https://c.com'))
                .toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
        });

        it('returns single URL for a non-comma input', ()=>{
            expect(parse_urls_arg('https://only.example.com'))
                .toEqual(['https://only.example.com']);
        });

        it('returns empty array for blank input', ()=>{
            expect(parse_urls_arg('')).toEqual([]);
            expect(parse_urls_arg('  , ,  ')).toEqual([]);
        });
    });

    describe('read_input_file', ()=>{
        let tmp_dir: string;

        beforeEach(()=>{
            tmp_dir = mkdtempSync(join(tmpdir(), 'bdata-test-'));
        });

        afterEach(()=>{
            rmSync(tmp_dir, {recursive: true, force: true});
        });

        const write = (name: string, content: string): string=>{
            const p = join(tmp_dir, name);
            writeFileSync(p, content, 'utf8');
            return p;
        };

        it('reads newline-separated URLs', ()=>{
            const p = write('urls.txt',
                'https://a.com\nhttps://b.com\nhttps://c.com');
            expect(read_input_file(p)).toEqual([
                'https://a.com', 'https://b.com', 'https://c.com']);
        });

        it('skips blank lines and # comments', ()=>{
            const p = write('urls.txt',
                '# top comment\n'
                +'https://a.com\n'
                +'\n'
                +'   \n'
                +'# section\n'
                +'https://b.com    # inline comment ok\n'
                +'https://c.com');
            expect(read_input_file(p)).toEqual([
                'https://a.com', 'https://b.com', 'https://c.com']);
        });

        it('reads JSON array of strings', ()=>{
            const p = write('urls.json',
                JSON.stringify(['https://a.com', 'https://b.com']));
            expect(read_input_file(p)).toEqual([
                'https://a.com', 'https://b.com']);
        });

        it('reads JSON array of {url} objects', ()=>{
            const p = write('urls.json', JSON.stringify([
                {url: 'https://a.com'},
                {url: 'https://b.com', extra: 'ignored'},
            ]));
            expect(read_input_file(p)).toEqual([
                'https://a.com', 'https://b.com']);
        });

        it('throws on missing file', ()=>{
            expect(()=>read_input_file(join(tmp_dir, 'missing.txt')))
                .toThrow(/Cannot read --input-file/);
        });

        it('throws on malformed JSON', ()=>{
            const p = write('bad.json', '[{not valid');
            expect(()=>read_input_file(p))
                .toThrow(/failed to parse/);
        });

        it('throws on non-array JSON', ()=>{
            const p = write('obj.json', '{"url": "https://a.com"}');
            expect(()=>read_input_file(p))
                .toThrow(/must be an array/);
        });

        it('throws on JSON entry with neither string nor {url}', ()=>{
            const p = write('mixed.json',
                JSON.stringify(['https://a.com', {wrong: 'field'}]));
            expect(()=>read_input_file(p))
                .toThrow(/must be a string or an object with a "url"/);
        });

        it('returns empty array for an empty file', ()=>{
            const p = write('empty.txt', '   \n\n  ');
            expect(read_input_file(p)).toEqual([]);
        });
    });

    describe('resolve_run_inputs', ()=>{
        let tmp_dir: string;

        beforeEach(()=>{
            tmp_dir = mkdtempSync(join(tmpdir(), 'bdata-test-'));
        });

        afterEach(()=>{
            rmSync(tmp_dir, {recursive: true, force: true});
        });

        it('returns the positional URL as a single-element list', ()=>{
            expect(resolve_run_inputs('https://a.com', {}))
                .toEqual(['https://a.com']);
        });

        it('parses --urls', ()=>{
            expect(resolve_run_inputs(undefined,
                {urls: 'https://a.com,https://b.com'}))
                .toEqual(['https://a.com', 'https://b.com']);
        });

        it('reads --input-file', ()=>{
            const p = join(tmp_dir, 'urls.txt');
            writeFileSync(p, 'https://a.com\nhttps://b.com', 'utf8');
            expect(resolve_run_inputs(undefined, {inputFile: p}))
                .toEqual(['https://a.com', 'https://b.com']);
        });

        it('rejects when no source is provided', ()=>{
            expect(()=>resolve_run_inputs(undefined, {}))
                .toThrow(/requires one of: <url> positional, --urls/);
        });

        it('rejects when multiple sources are provided', ()=>{
            expect(()=>resolve_run_inputs('https://a.com',
                {urls: 'https://b.com'}))
                .toThrow(/only one input source/);
            expect(()=>resolve_run_inputs(undefined,
                {urls: 'https://a.com', inputFile: '/tmp/x'}))
                .toThrow(/only one input source/);
        });

        it('rejects when parsed list is empty', ()=>{
            expect(()=>resolve_run_inputs(undefined, {urls: '  , ,  '}))
                .toThrow(/No URLs to scrape/);
        });

        it('rejects invalid URLs and names them', ()=>{
            expect(()=>resolve_run_inputs(undefined,
                {urls: 'https://a.com,not-a-url,also bad'}))
                .toThrow(/Invalid URL\(s\):.*not-a-url/);
        });
    });

    describe('handle_heal_scraper', ()=>{
        it('chains trigger → poll and prints the envelope in non-TTY',
            async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz', queued: false});
            mocks.get.mockResolvedValue({status: 'done',
                completed_steps: ['plan', 'patch']});
            mocks.poll_until.mockImplementation(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                await cfg.fetch_once();
                return {result: {status: 'done',
                    completed_steps: ['plan', 'patch']}, attempts: 3};
            });
            await handle_heal_scraper('c_abc', 'fix the price selector',
                {url: 'https://x.com/p/1'});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/dca/collectors/c_abc/refactor_template',
                {prompt: 'fix the price selector', custom_input: []},
                expect.objectContaining({hints: SCRAPER_BODY_HINTS})
            );
            expect(mocks.poll_until).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeout_seconds: 600,
                    running_statuses: ['__running__'],
                    timeout_label: expect.stringContaining('c_abc'),
                })
            );
            expect(mocks.get).toHaveBeenCalledWith(
                'api_key',
                '/dca/collectors/c_abc/refactor_template/progress',
                expect.objectContaining({hints: SCRAPER_BODY_HINTS})
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'done',
                    completed_steps: ['plan', 'patch'],
                    prompt: 'fix the price selector',
                    view_url: 'https://brightdata.com/cp/scrapers/c_abc',
                    next_step:
                        'bdata scraper run c_abc https://x.com/p/1',
                }),
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('passes the AI-trigger retry config to the refactor post',
            async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz'});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_heal_scraper('c_abc', 'fix it', {maxRetries: '7'});
            const opts = mocks.post.mock.calls[0][3] as
                {retry?: {max_attempts: number}};
            expect(opts.retry!.max_attempts).toBe(7);
        });

        it('fails fast on an empty prompt (no network call)', async()=>{
            await expect(handle_heal_scraper('c_abc', '   ', {}))
                .rejects.toThrow(/prompt/i);
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringMatching(/prompt/i));
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('fails fast on an over-long prompt (no network call)',
            async()=>{
            await expect(
                handle_heal_scraper('c_abc', 'x'.repeat(1001), {}))
                .rejects.toThrow(/1000/);
            expect(mocks.post).not.toHaveBeenCalled();
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringMatching(/1000/));
        });

        it('fails fast on an invalid --url (no network call)', async()=>{
            await expect(
                handle_heal_scraper('c_abc', 'fix it',
                    {url: 'not-a-url'}))
                .rejects.toThrow(/url/i);
            expect(mocks.post).not.toHaveBeenCalled();
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringMatching(/url/i));
        });

        it('emits the failure envelope + recovery note when trigger '
            +'fails', async()=>{
            mocks.post.mockRejectedValueOnce(
                new Error('Cannot run more than 3 jobs in parallel'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_heal_scraper('c_abc', 'fix it',
                {output: 'heal.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'heal_trigger_failed',
                    error: 'Cannot run more than 3 jobs in parallel',
                }),
                expect.objectContaining({output: 'heal.json'})
            );
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/unchanged|still works/i);
            expect(exit).toHaveBeenCalledWith(1);
            exit.mockRestore();
            error.mockRestore();
        });

        it('emits the failure envelope when poll returns status != done',
            async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz'});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'failed', completed_steps: ['plan']},
                attempts: 2,
            });
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_heal_scraper('c_abc', 'fix it',
                {output: 'heal.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'failed',
                    completed_steps: ['plan'],
                    error: expect.stringMatching(/finished with status/),
                }),
                expect.objectContaining({output: 'heal.json'})
            );
            expect(exit).toHaveBeenCalledWith(1);
            exit.mockRestore();
            error.mockRestore();
        });

        it('emits the failure envelope when polling throws (timeout)',
            async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz'});
            mocks.poll_until.mockRejectedValue(
                new Error('Timeout after 600 seconds waiting for heal'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_heal_scraper('c_abc', 'fix it',
                {output: 'heal.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'poll_failed',
                    error: expect.stringMatching(/Timeout/),
                }),
                expect.objectContaining({output: 'heal.json'})
            );
            expect(exit).toHaveBeenCalledWith(1);
            exit.mockRestore();
            error.mockRestore();
        });

        it('--legacy-output emits the bare progress payload', async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz'});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: ['plan']},
                attempts: 1,
            });
            await handle_heal_scraper('c_abc', 'fix it',
                {output: 'heal.json', legacyOutput: true});
            const written = mocks.print.mock.calls[0][0] as
                {collector_id?: unknown; status?: string};
            expect(written.collector_id).toBeUndefined();
            expect(written).not.toHaveProperty('next_step');
            expect(written.status).toBe('done');
        });

        it('stops at the approval gate with awaiting_approval (exit 0, '
            +'no resume call)', async()=>{
            mocks.post.mockResolvedValueOnce({id: 'rh_xyz'});
            mocks.poll_until.mockResolvedValue({
                result: {
                    status: 'pending_answer',
                    completed_steps: ['planner', 'code_fixer'],
                    preview_result: [{title: 'A Light in the Attic'}],
                    diff: {template_b: {steps: [{name: 'x'}]}},
                },
                attempts: 5,
            });
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            await handle_heal_scraper('c_abc', 'fix it',
                {url: 'https://x.com/p/1', output: 'heal.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'awaiting_approval',
                    preview_result: [{title: 'A Light in the Attic'}],
                    next_step:
                        'bdata scraper approve c_abc --url https://x.com/p/1',
                }),
                expect.objectContaining({output: 'heal.json'})
            );
            expect(mocks.post).toHaveBeenCalledTimes(1);
            expect(exit).not.toHaveBeenCalledWith(1);
            exit.mockRestore();
        });

        it('--auto-approve resumes at the gate and polls to done', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'rh_xyz'})
                .mockResolvedValueOnce({ok: true});
            mocks.poll_until
                .mockResolvedValueOnce({
                    result: {status: 'pending_answer',
                        completed_steps: ['code_fixer'],
                        preview_result: [{title: 't'}], diff: {}},
                    attempts: 3,
                })
                .mockResolvedValueOnce({
                    result: {status: 'done', completed_steps: ['patch']},
                    attempts: 2,
                });
            await handle_heal_scraper('c_abc', 'fix it',
                {url: 'https://x.com/p/1', autoApprove: true,
                    output: 'heal.json'});
            expect(mocks.post).toHaveBeenNthCalledWith(
                2, 'api_key',
                '/dca/collectors/c_abc/resume_automation_job',
                {message: true},
                expect.objectContaining({hints: SCRAPER_BODY_HINTS})
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'done',
                    next_step: 'bdata scraper run c_abc https://x.com/p/1',
                }),
                expect.objectContaining({output: 'heal.json'})
            );
            expect(mocks.poll_until).toHaveBeenCalledTimes(2);
        });

        it('--auto-approve labels a resume POST failure as resume_failed '
            +'(not poll_failed)', async()=>{
            mocks.post
                .mockResolvedValueOnce({id: 'rh_xyz'})            // trigger
                .mockRejectedValueOnce(                            // resume
                    new Error('{"error":"job not awaiting approval"}'));
            mocks.poll_until.mockResolvedValueOnce({
                result: {status: 'pending_answer',
                    completed_steps: ['code_fixer'],
                    preview_result: [{title: 't'}], diff: {}},
                attempts: 3,
            });
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_heal_scraper('c_abc', 'fix it',
                {autoApprove: true, output: 'heal.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({status: 'resume_failed'}),
                expect.objectContaining({output: 'heal.json'})
            );
            expect(exit).toHaveBeenCalledWith(1);
            exit.mockRestore();
            error.mockRestore();
        });
    });

    describe('resume_and_poll', ()=>{
        it('posts resume_automation_job then polls progress, returns '
            +'the poll result', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: ['patch']},
                attempts: 2,
            });
            const out = await resume_and_poll(
                'api_key', 'c_abc', true, {timing: undefined}, 600);
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/dca/collectors/c_abc/resume_automation_job',
                {message: true},
                expect.objectContaining({hints: SCRAPER_BODY_HINTS})
            );
            expect(mocks.poll_until).toHaveBeenCalledWith(
                expect.objectContaining({
                    timeout_seconds: 600,
                    running_statuses: ['__running__'],
                })
            );
            expect(out.result.status).toBe('done');
        });

        it('sends message:false when approve=false (reject)', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await resume_and_poll('api_key', 'c_abc', false,
                {timing: undefined}, 600);
            expect(mocks.post.mock.calls[0][2]).toEqual({message: false});
        });

        it('adds auto_save:true to the body when approving with '
            +'autoSave set', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await resume_and_poll('api_key', 'c_abc', true,
                {timing: undefined, autoSave: true}, 600);
            expect(mocks.post.mock.calls[0][2]).toEqual({
                message: true, auto_save: true,
            });
        });

        it('omits auto_save when approving without autoSave', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await resume_and_poll('api_key', 'c_abc', true,
                {timing: undefined}, 600);
            expect(mocks.post.mock.calls[0][2]).toEqual({message: true});
        });

        it('never sends auto_save on reject, even if autoSave set',
            async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await resume_and_poll('api_key', 'c_abc', false,
                {timing: undefined, autoSave: true}, 600);
            expect(mocks.post.mock.calls[0][2]).toEqual({message: false});
        });
    });

    describe('handle_approve_scraper', ()=>{
        it('resumes (message:true) and polls to done, emits run next_step',
            async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: ['patch']},
                attempts: 2,
            });
            await handle_approve_scraper('c_abc',
                {url: 'https://x.com/p/1', output: 'approve.json'});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/dca/collectors/c_abc/resume_automation_job',
                {message: true},
                expect.objectContaining({hints: SCRAPER_BODY_HINTS})
            );
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'done',
                    next_step: 'bdata scraper run c_abc https://x.com/p/1',
                }),
                expect.objectContaining({output: 'approve.json'})
            );
        });

        it('--reject sends message:false and reports rejected', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'done', completed_steps: []},
                attempts: 1,
            });
            await handle_approve_scraper('c_abc',
                {reject: true, output: 'approve.json'});
            expect(mocks.post.mock.calls[0][2]).toEqual({message: false});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({status: 'rejected'}),
                expect.objectContaining({output: 'approve.json'})
            );
        });

        it('re-gates: poll returns pending_answer again → '
            +'awaiting_approval (re-runnable)', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockResolvedValue({
                result: {status: 'pending_answer',
                    completed_steps: ['code_fixer'],
                    preview_result: [{title: 't'}], diff: {}},
                attempts: 3,
            });
            await handle_approve_scraper('c_abc',
                {url: 'https://x.com/p/1', output: 'approve.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'awaiting_approval',
                    next_step:
                        'bdata scraper approve c_abc --url https://x.com/p/1',
                }),
                expect.objectContaining({output: 'approve.json'})
            );
        });

        it('fails fast on an invalid --url (no resume call)', async()=>{
            await expect(
                handle_approve_scraper('c_abc', {url: 'not-a-url'}))
                .rejects.toThrow(/url/i);
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('emits resume_failed + recovery note + exit 1 when resume '
            +'fails', async()=>{
            mocks.post.mockRejectedValueOnce(
                new Error('{"error":"job not awaiting approval"}'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_approve_scraper('c_abc', {output: 'approve.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({
                    collector_id: 'c_abc',
                    status: 'resume_failed',
                }),
                expect.objectContaining({output: 'approve.json'})
            );
            expect(exit).toHaveBeenCalledWith(1);
            const msg = error.mock.calls.map(c=>String(c[0])).join('\n');
            expect(msg).toMatch(/unchanged|still works/i);
            exit.mockRestore();
            error.mockRestore();
        });

        it('emits poll_failed + recovery note on poll timeout', async()=>{
            mocks.post.mockResolvedValueOnce({ok: true});
            mocks.poll_until.mockRejectedValue(
                new Error('Timeout after 600 seconds waiting for heal'));
            const exit = vi.spyOn(process, 'exit')
                .mockImplementation(()=>undefined as never);
            const error = vi.spyOn(console, 'error')
                .mockImplementation(()=>{});
            await handle_approve_scraper('c_abc', {output: 'approve.json'});
            expect(mocks.print).toHaveBeenCalledWith(
                expect.objectContaining({status: 'poll_failed'}),
                expect.objectContaining({output: 'approve.json'})
            );
            expect(exit).toHaveBeenCalledWith(1);
            exit.mockRestore();
            error.mockRestore();
        });
    });

    describe('handle_run_scraper multi-URL', ()=>{
        let fetch_spy: ReturnType<typeof vi.spyOn>;
        let tmp_dir: string;

        beforeEach(()=>{
            fetch_spy = vi.spyOn(global, 'fetch') as never;
            tmp_dir = mkdtempSync(join(tmpdir(), 'bdata-test-'));
        });

        afterEach(()=>{
            fetch_spy.mockRestore();
            rmSync(tmp_dir, {recursive: true, force: true});
        });

        it('--urls posts an array body to /dca/trigger and polls /dca/dataset',
            async()=>{
            mocks.post.mockResolvedValueOnce({collection_id: 'd_batch'});
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve(
                    '[{"title":"A"},{"title":"B"},{"title":"C"}]'),
            } as unknown as Response));
            mocks.poll_until.mockImplementationOnce(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1, last_status: '__ready__'};
            });
            await handle_run_scraper('c_abc', undefined, {
                urls: 'https://a.com,https://b.com,https://c.com',
            });
            expect(mocks.post).toHaveBeenCalledTimes(1);
            const call = mocks.post.mock.calls[0];
            expect(String(call[1])).toMatch(/\/dca\/trigger\?collector=c_abc/);
            expect(call[2]).toEqual([
                {url: 'https://a.com'},
                {url: 'https://b.com'},
                {url: 'https://c.com'},
            ]);
            expect(mocks.print).toHaveBeenCalledWith(
                [{title: 'A'}, {title: 'B'}, {title: 'C'}],
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

        it('--input-file routes to the same batch path', async()=>{
            const p = join(tmp_dir, 'urls.txt');
            writeFileSync(p, 'https://a.com\nhttps://b.com', 'utf8');
            mocks.post.mockResolvedValueOnce({collection_id: 'd_batch'});
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve('[{"ok":1},{"ok":2}]'),
            } as unknown as Response));
            mocks.poll_until.mockImplementationOnce(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1, last_status: '__ready__'};
            });
            await handle_run_scraper('c_abc', undefined, {inputFile: p});
            expect(mocks.post.mock.calls[0][2]).toEqual([
                {url: 'https://a.com'},
                {url: 'https://b.com'},
            ]);
        });

        it('rejects --sync combined with --urls', async()=>{
            await expect(
                handle_run_scraper('c_abc', undefined, {
                    sync: true,
                    urls: 'https://a.com,https://b.com',
                })
            ).rejects.toThrow(/--sync cannot be combined with --urls/);
            expect(mocks.fail).toHaveBeenCalledWith(
                expect.stringContaining(
                    '--sync cannot be combined with --urls'));
            expect(mocks.post).not.toHaveBeenCalled();
        });

        it('rejects when no URL source is provided', async()=>{
            await expect(
                handle_run_scraper('c_abc', undefined, {})
            ).rejects.toThrow(
                /requires one of: <url> positional, --urls, or --input-file/);
        });

        it('rejects when positional and --urls are both set', async()=>{
            await expect(
                handle_run_scraper('c_abc', 'https://a.com',
                    {urls: 'https://b.com'})
            ).rejects.toThrow(/only one input source/);
        });

        it('single URL via --urls still takes the legacy single path',
            async()=>{
            mocks.post.mockResolvedValueOnce({response_id: 'r_xyz'});
            fetch_spy.mockImplementation(()=>Promise.resolve({
                status: 200,
                text: ()=>Promise.resolve('{"title":"only"}'),
            } as unknown as Response));
            mocks.poll_until.mockImplementationOnce(async(o: never)=>{
                const cfg = o as {fetch_once: ()=>Promise<unknown>};
                const r = await cfg.fetch_once();
                return {result: r, attempts: 1, last_status: '__ready__'};
            });
            await handle_run_scraper('c_abc', undefined,
                {urls: 'https://only.com'});
            expect(String(mocks.post.mock.calls[0][1])).toMatch(
                /\/dca\/trigger_immediate\?collector=c_abc/);
            expect(mocks.post.mock.calls[0][2]).toEqual(
                {url: 'https://only.com'});
        });
    });

    describe('heal_subcommand wiring', ()=>{
        it('is registered on scraper_command with required args', ()=>{
            const heal = scraper_command.commands
                .find(c=>c.name()=='heal');
            expect(heal).toBeDefined();
            expect(heal!.usage()).toMatch(/<collector_id>/);
            expect(heal!.usage()).toMatch(/<prompt>/);
        });

        it('exposes --url, --timeout, --max-retries, --no-retry', ()=>{
            const heal = scraper_command.commands
                .find(c=>c.name()=='heal')!;
            const flags = heal.options.map(o=>o.long);
            expect(flags).toContain('--url');
            expect(flags).toContain('--timeout');
            expect(flags).toContain('--max-retries');
            expect(flags).toContain('--no-retry');
        });
    });

    describe('approve_subcommand wiring', ()=>{
        it('is registered on scraper_command with a required '
            +'collector_id', ()=>{
            const approve = scraper_command.commands
                .find(c=>c.name()=='approve');
            expect(approve).toBeDefined();
            expect(approve!.usage()).toMatch(/<collector_id>/);
        });

        it('exposes --reject, --url, --timeout but NOT retry flags', ()=>{
            const approve = scraper_command.commands
                .find(c=>c.name()=='approve')!;
            const flags = approve.options.map(o=>o.long);
            expect(flags).toContain('--reject');
            expect(flags).toContain('--url');
            expect(flags).toContain('--timeout');
            expect(flags).not.toContain('--max-retries');
            expect(flags).not.toContain('--no-retry');
        });

        it('heal exposes --auto-approve', ()=>{
            const heal = scraper_command.commands
                .find(c=>c.name()=='heal')!;
            expect(heal.options.map(o=>o.long))
                .toContain('--auto-approve');
        });

        it('approve exposes --auto-save', ()=>{
            const approve = scraper_command.commands
                .find(c=>c.name()=='approve')!;
            expect(approve.options.map(o=>o.long))
                .toContain('--auto-save');
        });

        it('heal exposes --auto-save', ()=>{
            const heal = scraper_command.commands
                .find(c=>c.name()=='heal')!;
            expect(heal.options.map(o=>o.long))
                .toContain('--auto-save');
        });
    });
});
