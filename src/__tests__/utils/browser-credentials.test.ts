import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    get: vi.fn(),
    post: vi.fn(),
}));

vi.mock('../../utils/client', ()=>({
    get: mocks.get,
    post: mocks.post,
}));

import {
    ensure_browser_zone,
    get_cdp_endpoint,
} from '../../utils/browser-credentials';

describe('utils/browser-credentials', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
    });

    it('does not create the browser zone when it already exists', async()=>{
        mocks.get.mockResolvedValueOnce([
            {name: 'cli_browser', type: 'browser_api'},
        ]);

        await expect(ensure_browser_zone('api_key')).resolves.toBeUndefined();

        expect(mocks.get).toHaveBeenCalledWith(
            'api_key',
            '/zone/get_active_zones'
        );
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it('creates the default browser zone when it is missing', async()=>{
        mocks.get.mockResolvedValueOnce([
            {name: 'cli_unlocker', type: 'unblocker'},
        ]);
        mocks.post.mockResolvedValueOnce({});

        await ensure_browser_zone('api_key');

        expect(mocks.post).toHaveBeenCalledWith('api_key', '/zone', {
            zone: {name: 'cli_browser', type: 'browser_api'},
            plan: {type: 'browser_api'},
        });
    });

    it('creates a custom browser zone when an override is missing', async()=>{
        mocks.get.mockResolvedValueOnce([]);
        mocks.post.mockResolvedValueOnce({});

        await ensure_browser_zone('api_key', ' browser_us ');

        expect(mocks.post).toHaveBeenCalledWith('api_key', '/zone', {
            zone: {name: 'browser_us', type: 'browser_api'},
            plan: {type: 'browser_api'},
        });
    });

    it('builds a CDP endpoint without country targeting', async()=>{
        mocks.get
            .mockResolvedValueOnce({customer: 'hl_123'})
            .mockResolvedValueOnce({passwords: ['secret']});

        await expect(get_cdp_endpoint('api_key', 'cli_browser'))
            .resolves.toBe(
                'wss://brd-customer-hl_123-zone-cli_browser:secret@'
                +'brd.superproxy.io:9222'
            );

        expect(mocks.get).toHaveBeenNthCalledWith(1, 'api_key', '/status');
        expect(mocks.get).toHaveBeenNthCalledWith(
            2,
            'api_key',
            '/zone/passwords?zone=cli_browser'
        );
    });

    it('builds a CDP endpoint with normalized country targeting', async()=>{
        mocks.get
            .mockResolvedValueOnce({customer: 'hl_123'})
            .mockResolvedValueOnce({passwords: ['secret']});

        await expect(get_cdp_endpoint('api_key', ' cli_browser ', ' US '))
            .resolves.toBe(
                'wss://brd-customer-hl_123-zone-cli_browser-country-us:'
                +'secret@brd.superproxy.io:9222'
            );
    });

    it('throws when the customer id is missing', async()=>{
        mocks.get.mockResolvedValueOnce({});

        await expect(get_cdp_endpoint('api_key', 'cli_browser'))
            .rejects.toThrow(
                'Could not resolve Bright Data customer ID from /status.'
            );
    });

    it('throws when the zone has no passwords', async()=>{
        mocks.get
            .mockResolvedValueOnce({customer: 'hl_123'})
            .mockResolvedValueOnce({passwords: []});

        await expect(get_cdp_endpoint('api_key', 'cli_browser'))
            .rejects.toThrow(
                'No browser password found for zone "cli_browser".'
            );
    });

    it('rejects invalid country codes before making requests', async()=>{
        await expect(get_cdp_endpoint('api_key', 'cli_browser', 'usa'))
            .rejects.toThrow('Browser country must be a 2-letter ISO code.');

        expect(mocks.get).not.toHaveBeenCalled();
    });
});

