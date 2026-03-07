import fs from 'fs';
import path from 'path';

const is_tty = process.stdout.isTTY === true;

const ansi = (code: string, text: string)=>
    is_tty ? `\x1b[${code}m${text}\x1b[0m` : text;

const green  = (s: string)=>ansi('32', s);
const red    = (s: string)=>ansi('31', s);
const yellow = (s: string)=>ansi('33', s);
const dim    = (s: string)=>ansi('2', s);

const success = (msg: string)=>console.error(green(`✓ ${msg}`));
const warn    = (msg: string)=>console.error(yellow(`⚠ ${msg}`));
const info    = (msg: string)=>console.error(dim(msg));
const fail    = (msg: string)=>{ console.error(red(`✗ ${msg}`)); 
    process.exit(1); };

type Output_format = 'markdown'|'json'|'pretty'|'html'|'csv'|'raw';

const format_from_ext = (file_path: string): Output_format|null=>{
    const ext = path.extname(file_path).toLowerCase();
    if (ext == '.json') return 'json';
    if (ext == '.md')   return 'markdown';
    if (ext == '.html') return 'html';
    if (ext == '.csv')  return 'csv';
    return null;
};

type Print_opts = {
    json?: boolean;
    pretty?: boolean;
    output?: string;
    format?: Output_format;
};

const serialize = (data: unknown, fmt: Output_format): string=>{
    if (fmt == 'pretty')
        return JSON.stringify(data, null, 2);
    if (fmt == 'json')
        return JSON.stringify(data);
    if (typeof data == 'string')
        return data;
    return JSON.stringify(data, null, 2);
};

const print = (data: unknown, opts: Print_opts = {})=>{
    // Determine effective format
    let fmt: Output_format = opts.format ?? 'raw';
    if (opts.pretty)
        fmt = 'pretty';
    else if (opts.json)
        fmt = 'json';
    if (opts.output)
    {
        const ext_fmt = format_from_ext(opts.output);
        const file_fmt = ext_fmt ?? fmt;
        const content = serialize(data, file_fmt);
        fs.writeFileSync(opts.output, content, 'utf8');
        info(`Output written to ${opts.output}`);
        return;
    }
    if (!is_tty && fmt == 'raw')
        fmt = typeof data == 'string' ? 'raw' : 'json';
    process.stdout.write(serialize(data, fmt)+'\n');
};

const print_table = (rows: Record<string, unknown>[], cols: string[])=>{
    if (!rows.length)
        return;
    const widths = cols.map(c=>
        Math.max(c.length, ...rows.map(r=>String(r[c] ?? '').length))
    );
    const divider = widths.map(w=>'-'.repeat(w)).join('-+-');
    const header  = cols.map((c, i)=>c.padEnd(widths[i])).join(' | ');
    console.log(dim(header));
    console.log(dim(divider));
    for (let i=0; i<rows.length; i++)
    {
        const row = cols.map((c, j)=>String(rows[i][c] ?? '').
            padEnd(widths[j]));
        console.log(row.join(' | '));
    }
};

export {
    is_tty,
    green, red, yellow, dim,
    success, warn, info, fail,
    format_from_ext, serialize, print, print_table,
};
export type {Output_format, Print_opts};
