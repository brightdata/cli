import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const exec_mocks = vi.hoisted(()=>({
    execFile: vi.fn(),
}));

vi.mock('child_process', ()=>({
    execFile: exec_mocks.execFile,
}));
import {
    build_authorize_url,
    build_device_start_body,
    github_flow,
} from '../../utils/browser_auth';

describe('utils/browser_auth', ()=>{
    it('omits customer_id from the authorize URL when not provided', ()=>{
        const url = build_authorize_url({
            redirect_uri: 'http://127.0.0.1:3000/callback',
            state: 'state_123',
            code_challenge: 'challenge_123',
        });

        expect(url.searchParams.get('redirect_uri'))
            .toBe('http://127.0.0.1:3000/callback');
        expect(url.searchParams.get('state')).toBe('state_123');
        expect(url.searchParams.get('code_challenge')).toBe('challenge_123');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.has('customer_id')).toBe(false);
    });

    it('includes a trimmed customer_id in the authorize URL when provided', ()=>{
        const url = build_authorize_url({
            redirect_uri: 'http://127.0.0.1:3000/callback',
            state: 'state_123',
            code_challenge: 'challenge_123',
            customer_id: ' hl_123 ',
        });

        expect(url.searchParams.get('customer_id')).toBe('hl_123');
    });

    it('omits customer_id from the device start body when not provided', ()=>{
        expect(build_device_start_body(undefined)).toEqual({});
        expect(build_device_start_body('   ')).toEqual({});
    });

    it('includes a trimmed customer_id in the device start body when provided', ()=>{
        expect(build_device_start_body(' hl_123 ')).toEqual({
            customer_id: 'hl_123',
        });
    });
});

describe('github_flow', ()=>{
    // Response builders
    const gh_json = <T>(ok: boolean, status: number, data: T)=>
        ({ok, status, json: vi.fn().mockResolvedValue(data)} as unknown as Response);

    const bd_resp = (status: number, payload: object)=>
        ({
            status,
            text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
        } as unknown as Response);

    const GH_USER   = {id: 42, login: 'testuser'};
    const GH_EMAILS = [{email: 'test@example.com', verified: true, primary: true}];
    const BD_INIT   = {challenge_id: 'chg_001', gist_content: 'bd-verify:nonce'};
    const GH_GIST   = {id: 'gist_abc'};
    const BD_VERIFY = {api_key: 'test-api-key'};

    const setup_full_flow = (spy: ReturnType<typeof vi.spyOn>)=>{
        spy
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(200, BD_VERIFY))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);
    };

    beforeEach(()=>{
        exec_mocks.execFile.mockImplementation(
            (_cmd: unknown, _args: unknown, cb: (
                err: null | Error,
                result?: {stdout: string}
            )=>void)=>{
                cb(null, {stdout: 'gh-token-123\n'});
            }
        );
    });

    afterEach(()=>{
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('returns api_key on success', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch');
        setup_full_flow(spy);

        const result = await github_flow({});
        expect(result).toBe('test-api-key');
    });

    it('throws when gh CLI is not installed', async()=>{
        exec_mocks.execFile.mockImplementation(
            (_cmd: unknown, _args: unknown, cb: (err: Error)=>void)=>{
                cb(new Error('command not found: gh'));
            }
        );

        await expect(github_flow({})).rejects.toThrow('GitHub CLI (gh) not found');
    });

    it('throws when gh is not authenticated', async()=>{
        exec_mocks.execFile.mockImplementation(
            (_cmd: unknown, _args: unknown, cb: (err: Error)=>void)=>{
                cb(new Error('not logged into any GitHub hosts'));
            }
        );

        await expect(github_flow({})).rejects.toThrow('GitHub CLI (gh) not found or not authenticated');
    });

    it('throws when gh auth token returns empty output', async()=>{
        exec_mocks.execFile.mockImplementation(
            (_cmd: unknown, _args: unknown, cb: (
                err: null,
                result: {stdout: string}
            )=>void)=>{
                cb(null, {stdout: '   \n'});
            }
        );

        await expect(github_flow({})).rejects.toThrow('GitHub CLI (gh) not found');
    });

    it('throws when GET /user returns an error', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(false, 401, {}));

        await expect(github_flow({})).rejects.toThrow('Could not fetch GitHub user info');
    });

    it('throws with --customer-id hint on 400 multi_customer from init', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(400, {
                error: 'multi_customer',
                error_description: 'Multiple accounts found',
            }));

        await expect(github_flow({})).rejects.toThrow('--customer-id');
    });

    it('throws with "No Bright Data account" on 404 user_not_found from init', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(404, {error: 'user_not_found'}));

        await expect(github_flow({})).rejects.toThrow('No Bright Data account');
    });

    it('passes customer_id to the init request body when provided', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch');
        setup_full_flow(spy);

        await github_flow({customer_id: 'hl_123'});

        // init is the 2nd fetch call (index 1)
        const init_body = JSON.parse(spy.mock.calls[1][1]?.body as string);
        expect(init_body.customer_id).toBe('hl_123');
    });

    it('includes email in init body when present in /user response', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, {...GH_USER, email: 'user@example.com'}))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(200, BD_VERIFY))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);

        await github_flow({});

        const init_body = JSON.parse(spy.mock.calls[1][1]?.body as string);
        expect(init_body.email).toBe('user@example.com');
    });

    it('omits email from init body when /user returns null email', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, {...GH_USER, email: null}))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(200, BD_VERIFY))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);

        await github_flow({});

        const init_body = JSON.parse(spy.mock.calls[1][1]?.body as string);
        expect(init_body.email).toBeUndefined();
    });

    it('omits email from init body when /user returns a non-string email', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, {...GH_USER, email: 42}))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(200, BD_VERIFY))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);

        await github_flow({});

        const init_body = JSON.parse(spy.mock.calls[1][1]?.body as string);
        expect(init_body.email).toBeUndefined();
    });

    it('sends github_id and login in the init request body', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch');
        setup_full_flow(spy);

        await github_flow({});

        const init_body = JSON.parse(spy.mock.calls[1][1]?.body as string);
        expect(init_body.github_id).toBe(42);
        expect(init_body.login).toBe('testuser');
    });

    it('throws when gist creation fails', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(false, 403, {message: 'Forbidden'}));

        await expect(github_flow({})).rejects.toThrow('Could not create verification gist');
    });

    it('throws on 429 rate limit from verify endpoint', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(429, {error: 'rate_limited'}))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);

        await expect(github_flow({})).rejects.toThrow('Rate limit exceeded');
    });

    it('throws when init response is missing challenge fields', async()=>{
        vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(200, {}));

        await expect(github_flow({})).rejects.toThrow('missing challenge fields');
    });

    it('deletes the gist even if verification fails', async()=>{
        const spy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(gh_json(true, 200, GH_USER))
            .mockResolvedValueOnce(bd_resp(200, BD_INIT))
            .mockResolvedValueOnce(gh_json(true, 201, GH_GIST))
            .mockResolvedValueOnce(bd_resp(400, {error: 'verification_failed'}))
            .mockResolvedValueOnce({ok: true, status: 204} as unknown as Response);

        await expect(github_flow({})).rejects.toThrow();

        // DELETE is the 5th call (index 4) — awaited in finally so it always runs
        const delete_call = spy.mock.calls[4];
        expect((delete_call[0] as string).endsWith('gist_abc')).toBe(true);
        expect((delete_call[1] as RequestInit).method).toBe('DELETE');
    });
});
