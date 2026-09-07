import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {serialize, format_from_ext, print, print_table} from '../../utils/output';

describe('utils/output.serialize csv', ()=>{
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
    it('-o file preserves terminal escape sequences', ()=>{
        const out = make_tmp('.txt');
        const content = 'hello\x1b[31mRED\x1b[0m';
        print(content, {output: out});
        expect(fs.readFileSync(out, 'utf8')).toBe(content);
    });
});

describe('utils/output.print terminal sanitization', ()=>{
    let stdout_write: ReturnType<typeof vi.spyOn>;
    const original_is_tty = Object.getOwnPropertyDescriptor(
        process.stdout,
        'isTTY',
    );
    const set_tty = (value: boolean)=>{
        Object.defineProperty(process.stdout, 'isTTY', {
            configurable: true,
            value,
        });
    };
    beforeEach(()=>{
        stdout_write = vi.spyOn(process.stdout, 'write')
            .mockImplementation(()=>true);
    });
    afterEach(()=>{
        vi.restoreAllMocks();
        if (original_is_tty)
        {
            Object.defineProperty(
                process.stdout,
                'isTTY',
                original_is_tty,
            );
        }
        else
            delete (process.stdout as {isTTY?: boolean}).isTTY;
    });
    it('sanitizes terminal escape sequences on TTY stdout', ()=>{
        set_tty(true);
        const malicious = 'hello'
            + '\x1b[2J'
            + '\x1b[31mRED\x1b[0m'
            + '\x1b]0;Title-pwn\x07'
            + 'world';

        print(malicious);
        const output = stdout_write.mock.calls
            .map((call: unknown[])=>String(call[0]))
            .join('');
        expect(output).toBe('helloREDworld\n');
        expect(output).not.toContain('\x1b');
        expect(output).not.toContain('\x07');
    });
    it('keeps normal TTY stdout content unchanged', ()=>{
        set_tty(true);
        print('hello world');
        const output = stdout_write.mock.calls
            .map((call: unknown[])=>String(call[0]))
            .join('');
        expect(output).toBe('hello world\n');
    });
    it('preserves row stdout for non-TTY stdout', ()=>{
        set_tty(false);
        const content = 'hello\x1b[31mRED\x1b[0m';
        print(content);
        const output = stdout_write.mock.calls
            .map((call: unknown[])=>String(call[0]))
            .join('');
        expect(output).toBe(content + '\n');
    });
    it('preserves structured output for non-TTY stdout', ()=>{
        set_tty(false);
        const data = [{
            value: 'hello\x1b[31mRED\x1b[0m',
        }];
        print(data, {format: 'json'});
        const output = stdout_write.mock.calls
            .map((call: unknown[])=>String(call[0]))
            .join('');
        expect(output).toBe(JSON.stringify(data) + '\n');
    });
    it('removes standalone terminal control characters on TTY', ()=>{
        set_tty(true);
        print('a\x07b\bcd\ref');
        const output = stdout_write.mock.calls
            .map((call: unknown[])=>String(call[0]))
            .join('');
        expect(output).toBe('abcd\nef\n');
        expect(output).not.toContain('\x07');
        expect(output).not.toContain('\b');
        expect(output).not.toContain('\r');
    });
});

describe('utils/output.print_table terminal sanitization', ()=>{
    const original_is_tty = Object.getOwnPropertyDescriptor(
        process.stdout,
        'isTTY',
    );
    const set_tty = (value: boolean)=>{
        Object.defineProperty(process.stdout, 'isTTY', {
            configurable: true,
            value,
        });
    };
    afterEach(()=>{
        vi.restoreAllMocks();
        if (original_is_tty)
        {
            Object.defineProperty(
                process.stdout,
                'isTTY',
                original_is_tty,
            );
        }
        else
            delete (process.stdout as {isTTY?: boolean}).isTTY;
    });
    it('sanitizes malicious values passed through print_table', ()=>{
        set_tty(true);
        const log = vi.spyOn(console, 'log')
            .mockImplementation(()=>{});
        print_table(
            [{
                title: 'hello\x1b[31mRED\x1b[0m',
                url: 'before\x1b[2Jafter',
            }],
            ['title', 'url'],
        );
        const output = log.mock.calls
            .map((call: unknown[])=>call.map(String).join(' '))
            .join('\n');
        expect(output).toContain('helloRED');
        expect(output).toContain('beforeafter');
        expect(output).not.toContain('\x1b[31m');
        expect(output).not.toContain('\x1b[2J');
    });
    it('flattens multiline table cells before printing', ()=>{
        set_tty(true);
        const log = vi.spyOn(console, 'log')
            .mockImplementation(()=>{});
        print_table(
            [{title: 'line1\nline2'}],
            ['title'],
        );
        const output = log.mock.calls
            .map((call: unknown[])=>call.map(String).join(' '))
            .join('\n');
        expect(output).toContain('line1 line2');
        expect(output).not.toContain('line1\nline2');
    });
});