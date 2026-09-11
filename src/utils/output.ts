import fs from 'fs';
import path from 'path';
import { stripVTControlCharacters } from 'util';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';

import {get as get_config} from './config';

const terminal_safe = (val: unknown): string=>
    stripVTControlCharacters(String(val))
        .replace(/\r\n?/g, '\n')
        .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '');

const is_tty = ()=>process.stdout.isTTY === true;

const ansi = (code: string, text: string)=>
    is_tty() ? `\x1b[${code}m${text}\x1b[0m` : text;

const green  = (s: string)=>ansi('32', s);
const red    = (s: string)=>ansi('31', s);
const yellow = (s: string)=>ansi('33', s);
const dim    = (s: string)=>ansi('2', s);

const success = (msg: string)=>
    console.error(green(`✓ ${terminal_safe(msg)}`));
const warn = (msg: string)=>
    console.error(yellow(`⚠ ${terminal_safe(msg)}`));
const info = (msg: string)=>
    console.error(dim(terminal_safe(msg)));
const fail = (msg: string)=>{
    console.error(red(`✗ ${terminal_safe(msg)}`));
    process.exit(1);
};

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

const sanitize_serialized_csv = (csv: string): string=>{
    const sanitize = get_config('sanitize_csv') !== false;
    if (!sanitize || !csv)
        return csv;
    const rows = parse(csv, {
        bom: true,
    }) as string[][];
    const sanitized = rows.map(row=>
        row.map(cell=>sanitize_csv_cell(cell))
    );
    return stringify(sanitized);
};

const csv_escape = (val: unknown, sanitize: boolean): string=>{
    let s = cell_to_string(val);
    if (typeof val == 'string' && sanitize)
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
    const sanitize = get_config('sanitize_csv') !== false;
    const keys = collect_keys(rows);
    const header = keys.map(k=>csv_escape(k, sanitize)).join(',');
    const body = rows.map(r=>keys.map(k=>csv_escape(r[k], sanitize)).join(',')).join('\n');
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
    if (!is_tty() && fmt == 'raw')
        fmt = typeof data == 'string' ? 'raw' : 'json';
    const content = serialize(data, fmt);
    process.stdout.write(
        (is_tty() ? terminal_safe(content) : content) + '\n'
    );
};

const print_table = (rows: Record<string, unknown>[], cols: string[])=>{
    if (!rows.length)
        return;
    const tty = is_tty();
    const safe_value = (value: unknown): string=>{
        const text = String(value ?? '');
        const safe_text = tty ? terminal_safe(text) : text;
        return safe_text.replace(/[\n\t]/g, ' ');
    };
    const safe_cols = cols.map(safe_value);
    const safe_rows = rows.map(r=>
        cols.map(c=>safe_value(r[c])));
    const widths = safe_cols.map((c, i)=>
        Math.max(
            c.length,
            ...safe_rows.map(row=>row[i].length),
        )
    );
    const divider = widths.map(w=>'-'.repeat(w)).join('-+-');
    const header = safe_cols.map((c, i)=>
        c.padEnd(widths[i])).join(' | ');
    console.log(dim(header));
    console.log(dim(divider)); 
    for (const row of safe_rows)
    {
        console.log(
            row.map((cell, i)=>
                cell.padEnd(widths[i])).join(' | ')
        );
    }
};

export {
    is_tty,
    green, red, yellow, dim,
    success, warn, info, fail,
    format_from_ext, serialize, print, print_table,
    sanitize_serialized_csv,
};
export type {Output_format, Print_opts};
