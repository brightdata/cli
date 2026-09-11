import {describe, it, expect, vi, afterEach, beforeEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    poll_until: vi.fn(),
    ensure_authenticated: vi.fn(),
    spinner_stop: vi.fn(),
    get_config: vi.fn(),
}));
vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));
vi.mock('../../utils/client', ()=>({
    post: mocks.post,
    get: vi.fn(),
}));
vi.mock('../../utils/polling', async import_original=>{
    const actual = await import_original<typeof import('../../utils/polling')>();
    return {
        ...actual,
        poll_until: mocks.poll_until,
    };
});
vi.mock('../../utils/spinner', ()=>({
    start: ()=>({
        stop: mocks.spinner_stop,
    }),
}));
vi.mock('../../utils/config', ()=>({
    get: mocks.get_config,
}));

import {handle_pipelines} from '../../commands/dataset';

describe('commands/pipelines list', ()=>{
   beforeEach(()=>{
        mocks.ensure_authenticated.mockReturnValue('test-api-key');
        mocks.get_config.mockReturnValue(true);
        mocks.post.mockResolvedValue({
            snapshot_id: 'snapshot-1',
        });
    });
    afterEach(()=>{
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });
    it('prints available pipeline dataset types', async()=>{
        let output = '';
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(
            text=>{
                output += String(text);
                return true;
            }
        );
        await handle_pipelines('list', [], {});
        expect(write).toHaveBeenCalled();
        expect(output.includes('amazon_product')).toBe(true);
        expect(output.includes('linkedin_person_profile')).toBe(true);
        expect(output.includes('youtube_comments')).toBe(true);
    });
    it('sanitizes pipeline CSV written to stdout', async()=>{
        mocks.poll_until.mockResolvedValue({
            result: 'name,value\nfoo,"=SUM(1,2)"\n',
            attempts: 1,
        });
        let output = '';
        vi.spyOn(process.stdout, 'write').mockImplementation(text=>{
            output += String(text);
            return true;
        });
        vi.spyOn(console, 'error').mockImplementation(()=>{});
        await handle_pipelines(
            'amazon_product',
            ['https://example.com/product'],
            {format: 'csv'}
        );
        expect(output).toContain("'=SUM(1,2)");
    });
    it('sanitizes pipeline CSV written to a file', async()=>{
        mocks.poll_until.mockResolvedValue({
            result: 'name,value\nfoo,"=SUM(1,2)"\n',
            attempts: 1,
        });
        vi.spyOn(console, 'error').mockImplementation(()=>{});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brightdata-'));
        const output_path = path.join(dir, 'result.csv');
        try {
            await handle_pipelines(
                'amazon_product',
                ['https://example.com/product'],
                {
                    format: 'csv',
                    output: output_path,
                }
            );
            const output = fs.readFileSync(output_path, 'utf8');
            expect(output).toContain("'=SUM(1,2)");
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});  
