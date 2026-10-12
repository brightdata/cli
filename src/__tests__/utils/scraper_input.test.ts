import {describe, it, expect} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {build_records, read_input} from '../../utils/scraper_input';

const fields = [
    {name: 'url', type: 'url', required: true},
    {name: 'max_reviews', type: 'number', required: false},
    {name: 'variation_specific', type: 'boolean', required: false},
    {name: 'reviews_to_not_include', type: 'array', required: false},
];
const search_fields = [
    {name: 'keyword', type: 'text', required: true},
    {name: 'url', type: 'url', required: true},
    {name: 'pages_to_search', type: 'number', required: false},
];

describe('scraper_input build_records', ()=>{
    it('turns each URL into a record with the shared flags', ()=>{
        expect(build_records(fields, ['https://a.com', '--max_reviews', '50',
            'https://b.com'])).toEqual([
            {url: 'https://a.com', max_reviews: 50},
            {url: 'https://b.com', max_reviews: 50},
        ]);
    });
    it('builds one record from flags', ()=>{
        expect(build_records(search_fields, ['--keyword', 'laptop', '--url',
            'https://amazon.com', '--pages_to_search=2'])).toEqual([
            {keyword: 'laptop', url: 'https://amazon.com',
                pages_to_search: 2},
        ]);
    });
    it('coerces booleans and arrays by field type', ()=>{
        expect(build_records(fields, ['https://a.com',
            '--variation_specific', '--reviews_to_not_include', 'a,b',
            '--reviews_to_not_include', 'c'])).toEqual([
            {url: 'https://a.com', variation_specific: true,
                reviews_to_not_include: ['a', 'b', 'c']},
        ]);
        expect(build_records(fields, ['--variation_specific', 'false',
            'https://a.com'])[0].variation_specific).toBe(false);
    });
    it('a boolean flag does not swallow the next URL', ()=>{
        expect(build_records(fields, ['--variation_specific',
            'https://a.com'])).toEqual([
            {url: 'https://a.com', variation_specific: true},
        ]);
    });
    it('rejects unknown fields and lists the real ones', ()=>{
        expect(()=>build_records(fields, ['https://a.com', '--max_review',
            '5'])).toThrow('Unknown field --max_review. Fields: --url, '
            +'--max_reviews, --variation_specific, --reviews_to_not_include');
    });
    it('rejects missing required fields', ()=>{
        expect(()=>build_records(search_fields, ['--keyword', 'laptop']))
            .toThrow('Missing required field(s): --url');
    });
    it('rejects bad numbers, repeats and stray options', ()=>{
        expect(()=>build_records(fields, ['https://a.com', '--max_reviews',
            'many'])).toThrow('--max_reviews must be a number, got "many"');
        expect(()=>build_records(search_fields, ['--keyword', 'a',
            '--keyword', 'b', '--url', 'u'])).toThrow('given more than once');
        expect(()=>build_records(fields, ['-x'])).toThrow('Unknown option -x');
    });
    it('rejects URLs for methods without a url field', ()=>{
        expect(()=>build_records([{name: 'keyword', type: 'text',
            required: true}], ['https://a.com']))
            .toThrow('This method takes no URL. Fields: --keyword');
    });
    it('rejects URLs and --url together, and empty input', ()=>{
        expect(()=>build_records(fields, ['https://a.com', '--url', 'b']))
            .toThrow('not both');
        expect(()=>build_records(fields, [])).toThrow(/^No input\./);
    });
    it('passes anything through when the method has no fields', ()=>{
        expect(build_records([], ['https://a.com', '--anything', 'x']))
            .toEqual([{url: 'https://a.com', anything: 'x'}]);
    });
});

describe('scraper_input read_input', ()=>{
    it('accepts an object, an array or a file', ()=>{
        expect(read_input('{"url":"u"}')).toEqual([{url: 'u'}]);
        expect(read_input('[{"a":1},{"a":2}]')).toHaveLength(2);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-input-'));
        const file = path.join(dir, 'in.json');
        fs.writeFileSync(file, '[{"keyword":"x"}]');
        try {
            expect(read_input(`@${file}`)).toEqual([{keyword: 'x'}]);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
    it('rejects bad JSON and non-objects', ()=>{
        expect(()=>read_input('{nope')).toThrow(/not valid JSON/);
        expect(()=>read_input('[]')).toThrow(/non-empty array/);
        expect(()=>read_input('["u"]')).toThrow(/non-empty array/);
    });
});
