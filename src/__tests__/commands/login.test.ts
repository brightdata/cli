import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(()=>({
    save: vi.fn(),
    validate_key: vi.fn(),
    mask_key: vi.fn((key: string)=>`masked:${key}`),
    get_config: vi.fn(),
    set_config: vi.fn(),
    client_get: vi.fn(),
    client_post: vi.fn(),
    loopback_flow: vi.fn(),
    device_flow: vi.fn(),
    github_flow: vi.fn(),
    rl_question: vi.fn(),
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

vi.mock('readline', ()=>({
    default: {
        createInterface: vi.fn(()=>({
            question: mocks.rl_question,
            close: vi.fn(),
        })),
    },
}));

vi.mock('../../utils/browser_auth', ()=>({
    loopback_flow: mocks.loopback_flow,
    device_flow: mocks.device_flow,
    github_flow: mocks.github_flow,
}));

import {handle_login} from '../../commands/login';

describe('commands/login', ()=>{
    const original_customer_id = process.env['BRIGHTDATA_CUSTOMER_ID'];

    beforeEach(()=>{
        vi.clearAllMocks();
        if (original_customer_id === undefined)
            delete process.env['BRIGHTDATA_CUSTOMER_ID'];
        else
            process.env['BRIGHTDATA_CUSTOMER_ID'] = original_customer_id;
        mocks.mask_key.mockImplementation((key: string)=>`masked:${key}`);
        mocks.get_config.mockReturnValue(undefined);
        mocks.client_get.mockResolvedValue([
            {name: 'cli_unlocker', type: 'unblocker'},
            {name: 'cli_browser', type: 'browser_api'},
        ]);
        mocks.validate_key.mockResolvedValue(true);
        mocks.loopback_flow.mockResolvedValue('oauth_key');
        mocks.device_flow.mockResolvedValue('device_key');
        mocks.github_flow.mockResolvedValue('github_key');
        vi.spyOn(console, 'error').mockImplementation(()=>undefined);
    });

    afterEach(()=>{
        vi.restoreAllMocks();
        if (original_customer_id === undefined)
            delete process.env['BRIGHTDATA_CUSTOMER_ID'];
        else
            process.env['BRIGHTDATA_CUSTOMER_ID'] = original_customer_id;
    });

    it('uses loopback flow by default and saves the returned key', async()=>{
        await handle_login({});

        expect(mocks.loopback_flow).toHaveBeenCalledWith({
            customer_id: undefined,
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

    it('uses device flow without requiring a customer id and creates missing zones', async()=>{
        mocks.get_config.mockReturnValue('existing_zone');
        mocks.client_get.mockResolvedValue([]);

        await handle_login({device: true});

        expect(mocks.device_flow).toHaveBeenCalledWith({
            customer_id: undefined,
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

    it('forwards an optional customer id from the flag', async()=>{
        await handle_login({customerId: ' hl_prompt '});

        expect(mocks.loopback_flow).toHaveBeenCalledWith({
            customer_id: 'hl_prompt',
        });
    });

    it('forwards an optional customer id from the environment', async()=>{
        process.env['BRIGHTDATA_CUSTOMER_ID'] = ' hl_env ';

        await handle_login({});

        expect(mocks.loopback_flow).toHaveBeenCalledWith({
            customer_id: 'hl_env',
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

    it('uses github flow when --github flag is set', async()=>{
        await handle_login({github: true});

        expect(mocks.github_flow).toHaveBeenCalledWith({
            customer_id: undefined,
        });
        expect(mocks.loopback_flow).not.toHaveBeenCalled();
        expect(mocks.device_flow).not.toHaveBeenCalled();
        expect(mocks.save).toHaveBeenCalledWith({api_key: 'github_key'});
    });

    it('passes customer_id to github flow', async()=>{
        await handle_login({github: true, customerId: 'hl_cust'});

        expect(mocks.github_flow).toHaveBeenCalledWith({
            customer_id: 'hl_cust',
        });
        expect(mocks.save).toHaveBeenCalledWith({api_key: 'github_key'});
    });

    it('falls back to device flow when github flow fails and user answers y', async()=>{
        mocks.github_flow.mockRejectedValue(new Error('GitHub auth init failed (HTTP 400)'));
        mocks.rl_question.mockImplementation(
            (_question: string, cb: (answer: string)=>void)=>cb('y')
        );

        await handle_login({github: true});

        expect(mocks.github_flow).toHaveBeenCalled();
        expect(mocks.device_flow).toHaveBeenCalledWith({customer_id: undefined});
        expect(mocks.save).toHaveBeenCalledWith({api_key: 'device_key'});
    });

    it('exits 1 when user declines github fallback to device flow', async()=>{
        const error = new Error('GitHub auth init failed (HTTP 400)');
        mocks.github_flow.mockRejectedValue(error);
        mocks.rl_question.mockImplementation(
            (_question: string, cb: (answer: string)=>void)=>cb('n')
        );
        vi.spyOn(process, 'exit').mockImplementation(((
            code?: string|number|null
        )=>{
            throw new Error(`exit:${code}`);
        }) as never);

        await expect(handle_login({github: true})).rejects.toThrow('exit:1');

        expect(mocks.device_flow).not.toHaveBeenCalled();
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it('exits 1 when loopback flow fails', async()=>{
        mocks.loopback_flow.mockRejectedValue(new Error('Timed out waiting for callback'));
        vi.spyOn(process, 'exit').mockImplementation(((
            code?: string|number|null
        )=>{
            throw new Error(`exit:${code}`);
        }) as never);

        await expect(handle_login({})).rejects.toThrow('exit:1');

        expect(mocks.save).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('Timed out waiting for callback')
        );
    });

    it('exits 1 when device flow fails', async()=>{
        mocks.device_flow.mockRejectedValue(new Error('Device code expired'));
        vi.spyOn(process, 'exit').mockImplementation(((
            code?: string|number|null
        )=>{
            throw new Error(`exit:${code}`);
        }) as never);

        await expect(handle_login({device: true})).rejects.toThrow('exit:1');

        expect(mocks.save).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('Device code expired')
        );
    });

    it('exits 1 when github fallback to device flow also fails', async()=>{
        mocks.github_flow.mockRejectedValue(new Error('GitHub auth init failed (HTTP 400)'));
        mocks.device_flow.mockRejectedValue(new Error('Device code expired'));
        mocks.rl_question.mockImplementation(
            (_question: string, cb: (answer: string)=>void)=>cb('y')
        );
        vi.spyOn(process, 'exit').mockImplementation(((
            code?: string|number|null
        )=>{
            throw new Error(`exit:${code}`);
        }) as never);

        await expect(handle_login({github: true})).rejects.toThrow('exit:1');

        expect(mocks.device_flow).toHaveBeenCalled();
        expect(mocks.save).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('Device code expired')
        );
    });
});
