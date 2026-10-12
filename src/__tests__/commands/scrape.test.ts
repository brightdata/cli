import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    post: vi.fn(),
    write_file: vi.fn(),
    ensure_authenticated: vi.fn(),
    resolve: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
}));

vi.mock('fs', ()=>({
    default: {writeFileSync: mocks.write_file},
}));

vi.mock('../../utils/client', ()=>({
    post: mocks.post,
}));

vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));

vi.mock('../../utils/config', ()=>({
    resolve: mocks.resolve,
}));

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}));

vi.mock('../../utils/output', ()=>({
    print: mocks.print,
    success: mocks.success,
    info: mocks.info,
    fail: mocks.fail,
}));

import {handle_scrape} from '../../commands/scrape';

describe('commands/scrape', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.resolve.mockReturnValue('cli_unlocker');
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    it('fails when no zone is resolved', async()=>{
        mocks.resolve.mockReturnValue(undefined);
        await expect(handle_scrape('https://example.com', {}))
            .rejects.toThrow('fail:No Web Unlocker zone specified.');
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('submits markdown scrape request by default and prints text response',
        async()=>{
            mocks.post.mockResolvedValue(Buffer.from('# hello'));
            await handle_scrape('https://example.com', {});
            expect(mocks.post).toHaveBeenCalledWith(
                'api_key',
                '/request',
                {
                    zone: 'cli_unlocker',
                    url: 'https://example.com',
                    format: 'raw',
                    data_format: 'markdown',
                },
                {timing: undefined, raw_buffer: true}
            );
            expect(mocks.print).toHaveBeenCalledWith(
                '# hello',
                {json: undefined, pretty: undefined, output: undefined}
            );
        });

    it('submits json scrape request and prints json response', async()=>{
        mocks.post.mockResolvedValue({status: 200, body: '{}', headers: {}});
        await handle_scrape('https://example.com', {format: 'json'});
        expect(mocks.post).toHaveBeenCalledWith(
            'api_key',
            '/request',
            {
                zone: 'cli_unlocker',
                url: 'https://example.com',
                format: 'json',
            },
            {timing: undefined, raw_buffer: false}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {status: 200, body: '{}', headers: {}},
            {json: undefined, pretty: undefined, output: undefined}
        );
    });

    it('handles async scrape mode with success message', async()=>{
        mocks.post.mockResolvedValue({response_id: 'resp_123'});
        await handle_scrape('https://example.com', {async: true});
        expect(mocks.success).toHaveBeenCalledWith(
            'Async job submitted. Response ID: resp_123'
        );
        expect(mocks.print).not.toHaveBeenCalled();
    });

    it('does not ask for a buffer in async mode', async()=>{
        mocks.post.mockResolvedValue({response_id: 'resp_123'});
        await handle_scrape('https://example.com', {async: true});
        expect(mocks.post.mock.calls[0][3])
            .toEqual({timing: undefined, raw_buffer: false});
    });

    it('writes a binary body to -o byte for byte', async()=>{
        const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xe2, 0xe3,
            0xcf, 0xd3, 0x0d, 0x0a, 0x78, 0x9c, 0xff, 0x00]);
        mocks.post.mockResolvedValue(pdf);
        await handle_scrape('https://example.com/a.pdf',
            {format: 'html', output: 'a.pdf'});
        expect(mocks.write_file).toHaveBeenCalledWith('a.pdf', pdf);
        expect(mocks.print).not.toHaveBeenCalled();
    });

    it('pipes a binary body to stdout untouched', async()=>{
        const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xe2, 0xe3, 0xff]);
        mocks.post.mockResolvedValue(pdf);
        const tty = process.stdout.isTTY;
        const write = vi.spyOn(process.stdout, 'write')
            .mockImplementation(()=>true);
        process.stdout.isTTY = false;
        try {
            await handle_scrape('https://example.com/a.pdf', {});
            expect(write).toHaveBeenCalledWith(pdf);
            expect(mocks.print).not.toHaveBeenCalled();
        } finally {
            process.stdout.isTTY = tty;
            write.mockRestore();
        }
    });

    it('keeps --json output for a binary body', async()=>{
        mocks.post.mockResolvedValue(Buffer.from([0x25, 0x50, 0xff]));
        await handle_scrape('https://example.com/a.pdf',
            {json: true, output: 'a.json'});
        expect(mocks.print).toHaveBeenCalled();
        expect(mocks.write_file).not.toHaveBeenCalled();
    });

    it('still prints utf-8 text through print with -o', async()=>{
        mocks.post.mockResolvedValue(Buffer.from('<p>naïve café</p>'));
        await handle_scrape('https://example.com',
            {format: 'html', output: 'a.html'});
        expect(mocks.print).toHaveBeenCalledWith('<p>naïve café</p>',
            {json: undefined, pretty: undefined, output: 'a.html'});
        expect(mocks.write_file).not.toHaveBeenCalled();
    });
});
