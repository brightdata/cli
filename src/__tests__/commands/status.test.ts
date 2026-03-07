import {describe, it, expect, beforeEach, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    ensure_authenticated: vi.fn(),
    get: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    dim: vi.fn((msg: string)=>msg),
    fail: vi.fn((msg: string)=>{ throw new Error(`fail:${msg}`); }),
    parse_timeout: vi.fn(),
    poll_until: vi.fn(),
}));

vi.mock('../../utils/auth', ()=>({
    ensure_authenticated: mocks.ensure_authenticated,
}));

vi.mock('../../utils/client', ()=>({
    get: mocks.get,
}));

vi.mock('../../utils/spinner', ()=>({
    start: mocks.start,
}));

vi.mock('../../utils/output', ()=>({
    print: mocks.print,
    dim: mocks.dim,
    fail: mocks.fail,
}));

vi.mock('../../utils/polling', ()=>({
    parse_timeout: mocks.parse_timeout,
    poll_until: mocks.poll_until,
}));

import {handle_status} from '../../commands/status';

describe('commands/status', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    it('prints one-shot status when --wait is not used', async()=>{
        mocks.get.mockResolvedValue({status: 'ready', snapshot_id: 's1'});
        await handle_status('s1', {});
        expect(mocks.ensure_authenticated).toHaveBeenCalledWith(undefined);
        expect(mocks.get).toHaveBeenCalledWith(
            'api_key',
            '/datasets/v3/progress/s1',
            {timing: undefined}
        );
        expect(mocks.print).toHaveBeenCalledWith(
            {status: 'ready', snapshot_id: 's1'},
            {json: undefined, pretty: undefined, output: undefined}
        );
        expect(mocks.poll_until).not.toHaveBeenCalled();
    });

    it('uses shared polling utility when --wait is enabled', async()=>{
        mocks.get.mockResolvedValueOnce({status: 'running'});
        mocks.parse_timeout.mockReturnValue(4);
        mocks.poll_until.mockResolvedValue({
            result: {status: 'ready', snapshot_id: 's2'},
            attempts: 2,
            last_status: 'ready',
        });
        await handle_status('s2', {wait: true, timeout: '4'});
        expect(mocks.parse_timeout).toHaveBeenCalledWith('4');
        expect(mocks.poll_until).toHaveBeenCalledTimes(1);
        const poll_args = mocks.poll_until.mock.calls[0][0];
        expect(poll_args.timeout_seconds).toBe(3);
        expect(mocks.print).toHaveBeenCalledWith(
            {status: 'ready', snapshot_id: 's2'},
            {json: undefined, pretty: undefined, output: undefined}
        );
    });

    it('skips polling when first status is already complete', async()=>{
        mocks.get.mockResolvedValueOnce({status: 'ready'});
        mocks.parse_timeout.mockReturnValue(5);
        await handle_status('s3', {wait: true, timeout: '5'});
        expect(mocks.poll_until).not.toHaveBeenCalled();
        expect(mocks.print).toHaveBeenCalledWith(
            {status: 'ready'},
            {json: undefined, pretty: undefined, output: undefined}
        );
    });
});
