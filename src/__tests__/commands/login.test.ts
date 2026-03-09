import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    input: vi.fn(),
    save: vi.fn(),
    validate_key: vi.fn(),
    mask_key: vi.fn((key: string)=>`masked:${key}`),
    get_config: vi.fn(),
    set_config: vi.fn(),
    client_get: vi.fn(),
    client_post: vi.fn(),
    loopback_flow: vi.fn(),
    device_flow: vi.fn(),
}));

vi.mock('@inquirer/prompts', ()=>({
    input: mocks.input,
}));

vi.mock('../../utils/credentials', ()=>({
    save: mocks.save,
}));

vi.mock('../../utils/auth', ()=>({
    validate_key: mocks.validate_key,
    mask_key: mocks.mask_key,
}));

vi.mock('../../utils/config', ()=>({
    get: mocks.get_config,
    set: mocks.set_config,
}));

vi.mock('../../utils/client', ()=>({
    get: mocks.client_get,
    post: mocks.client_post,
}));

vi.mock('../../utils/browser_auth', ()=>({
    loopback_flow: mocks.loopback_flow,
    device_flow: mocks.device_flow,
}));

import {handle_login} from '../../commands/login';

describe('commands/login', ()=>{
    const original_customer_id = process.env['BRIGHTDATA_CUSTOMER_ID'];
    const stdin_tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

    beforeEach(()=>{
        vi.clearAllMocks();
        if (original_customer_id === undefined)
            delete process.env['BRIGHTDATA_CUSTOMER_ID'];
        else
            process.env['BRIGHTDATA_CUSTOMER_ID'] = original_customer_id;
        if (stdin_tty)
            Object.defineProperty(process.stdin, 'isTTY', stdin_tty);
        mocks.mask_key.mockImplementation((key: string)=>`masked:${key}`);
        mocks.get_config.mockReturnValue(undefined);
        mocks.client_get.mockResolvedValue([
            {name: 'cli_unlocker', type: 'unblocker'},
            {name: 'cli_browser', type: 'browser_api'},
        ]);
        mocks.validate_key.mockResolvedValue(true);
        mocks.loopback_flow.mockResolvedValue('oauth_key');
        mocks.device_flow.mockResolvedValue('device_key');
        vi.spyOn(console, 'error').mockImplementation(()=>undefined);
    });

    afterEach(()=>{
        vi.restoreAllMocks();
        if (stdin_tty)
            Object.defineProperty(process.stdin, 'isTTY', stdin_tty);
        if (original_customer_id === undefined)
            delete process.env['BRIGHTDATA_CUSTOMER_ID'];
        else
            process.env['BRIGHTDATA_CUSTOMER_ID'] = original_customer_id;
    });

    it('uses loopback flow by default and saves the returned key', async()=>{
        await handle_login({customerId: 'hl_browser'});

        expect(mocks.loopback_flow).toHaveBeenCalledWith({
            customer_id: 'hl_browser',
        });
        expect(mocks.device_flow).not.toHaveBeenCalled();
        expect(mocks.validate_key).not.toHaveBeenCalled();
        expect(mocks.save).toHaveBeenCalledWith({api_key: 'oauth_key'});
        expect(mocks.client_get).toHaveBeenCalledWith(
            'oauth_key',
            '/zone/get_active_zones'
        );
        expect(mocks.client_post).not.toHaveBeenCalled();
        expect(mocks.set_config).toHaveBeenCalledWith(
            'default_zone_unlocker',
            'cli_unlocker'
        );
    });

    it('uses device flow and creates missing zones', async()=>{
        process.env['BRIGHTDATA_CUSTOMER_ID'] = 'hl_env';
        mocks.get_config.mockReturnValue('existing_zone');
        mocks.client_get.mockResolvedValue([]);

        await handle_login({device: true});

        expect(mocks.device_flow).toHaveBeenCalledWith({
            customer_id: 'hl_env',
        });
        expect(mocks.loopback_flow).not.toHaveBeenCalled();
        expect(mocks.client_post).toHaveBeenNthCalledWith(
            1,
            'device_key',
            '/zone',
            {
                zone: {name: 'cli_unlocker', type: 'unblocker'},
                plan: {type: 'unblocker'},
            }
        );
        expect(mocks.client_post).toHaveBeenNthCalledWith(
            2,
            'device_key',
            '/zone',
            {
                zone: {name: 'cli_browser', type: 'browser_api'},
                plan: {type: 'browser_api'},
            }
        );
        expect(mocks.set_config).not.toHaveBeenCalled();
    });

    it('validates a direct API key before saving it', async()=>{
        await handle_login({apiKey: '  raw_api_key  '});

        expect(mocks.validate_key).toHaveBeenCalledWith('raw_api_key');
        expect(mocks.loopback_flow).not.toHaveBeenCalled();
        expect(mocks.device_flow).not.toHaveBeenCalled();
        expect(mocks.save).toHaveBeenCalledWith({api_key: 'raw_api_key'});
        expect(mocks.client_get).toHaveBeenCalledWith(
            'raw_api_key',
            '/zone/get_active_zones'
        );
    });

    it('prompts for a customer id when browser login is interactive', async()=>{
        Object.defineProperty(process.stdin, 'isTTY', {
            value: true,
            configurable: true,
        });
        mocks.input.mockResolvedValue(' hl_prompt ');

        await handle_login({});

        expect(mocks.input).toHaveBeenCalledWith({
            message: 'Enter your Bright Data account ID (starts with hl_):',
        });
        expect(mocks.loopback_flow).toHaveBeenCalledWith({
            customer_id: 'hl_prompt',
        });
    });

    it('exits when a direct API key is invalid', async()=>{
        mocks.validate_key.mockResolvedValue(false);
        vi.spyOn(process, 'exit').mockImplementation(((
            code?: string|number|null
        )=>{
            throw new Error(`exit:${code}`);
        }) as never);

        await expect(handle_login({apiKey: 'bad_key'}))
            .rejects.toThrow('exit:1');

        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.client_get).not.toHaveBeenCalled();
    });
});
