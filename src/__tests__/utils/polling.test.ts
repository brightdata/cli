import {describe, it, expect, vi} from 'vitest';
import {parse_timeout, poll_until} from '../../utils/polling';

type Poll_item = {
    status: string;
    rows?: number;
};

describe('utils/polling.parse_timeout', ()=>{
    it('parses explicit timeout and floors decimals', ()=>{
        expect(parse_timeout('12.9')).toBe(12);
    });

    it('uses env value when timeout is not provided', ()=>{
        process.env['BRIGHTDATA_POLLING_TIMEOUT'] = '9';
        expect(parse_timeout(undefined)).toBe(9);
        delete process.env['BRIGHTDATA_POLLING_TIMEOUT'];
    });

    it('throws on invalid timeout', ()=>{
        expect(()=>parse_timeout('0')).toThrow('Invalid timeout "0"');
    });
});

describe('utils/polling.poll_until', ()=>{
    it('returns immediately when status is not running', async()=>{
        const fetch_once = vi.fn<() => Promise<Poll_item>>()
            .mockResolvedValue({status: 'ready', rows: 3});
        const result = await poll_until<Poll_item>({
            timeout_seconds: 5,
            fetch_once,
            get_status: (r: Poll_item)=>r.status,
            running_statuses: ['running'],
            interval_ms: 0,
        });
        expect(fetch_once).toHaveBeenCalledTimes(1);
        expect(result.attempts).toBe(1);
        expect(result.result).toEqual({status: 'ready', rows: 3});
    });

    it('polls until status is ready and reports running attempts', async()=>{
        const fetch_once = vi.fn<() => Promise<Poll_item>>()
            .mockResolvedValueOnce({status: 'running'})
            .mockResolvedValueOnce({status: 'building'})
            .mockResolvedValueOnce({status: 'ready', rows: 10});
        const on_running = vi.fn();
        const result = await poll_until<Poll_item>({
            timeout_seconds: 5,
            fetch_once,
            get_status: (r: Poll_item)=>r.status,
            running_statuses: ['running', 'building'],
            interval_ms: 0,
            on_running,
        });
        expect(fetch_once).toHaveBeenCalledTimes(3);
        expect(on_running).toHaveBeenCalledTimes(2);
        expect(result.attempts).toBe(3);
        expect(result.last_status).toBe('ready');
    });

    it('throws timeout error when status never completes', async()=>{
        const fetch_once = vi.fn<() => Promise<Poll_item>>()
            .mockResolvedValue({status: 'running'});
        await expect(poll_until<Poll_item>({
            timeout_seconds: 2,
            fetch_once,
            get_status: (r: Poll_item)=>r.status,
            running_statuses: ['running'],
            interval_ms: 0,
            timeout_label: 'data',
        })).rejects.toThrow('Timeout after 2 seconds waiting for data.');
    });
});
