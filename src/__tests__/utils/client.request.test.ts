import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';

// load_config() reads a real file from the user's config dir and can override
// api_url, which would make URL assertions depend on the machine running the
// suite. Pin it.
vi.mock('../../utils/config', ()=>({
    load: ()=>({api_url: 'https://api.brightdata.com'}),
}));

vi.mock('../../utils/output', ()=>({
    dim: (s: string)=>s,
}));

import {
    request,
    get_with_status,
    Client_api_error,
} from '../../utils/client';

const json_response = (status: number, body: unknown)=>new Response(
    JSON.stringify(body),
    {status, headers: {'content-type': 'application/json'}}
);

const text_response = (status: number, body: string)=>new Response(
    body,
    {status, headers: {'content-type': 'text/plain'}}
);

// Fast retries — real backoff starts at 500ms and doubles, which would add
// seconds of wall-clock to the suite.
const fast_retry = {retry: {base_ms: 1, max_ms: 2}};

describe('utils/client.request', ()=>{
    beforeEach(()=>{
        vi.spyOn(console, 'error').mockImplementation(()=>{});
    });

    afterEach(()=>{
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('returns the parsed body only (unchanged contract)', async()=>{
        vi.stubGlobal('fetch', vi.fn(async()=>json_response(200, {ok: 1})));
        await expect(request('key', '/x')).resolves.toEqual({ok: 1});
    });

    it('returns text when the response is not json', async()=>{
        vi.stubGlobal('fetch', vi.fn(async()=>text_response(200, 'a,b\n')));
        await expect(request('key', '/x')).resolves.toBe('a,b\n');
    });

    it('sends bearer auth to the resolved url', async()=>{
        const fetch_mock = vi.fn(async()=>json_response(200, {}));
        vi.stubGlobal('fetch', fetch_mock);
        await request('secret', '/datasets/v3/snapshot/s1');
        const [url, init] = fetch_mock.mock.calls[0] as unknown as
            [string, RequestInit];
        expect(url).toBe(
            'https://api.brightdata.com/datasets/v3/snapshot/s1');
        expect((init.headers as Record<string, string>)['Authorization'])
            .toBe('Bearer secret');
    });

    describe('get_with_status', ()=>{
        it('exposes the status code alongside the body', async()=>{
            vi.stubGlobal('fetch',
                vi.fn(async()=>json_response(200, {rows: 1})));
            const env = await get_with_status('key', '/x');
            expect(env.status).toBe(200);
            expect(env.body).toEqual({rows: 1});
        });

        it('surfaces 202 rather than hiding it behind the body', async()=>{
            // 202 is res.ok, so before this the caller could not tell an
            // accepted-but-unfinished job from finished data.
            vi.stubGlobal('fetch',
                vi.fn(async()=>json_response(202, {status: 'running'})));
            const env = await get_with_status('key', '/x');
            expect(env.status).toBe(202);
        });

        it('exposes response headers', async()=>{
            vi.stubGlobal('fetch',
                vi.fn(async()=>json_response(200, {})));
            const env = await get_with_status('key', '/x');
            expect(env.headers.get('content-type'))
                .toContain('application/json');
        });
    });

    describe('error typing', ()=>{
        it('throws a Client_api_error carrying the status', async()=>{
            vi.stubGlobal('fetch',
                vi.fn(async()=>text_response(404, 'no such dataset')));
            await expect(request('key', '/x', fast_retry))
                .rejects.toBeInstanceOf(Client_api_error);
            try {
                await request('key', '/x', fast_retry);
            } catch(e) {
                const err = e as Client_api_error;
                expect(err.status).toBe(404);
                // message bytes are part of the contract: scraper-studio
                // matches on error prose (e.g. 'realtime job limit')
                expect(err.message).toBe(
                    'Error: no such dataset\n'
                    +'  Status: 404\n'
                    +'  Hint: Resource not found. Check the URL or dataset '
                    +'type.'
                );
            }
        });

        it('does not retry an API error', async()=>{
            const fetch_mock = vi.fn(async()=>text_response(400, 'bad input'));
            vi.stubGlobal('fetch', fetch_mock);
            await expect(request('key', '/x', fast_retry)).rejects.toThrow();
            expect(fetch_mock).toHaveBeenCalledTimes(1);
        });

        it('retries a network error whose message starts with "Error:"',
            async()=>{
                // Retry used to be decided by message.startsWith('Error:'),
                // so a network failure worded this way was misclassified as a
                // final API error and never retried.
                const fetch_mock = vi.fn(async()=>{
                    throw new Error('Error: socket hang up');
                });
                vi.stubGlobal('fetch', fetch_mock);
                await expect(request('key', '/x', fast_retry))
                    .rejects.toThrow('Network request failed');
                expect(fetch_mock).toHaveBeenCalledTimes(4);
            });

        it('retries transient statuses then surfaces the error', async()=>{
            const fetch_mock = vi.fn(async()=>text_response(503, 'busy'));
            vi.stubGlobal('fetch', fetch_mock);
            await expect(request('key', '/x', fast_retry)).rejects.toThrow();
            expect(fetch_mock).toHaveBeenCalledTimes(4);
        });
    });

    describe('request timeout', ()=>{
        // A hung connection produces no error at all, so without an abort the
        // retry loop never engages and the CLI waits forever.
        const hang_until_aborted = (_url: string, init: RequestInit)=>
            new Promise<Response>((_resolve, reject)=>{
                init.signal?.addEventListener('abort', ()=>{
                    const err = new Error('aborted');
                    err.name = 'TimeoutError';
                    reject(err);
                });
            });

        it('aborts a hung request instead of hanging forever', async()=>{
            vi.stubGlobal('fetch', vi.fn(hang_until_aborted));
            await expect(request('key', '/x', {
                timeout_ms: 20,
                ...fast_retry,
            })).rejects.toThrow('Request timed out after 0s');
        });

        it('retries a timeout once, not the full retry budget', async()=>{
            // timeout x attempts multiplies the user-visible stall, so the
            // generic budget (3 retries) is deliberately not reused here.
            const fetch_mock = vi.fn(hang_until_aborted);
            vi.stubGlobal('fetch', fetch_mock);
            await expect(request('key', '/x', {
                timeout_ms: 20,
                ...fast_retry,
            })).rejects.toThrow();
            expect(fetch_mock).toHaveBeenCalledTimes(2);
        });

        it('passes an abort signal on every attempt', async()=>{
            const fetch_mock = vi.fn(async()=>json_response(200, {}));
            vi.stubGlobal('fetch', fetch_mock);
            await request('key', '/x');
            const [, init] = fetch_mock.mock.calls[0] as unknown as
                [string, RequestInit];
            expect(init.signal).toBeInstanceOf(AbortSignal);
        });
    });
});
