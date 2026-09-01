import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const mocks = vi.hoisted(()=>({
    get_config: vi.fn(),
}));
vi.mock('../../utils/config', ()=>({
    get: mocks.get_config,
}));

import {serialize, format_from_ext, print} from '../../utils/output';
describe('utils/output.serialize csv', ()=>{
    beforeEach(()=>{
        mocks.get_config.mockReturnValue(true);
    });
    afterEach(()=>{
        mocks.get_config.mockReset();
    });
    it('serializes array of flat objects as RFC 4180 CSV with header row', ()=>{
        const rows = [
            {url: 'https://a.test/1', title: 'A', price: 1.5},
            {url: 'https://a.test/2', title: 'B', price: 2.0},
        ];
        const out = serialize(rows, 'csv');
        const lines = out.trim().split('\n');
        expect(lines[0]).toBe('url,title,price');
        expect(lines[1]).toBe('https://a.test/1,A,1.5');
        expect(lines[2]).toBe('https://a.test/2,B,2');
    });

    it('quotes and escapes embedded commas, quotes, and newlines', ()=>{
        const rows = [{name: 'Smith, John', note: 'He said "hi"'},
            {name: 'multi\nline', note: 'ok'}];
        const out = serialize(rows, 'csv');
        const lines = out.trim().split(/\n/);
        expect(lines[0]).toBe('name,note');
        expect(lines[1]).toBe('"Smith, John","He said ""hi"""');
    });

    it('unions keys across heterogeneous rows', ()=>{
        const rows = [{a: 1, b: 2}, {a: 3, c: 4}];
        const out = serialize(rows, 'csv');
        const lines = out.trim().split('\n');
        expect(lines[0]).toBe('a,b,c');
        expect(lines[1]).toBe('1,2,');
        expect(lines[2]).toBe('3,,4');
    });

    it('wraps a single object as one CSV row', ()=>{
        const out = serialize({a: 1, b: 'x'}, 'csv');
        expect(out.trim()).toBe('a,b\n1,x');
    });

    it('serializes nested values via JSON', ()=>{
        const rows = [{id: 1, meta: {tag: 'x'}}];
        const out = serialize(rows, 'csv');
        const lines = out.trim().split('\n');
        expect(lines[1]).toBe('1,"{""tag"":""x""}"');
    });
    it('sanitizes spreadsheet formula prefixes in CSV string cells', ()=>{
        const rows = [{
            equals: '=1+1',
            space: ' =1+1',
            multi_space: '   =1+1',
            tab: '\t=1+1',
            nbsp: '\u00a0=1+1',
            plus: '+cmd',
            minus: '-SUM(A1:A2)',
            at: '@SUM(A1:A2)',
        }];
        const out = serialize(rows, 'csv');
        expect(out).toContain("'=1+1");
        expect(out).toContain("' =1+1");
        expect(out).toContain("'   =1+1");
        expect(out).toContain("'\t=1+1");
        expect(out).toContain("'\u00a0=1+1");
        expect(out).toContain("'+cmd");
        expect(out).toContain("'-SUM(A1:A2)");
        expect(out).toContain("'@SUM(A1:A2)");
    });
    it('does not sanitize numeric values', ()=>{
        const out = serialize([{value: -100}], 'csv');
        const lines = out.trim().split('\n');
        expect(lines[1]).toBe('-100');
    });
    it('preserves numeric-looking CSV strings', ()=>{
        const out = serialize([{negative: '-100', positive: '+15'}], 'csv');
        expect(out).toContain('-100,+15');
    });
    it('does not sanitize CSV cells when sanitize_csv is false', ()=>{
        mocks.get_config.mockReturnValue(false);
        const out = serialize([{value: '=1+1'}], 'csv');
        expect(out).toContain('=1+1');
        expect(out).not.toContain("'=1+1");
    });
});

describe('utils/output.serialize markdown', ()=>{
    it('renders an array of objects as a Markdown table', ()=>{
        const rows = [{a: 1, b: 'x'}, {a: 2, b: 'y'}];
        const out = serialize(rows, 'markdown');
        expect(out).toContain('| a | b |');
        expect(out).toContain('| --- | --- |');
        expect(out).toContain('| 1 | x |');
        expect(out).toContain('| 2 | y |');
    });

    it('escapes pipes and newlines inside cells', ()=>{
        const rows = [{a: 'a|b', b: 'line1\nline2'}];
        const out = serialize(rows, 'markdown');
        expect(out).toContain('| a\\|b | line1 line2 |');
    });

    it('falls back to a fenced JSON block for non-tabular data', ()=>{
        const out = serialize([1, 2, 3], 'markdown');
        expect(out.startsWith('```json')).toBe(true);
    });
});

describe('utils/output.serialize html', ()=>{
    it('renders an array of objects as an HTML table', ()=>{
        const rows = [{a: 1, b: '<x>'}];
        const out = serialize(rows, 'html');
        expect(out).toContain('<thead><tr><th>a</th><th>b</th></tr></thead>');
        expect(out).toContain('<td>1</td><td>&lt;x&gt;</td>');
    });

    it('escapes HTML in non-tabular fallback', ()=>{
        const out = serialize('<script>', 'html');
        expect(out).toBe('<script>');
    });
});

describe('utils/output.format_from_ext', ()=>{
    it('maps known extensions', ()=>{
        expect(format_from_ext('a.json')).toBe('json');
        expect(format_from_ext('a.CSV')).toBe('csv');
        expect(format_from_ext('a.md')).toBe('markdown');
        expect(format_from_ext('a.html')).toBe('html');
    });

    it('returns null for unknown extensions', ()=>{
        expect(format_from_ext('a.txt')).toBeNull();
        expect(format_from_ext('noext')).toBeNull();
    });

    it('rejects .xlsx with a helpful message and exits 1', ()=>{
        const exit = vi.spyOn(process, 'exit').mockImplementation(
            ((_code?: number)=>{ throw new Error('exit'); }) as never);
        const err = vi.spyOn(console, 'error').mockImplementation(()=>{});
        expect(()=>format_from_ext('out.xlsx')).toThrow('exit');
        const msg = err.mock.calls.map(c=>c.join(' ')).join(' ');
        expect(msg).toMatch(/XLSX output is not supported/);
        expect(msg).toMatch(/--pretty -o file\.json/);
        expect(msg).toMatch(/brightdata\.com\/cp\/scrapers/);
        exit.mockRestore();
        err.mockRestore();
    });
});

describe('utils/output.print writes correct format from extension', ()=>{
    const tmp_files: string[] = [];
    const make_tmp = (ext: string)=>{
        const p = path.join(os.tmpdir(),
            `bdata-output-test-${Date.now()}-${Math.random()}${ext}`);
        tmp_files.push(p);
        return p;
    };
    beforeEach(()=>{ vi.spyOn(console, 'error').mockImplementation(()=>{}); });
    afterEach(()=>{
        vi.restoreAllMocks();
        for (const f of tmp_files) { try { fs.unlinkSync(f); } catch {} }
    });

    it('-o file.csv writes CSV (regression: was silently writing JSON)', ()=>{
        const out = make_tmp('.csv');
        print([{url: 'https://x.test', title: 'T'}], {output: out});
        const content = fs.readFileSync(out, 'utf8');
        expect(content.split('\n')[0]).toBe('url,title');
        expect(content.split('\n')[1]).toBe('https://x.test,T');
    });

    it('-o file.html writes HTML (regression: was silently writing JSON)', ()=>{
        const out = make_tmp('.html');
        print([{a: 1}], {output: out});
        const content = fs.readFileSync(out, 'utf8');
        expect(content).toContain('<table>');
    });

    it('-o file.md writes Markdown (regression: was silently writing JSON)', ()=>{
        const out = make_tmp('.md');
        print([{a: 1}], {output: out});
        const content = fs.readFileSync(out, 'utf8');
        expect(content).toContain('| a |');
    });

    it('-o file.json writes JSON unchanged', ()=>{
        const out = make_tmp('.json');
        print([{a: 1}], {output: out});
        const content = fs.readFileSync(out, 'utf8');
        expect(JSON.parse(content)).toEqual([{a: 1}]);
    });
});
