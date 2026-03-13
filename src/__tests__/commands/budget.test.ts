import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    ensure_authenticated: vi.fn(),
    get: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    print: vi.fn(),
    print_table: vi.fn(),
    dim: vi.fn((msg: string)=>msg),
    green: vi.fn((msg: string)=>msg),
    yellow: vi.fn((msg: string)=>msg),
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
    dim: mocks.dim,
    green: mocks.green,
    print: mocks.print,
    print_table: mocks.print_table,
    yellow: mocks.yellow,
}));

import {
    handle_budget_balance,
    handle_budget_zone,
    handle_budget_zones,
} from '../../commands/budget';

describe('commands/budget', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
        mocks.ensure_authenticated.mockReturnValue('api_key');
        mocks.start.mockReturnValue({stop: mocks.stop});
    });

    afterEach(()=>{
        vi.restoreAllMocks();
    });

    it('prints a human-readable balance summary by default', async()=>{
        let output = '';
        vi.spyOn(process.stdout, 'write').mockImplementation(text=>{
            output += String(text);
            return true;
        });

        mocks.get.mockResolvedValue({
            balance: 456,
            pending_balance: 123,
        });

        await handle_budget_balance({});

        expect(mocks.ensure_authenticated).toHaveBeenCalledWith(undefined);
        expect(mocks.get).toHaveBeenCalledWith(
            'api_key',
            '/customer/balance',
            {timing: undefined}
        );
        expect(mocks.green).toHaveBeenCalledWith('$456.00');
        expect(mocks.print).not.toHaveBeenCalled();
        expect(output).toBe(
            'Balance         $456.00\n'
            +'Pending charge  $123.00\n'
        );
    });

    it('prints balance JSON when --json is used', async()=>{
        mocks.get.mockResolvedValue({
            balance: 10,
            pending_balance: 1.5,
        });

        await handle_budget_balance({json: true});

        expect(mocks.print).toHaveBeenCalledWith(
            {balance: 10, pending_balance: 1.5},
            {json: true, pretty: undefined}
        );
    });

    it('prints a dimmed message when no active zones exist', async()=>{
        const console_log = vi.spyOn(console, 'log').mockImplementation(()=>{});
        mocks.get.mockResolvedValue([]);

        await handle_budget_zones({});

        expect(mocks.get).toHaveBeenCalledWith(
            'api_key',
            '/zone/get_active_zones',
            {timing: undefined}
        );
        expect(console_log).toHaveBeenCalledWith('No active zones found.');
        expect(mocks.print_table).not.toHaveBeenCalled();
    });

    it('aggregates zone costs and prints a table with totals', async()=>{
        mocks.get
            .mockResolvedValueOnce([
                {name: 'zone-a'},
                {name: 'zone-b'},
            ])
            .mockResolvedValueOnce({
                this_month: {
                    back_m1: {bw: 1024, cost: 1.25},
                    back_m2: {bw: 512, cost: 0.75},
                },
                prior_month: {
                    back_m1: {bw: 1024**2, cost: 2},
                },
            })
            .mockResolvedValueOnce({
                this_month: {
                    back_m1: {bw: 2048, cost: 3.5},
                },
            });

        await handle_budget_zones({
            from: '2026-03-01',
            to: '2026-03-31',
        });

        expect(mocks.get).toHaveBeenNthCalledWith(
            1,
            'api_key',
            '/zone/get_active_zones',
            {timing: undefined}
        );
        expect(mocks.get).toHaveBeenNthCalledWith(
            2,
            'api_key',
            '/zone/cost?zone=zone-a&from=2026-03-01&to=2026-03-31',
            {timing: undefined}
        );
        expect(mocks.get).toHaveBeenNthCalledWith(
            3,
            'api_key',
            '/zone/cost?zone=zone-b&from=2026-03-01&to=2026-03-31',
            {timing: undefined}
        );
        expect(mocks.print_table).toHaveBeenCalledWith(
            [
                {
                    zone: 'zone-a',
                    'cost ($)': '$4.00',
                    bandwidth: '1.0 MB',
                },
                {
                    zone: 'zone-b',
                    'cost ($)': '$3.50',
                    bandwidth: '2.0 KB',
                },
                {
                    zone: 'TOTAL',
                    'cost ($)': '$7.50',
                    bandwidth: '1.0 MB',
                },
            ],
            ['zone', 'cost ($)', 'bandwidth']
        );
    });

    it('prints aggregated zone rows as JSON when requested', async()=>{
        mocks.get
            .mockResolvedValueOnce([{name: 'zone-a'}])
            .mockResolvedValueOnce({
                this_month: {
                    back_m1: {bw: 500, cost: 2.25},
                },
            });

        await handle_budget_zones({pretty: true});

        expect(mocks.print).toHaveBeenCalledWith(
            [
                {
                    zone: 'zone-a',
                    cost: 2.25,
                    bw: 500,
                },
            ],
            {json: undefined, pretty: true}
        );
    });

    it('prints a human-readable zone detail view', async()=>{
        let output = '';
        vi.spyOn(process.stdout, 'write').mockImplementation(text=>{
            output += String(text);
            return true;
        });

        mocks.get
            .mockResolvedValueOnce({
                plan: {
                    product: 'dc',
                    type: 'static',
                    bandwidth: 'unlimited',
                },
            })
            .mockResolvedValueOnce({
                this_month: {
                    back_m1: {bw: 2048, cost: 12.34},
                },
            });

        await handle_budget_zone('my-zone', {});

        expect(mocks.get).toHaveBeenNthCalledWith(
            1,
            'api_key',
            '/zone?zone=my-zone',
            {timing: undefined}
        );
        expect(mocks.get).toHaveBeenNthCalledWith(
            2,
            'api_key',
            '/zone/cost?zone=my-zone',
            {timing: undefined}
        );
        expect(output).toMatch(/Zone:\s+my-zone/);
        expect(output).toMatch(/Type:\s+dc \/ static/);
        expect(output).toMatch(/Plan bandwidth:\s+unlimited/);
        expect(output).toMatch(/Cost \(this month\):\s+\$12\.34/);
        expect(output).toMatch(/Bandwidth used:\s+2\.0 KB/);
    });

    it('prints zone detail JSON when requested', async()=>{
        mocks.get
            .mockResolvedValueOnce({
                plan: {
                    product: 'res',
                    bandwidth: 'metered',
                },
            })
            .mockResolvedValueOnce({
                this_month: {
                    back_m1: {bw: 4096, cost: 9.5},
                },
            });

        await handle_budget_zone('zone-json', {json: true});

        expect(mocks.print).toHaveBeenCalledWith(
            {
                zone: 'zone-json',
                info: {
                    plan: {
                        product: 'res',
                        bandwidth: 'metered',
                    },
                },
                cost: {
                    this_month: {
                        back_m1: {bw: 4096, cost: 9.5},
                    },
                },
                totals: {
                    bw: 4096,
                    cost: 9.5,
                },
            },
            {json: true, pretty: undefined}
        );
    });
});
