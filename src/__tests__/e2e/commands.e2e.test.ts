import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, it, expect} from 'vitest';
import {setup_e2e} from './harness';

const ZONE = 'unlocker_e2e';
const PAGE = 'https://example.com/';
const PAGE_MD = 'Example Domain\n\nThis domain is for use in documentation '
    +'examples.';
const VERSION = JSON.parse(readFileSync(join(__dirname, '../../..',
    'package.json'), 'utf8')).version;

// Shapes and content types mirror api.brightdata.com responses captured on
// 2026-10-25. The sandbox config sets no default zones on purpose.
const SERP = {
    general: {search_engine: 'google', query: 'bright data cli'},
    organic: [{rank: 1, title: 'CLI - Bright Data Docs',
        link: 'https://docs.brightdata.com/products/cli/overview',
        description: 'Use the Bright Data CLI to scrape sites.'}],
};
const request_body = (calls: {body: string}[])=>JSON.parse(calls[0].body);

describe('e2e: other commands (real CLI vs fake API)', ()=>{
    const e2e = setup_e2e();
    const {api} = e2e;

    describe('scrape', ()=>{
        it('markdown by default, page text on stdout, exit 0', async()=>{
            api.set({'POST /request': {type: 'text/html; charset=utf-8',
                body: PAGE_MD}});
            const res = await e2e.run('scrape', PAGE, '--zone', ZONE);
            expect(res.code).toBe(0);
            expect(res.stdout).toContain('Example Domain');
            expect(request_body(api.called('POST', '/request'))).toEqual({
                zone: ZONE, url: PAGE, format: 'raw',
                data_format: 'markdown'});
        });

        it('--format json returns the response envelope', async()=>{
            const envelope = {status_code: 200, headers: {}, body: '<html/>'};
            api.set({'POST /request': {body: envelope}});
            const res = await e2e.run('scrape', PAGE, '--zone', ZONE,
                '--format', 'json');
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(envelope);
            expect(request_body(api.called('POST', '/request')).format)
                .toBe('json');
        });

        it('zone from BRIGHTDATA_UNLOCKER_ZONE', async()=>{
            api.set({'POST /request': {type: 'text/html', body: PAGE_MD}});
            const res = await e2e.run_env(
                {BRIGHTDATA_UNLOCKER_ZONE: 'env_zone'}, 'scrape', PAGE);
            expect(res.code).toBe(0);
            expect(request_body(api.called('POST', '/request')).zone)
                .toBe('env_zone');
        });

        it('unknown zone: exit 1, API message on stderr', async()=>{
            api.set({'POST /request': {status: 400, type: 'text/plain',
                body: 'zone "nope" not found'}});
            const res = await e2e.run('scrape', PAGE, '--zone', 'nope');
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('zone "nope" not found');
        });

        it('no zone configured: exit 1 before any request', async()=>{
            api.set({});
            const res = await e2e.run('scrape', PAGE);
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('No Web Unlocker zone');
            expect(api.calls).toHaveLength(0);
        });
    });

    describe('search', ()=>{
        it('google --json: parsed SERP on stdout, brd_json requested',
            async()=>{
            api.set({'POST /request': {body: SERP}});
            const res = await e2e.run('search', 'bright data cli', '--zone',
                'serp_e2e', '--json');
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(SERP);
            const body = request_body(api.called('POST', '/request'));
            expect(body.zone).toBe('serp_e2e');
            const url = new URL(body.url);
            expect(url.host).toBe('www.google.com');
            expect(url.searchParams.get('q')).toBe('bright data cli');
            expect(url.searchParams.get('brd_json')).toBe('1');
        });

        it('-o file.md writes a markdown summary', async()=>{
            api.set({'POST /request': {body: SERP}});
            const out = join(e2e.home, 'serp.md');
            const res = await e2e.run('search', 'bright data cli', '--zone',
                'serp_e2e', '-o', out);
            expect(res.code).toBe(0);
            const md = readFileSync(out, 'utf8');
            expect(md).toContain('CLI - Bright Data Docs');
            expect(md).toContain(SERP.organic[0].link);
        });
    });

    describe('account', ()=>{
        it('zones --json lists active zones', async()=>{
            const zones = [{name: 'serp', type: 'serp'},
                {name: 'residential', type: 'res_rotating'}];
            api.set({'GET /zone/get_active_zones': {body: zones}});
            const res = await e2e.run('zones', '--json');
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(zones);
        });

        it('budget --json shows the balance', async()=>{
            const balance = {balance: 40.92, credit: 0, prepayment: 0,
                pending_costs: 8.09};
            api.set({'GET /customer/balance': {body: balance}});
            const res = await e2e.run('budget', '--json');
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(balance);
        });
    });

    describe('cross-cutting', ()=>{
        it('sends the bearer key and a versioned User-Agent', async()=>{
            api.set({'GET /zone/get_active_zones': {body: []}});
            await e2e.run('zones', '--json');
            const [call] = api.called('GET', '/zone/get_active_zones');
            expect(call.headers.authorization).toBe('Bearer test-key');
            expect(call.headers['user-agent'])
                .toBe(`brightdata-cli/${VERSION}`);
        });

        it('401: exit 1 with the re-login hint', async()=>{
            api.set({'GET /zone/get_active_zones': {status: 401,
                type: 'text/plain', body: 'Unauthorized'}});
            const res = await e2e.run('zones', '--json');
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('brightdata login');
        });

        it('transient 503 is retried, then succeeds', async()=>{
            api.set({'GET /customer/balance': [
                {status: 503, type: 'text/plain', body: 'busy'},
                {body: {balance: 1}}]});
            const res = await e2e.run('budget', '--json');
            expect(res.code).toBe(0);
            expect(api.called('GET', '/customer/balance')).toHaveLength(2);
        });

        it('no API key: exit 1 before any request', async()=>{
            api.set({});
            const res = await e2e.run_env({BRIGHTDATA_API_KEY: undefined},
                'zones', '--json');
            expect(res.code).toBe(1);
            expect(res.stderr).toContain('No API key found');
            expect(api.calls).toHaveLength(0);
        });

        it('--version prints the package version', async()=>{
            const res = await e2e.run('--version');
            expect(res.code).toBe(0);
            expect(res.stdout.trim()).toBe(VERSION);
        });

        it('unknown command exits non-zero', async()=>{
            const res = await e2e.run('no-such-command');
            expect(res.code).not.toBe(0);
        });
    });
});
