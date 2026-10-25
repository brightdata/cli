import {spawn} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {existsSync, mkdirSync, mkdtempSync, readFileSync,
    rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {afterAll, beforeAll, beforeEach, inject} from 'vitest';

// End-to-end harness: runs the real CLI (compiled once by global_setup.ts)
// as a subprocess with HOME pointed at a sandbox whose config.json aims
// api_url at a local fake API. Nothing is mocked inside the CLI, so exit
// codes, stdout/stderr and files written are exactly what a user (or a
// script/agent driving the CLI) would observe.

// type is the content-type; a string body is sent as-is, anything else as
// JSON.
type Reply = {status?: number; type?: string; body: unknown};
type Route = Reply|Reply[];
type Call = {method: string; path: string; query: URLSearchParams;
    headers: Record<string, unknown>; body: string};
type Cli_result = {code: number|null; stdout: string; stderr: string};

const ROOT = resolve(__dirname, '../../..');

// Routes are keyed by "METHOD /path". A Reply[] is served in order, the
// last entry repeating, so polling sequences (pending -> ready) are easy.
class Fake_api {
    calls: Call[] = [];
    private routes: Record<string, Route> = {};
    private hits: Record<string, number> = {};
    private server: Server = createServer((req, res)=>{
        let body = '';
        req.on('data', chunk=>{ body += chunk; });
        req.on('end', ()=>{
            const url = new URL(req.url ?? '/', 'http://x');
            const key = `${req.method} ${url.pathname}`;
            this.calls.push({method: req.method ?? '', path: url.pathname,
                query: url.searchParams, headers: req.headers, body});
            const reply = this.next(key);
            res.writeHead(reply.status ?? 200, {'content-type':
                reply.type ?? 'application/json; charset=utf-8'});
            res.end(typeof reply.body == 'string' ? reply.body
                : JSON.stringify(reply.body));
        });
    });
    private next(key: string): Reply{
        const route = this.routes[key];
        if (!route)
            return {status: 404, body: {error: `no fake route: ${key}`}};
        if (!Array.isArray(route))
            return route;
        const i = this.hits[key] = (this.hits[key] ?? -1)+1;
        return route[Math.min(i, route.length-1)];
    }
    set(routes: Record<string, Route>){
        this.routes = routes;
        this.hits = {};
        this.calls = [];
    }
    called(method: string, path: string): Call[]{
        return this.calls.filter(c=>c.method == method && c.path == path);
    }
    async start(): Promise<string>{
        await new Promise<void>(ok=>this.server.listen(0, '127.0.0.1', ok));
        const {port} = this.server.address() as AddressInfo;
        return `http://127.0.0.1:${port}`;
    }
    stop(): Promise<void>{
        return new Promise(ok=>this.server.close(()=>ok()));
    }
}

// cfg_files are extra files for ~/.config/brightdata-cli, e.g. a seeded
// scrapers.json so pipelines never reach docs.brightdata.com.
const make_home = (config: Record<string, unknown>,
    cfg_files: Record<string, unknown> = {}): string=>{
    const home = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'home-'));
    const cfg_dir = join(home, '.config', 'brightdata-cli');
    mkdirSync(cfg_dir, {recursive: true});
    const files = {...cfg_files, 'config.json': config};
    for (const [name, content] of Object.entries(files))
        writeFileSync(join(cfg_dir, name), JSON.stringify(content));
    return home;
};

const run_cli = (entry: string, home: string,
    args: string[]): Promise<Cli_result>=>new Promise(ok=>{
    const child = spawn(process.execPath, [entry, ...args], {
        cwd: home,
        env: {PATH: process.env.PATH, HOME: home, NO_COLOR: '1',
            BRIGHTDATA_API_KEY: 'test-key'},
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d=>{ stdout += d; });
    child.stderr.on('data', d=>{ stderr += d; });
    child.on('close', code=>ok({code, stdout, stderr}));
});

type E2e_opts = {
    config?: Record<string, unknown>;
    cfg_files?: Record<string, unknown>;
};

// Registers suite hooks: fake API up, sandbox HOME created, temp files
// removed afterwards. Call inside describe().
const setup_e2e = (opts: E2e_opts = {})=>{
    const api = new Fake_api();
    const ctx = {
        api,
        home: '',
        out: '',
        run: (...args: string[])=>run_cli(inject('cli_entry'), ctx.home,
            args),
        written: ()=>JSON.parse(readFileSync(ctx.out, 'utf8')),
        out_exists: ()=>existsSync(ctx.out),
    };
    beforeAll(async()=>{
        const api_url = await api.start();
        ctx.home = make_home({api_url, ...opts.config}, opts.cfg_files);
        ctx.out = join(ctx.home, 'out.json');
    });
    afterAll(async()=>{
        await api.stop();
        rmSync(ctx.home, {recursive: true, force: true});
    });
    beforeEach(()=>rmSync(ctx.out, {force: true}));
    return ctx;
};

export {Fake_api, make_home, run_cli, setup_e2e};
export type {Call, Cli_result, Reply, Route};
