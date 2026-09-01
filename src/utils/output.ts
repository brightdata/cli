import fs from 'fs';
import path from 'path';

import {get as get_config} from './config';

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

const UNSUPPORTED_EXTS: Record<string, string> = {
    '.xlsx': 'XLSX output is not supported. Use --pretty -o file.json '
        +'and convert with a tool like xlsx-cli, or download as XLSX '
        +'from the Bright Data web UI (https://brightdata.com/cp/scrapers).',
    '.xls':  'XLS output is not supported. Use --pretty -o file.json '
        +'and convert with a tool like xlsx-cli, or download from the '
        +'Bright Data web UI (https://brightdata.com/cp/scrapers).',
};

const format_from_ext = (file_path: string): Output_format|null=>{
    const ext = path.extname(file_path).toLowerCase();
    if (UNSUPPORTED_EXTS[ext])
        fail(UNSUPPORTED_EXTS[ext]);
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

const to_rows = (data: unknown): Record<string, unknown>[]|null=>{
    if (Array.isArray(data) && data.length
        && data.every(d=>d && typeof d == 'object' && !Array.isArray(d)))
    {
        return data as Record<string, unknown>[];
    }
    if (data && typeof data == 'object' && !Array.isArray(data))
        return [data as Record<string, unknown>];
    return null;
};

const collect_keys = (rows: Record<string, unknown>[]): string[]=>{
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const r of rows)
    {
        for (const k of Object.keys(r))
        {
            if (!seen.has(k))
            {
                seen.add(k);
                ordered.push(k);
            }
        }
    }
    return ordered;
};

const cell_to_string = (val: unknown): string=>{
    if (val === null || val === undefined)
        return '';
    if (typeof val == 'string')
        return val;
    if (typeof val == 'number' || typeof val == 'boolean')
        return String(val);
    return JSON.stringify(val);
};

const sanitize_csv_cell = (s: string): string=>{
    const trimmed = s.trim();
    if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed))
        return s;
    if (/^[\s\u00a0]*[=+\-@]/.test(s))
        return "'" + s;
    return s;
};

const csv_escape = (val: unknown): string=>{
    let s = cell_to_string(val);
    if (typeof val == 'string' && get_config('sanitize_csv') !== false)
        s = sanitize_csv_cell(s);
    if (/[",\r\n]/.test(s))
        return '"' + s.replace(/"/g, '""') + '"';
    return s;
};

const serialize_csv = (data: unknown): string=>{
    if (typeof data == 'string')
        return data;
    const rows = to_rows(data);
    if (!rows)
    {
        warn('CSV requires an object or array of objects; falling back '
            +'to JSON. Use --json to silence this warning.');
        return JSON.stringify(data, null, 2);
    }
    const keys = collect_keys(rows);
    const header = keys.map(csv_escape).join(',');
    const body = rows.map(r=>keys.map(k=>csv_escape(r[k])).join(',')).join('\n');
    return header+'\n'+body+'\n';
};

const md_escape = (val: unknown): string=>
    cell_to_string(val).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const serialize_markdown = (data: unknown): string=>{
    if (typeof data == 'string')
        return data;
    const rows = to_rows(data);
    if (!rows)
        return '```json\n'+JSON.stringify(data, null, 2)+'\n```\n';
    const keys = collect_keys(rows);
    const header = '| '+keys.join(' | ')+' |';
    const divider = '| '+keys.map(()=>'---').join(' | ')+' |';
    const body = rows.map(r=>
        '| '+keys.map(k=>md_escape(r[k])).join(' | ')+' |').join('\n');
    return [header, divider, body].join('\n')+'\n';
};

const html_escape = (val: unknown): string=>
    cell_to_string(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const serialize_html = (data: unknown): string=>{
    if (typeof data == 'string')
        return data;
    const rows = to_rows(data);
    if (!rows)
        return '<pre>'+html_escape(JSON.stringify(data, null, 2))+'</pre>\n';
    const keys = collect_keys(rows);
    const thead = '<thead><tr>'
        +keys.map(k=>'<th>'+html_escape(k)+'</th>').join('')
        +'</tr></thead>';
    const tbody = '<tbody>'
        +rows.map(r=>'<tr>'
            +keys.map(k=>'<td>'+html_escape(r[k])+'</td>').join('')
            +'</tr>').join('')
        +'</tbody>';
    return '<table>'+thead+tbody+'</table>\n';
};

const serialize = (data: unknown, fmt: Output_format): string=>{
    if (fmt == 'pretty')
        return JSON.stringify(data, null, 2);
    if (fmt == 'json')
        return JSON.stringify(data);
    if (fmt == 'csv')
        return serialize_csv(data);
    if (fmt == 'markdown')
        return serialize_markdown(data);
    if (fmt == 'html')
        return serialize_html(data);
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
