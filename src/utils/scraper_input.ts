import fs from 'fs';
import type {Input_field, Input_record} from '../types/pipelines';

const BOOL_VALUES = ['true', 'false'];

const parse_args = (args: string[], fields: Input_field[])=>{
    const types = new Map(fields.map(f=>[f.name, f.type]));
    const urls: string[] = [];
    const flags: Record<string, string[]> = {};
    for (let i=0; i<args.length; i++)
    {
        const arg = args[i];
        if (!arg.startsWith('-'))
        {
            urls.push(arg);
            continue;
        }
        if (!arg.startsWith('--') || arg == '--')
            throw new Error(`Unknown option ${arg}`);
        const eq = arg.indexOf('=');
        const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
        let value = eq > 0 ? arg.slice(eq+1) : args[i+1];
        const is_bool = types.get(name) == 'boolean';
        if (eq < 0 && (value === undefined || value.startsWith('--')
            || is_bool && !BOOL_VALUES.includes(value)))
        {
            value = 'true';
        }
        else if (eq < 0)
            i++;
        (flags[name] ??= []).push(value);
    }
    return {urls, flags};
};

const coerce = (name: string, type: string|undefined,
    values: string[]): unknown=>{
    if (type == 'array')
        return values.flatMap(v=>v.split(',')).map(v=>v.trim())
            .filter(Boolean);
    if (values.length > 1)
        throw new Error(`--${name} is given more than once`);
    const value = values[0];
    if (type == 'number')
    {
        const n = Number(value);
        if (value.trim() == '' || !Number.isFinite(n))
            throw new Error(`--${name} must be a number, got "${value}"`);
        return n;
    }
    if (type == 'boolean')
    {
        if (!BOOL_VALUES.includes(value))
            throw new Error(`--${name} must be true or false`);
        return value == 'true';
    }
    return value;
};

const build_records = (fields: Input_field[],
    args: string[]): Input_record[]=>{
    const {urls, flags} = parse_args(args, fields);
    const known = new Map(fields.map(f=>[f.name, f]));
    const names = fields.map(f=>`--${f.name}`).join(', ');
    const base: Input_record = {};
    for (const [name, values] of Object.entries(flags))
    {
        if (fields.length && !known.has(name))
            throw new Error(`Unknown field --${name}. Fields: ${names}`);
        base[name] = coerce(name, known.get(name)?.type, values);
    }
    if (urls.length && fields.length && !known.has('url'))
        throw new Error(`This method takes no URL. Fields: ${names}`);
    if (urls.length && 'url' in base)
        throw new Error('Pass URLs as arguments or with --url, not both');
    const records = urls.length ? urls.map(url=>({url, ...base})) : [base];
    if (!Object.keys(records[0]).length)
    {
        throw new Error('No input. Pass URLs, field flags or --input. '
            +'See the fields with: brightdata pipelines info <dataset_id> '
            +'<method>');
    }
    const missing = fields.filter(f=>f.required && !(f.name in records[0]));
    if (missing.length)
    {
        throw new Error('Missing required field(s): '
            +missing.map(f=>`--${f.name}`).join(', '));
    }
    return records;
};

const read_input = (raw: string): Input_record[]=>{
    const text = raw.startsWith('@')
        ? fs.readFileSync(raw.slice(1), 'utf8') : raw;
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch(e) {
        throw new Error(`--input is not valid JSON: ${(e as Error).message}`);
    }
    const list = Array.isArray(data) ? data : [data];
    if (!list.length || list.some(r=>!r || typeof r != 'object'
        || Array.isArray(r)))
    {
        throw new Error('--input must be a JSON object or a non-empty array '
            +'of objects');
    }
    return list as Input_record[];
};

export {parse_args, build_records, read_input};
