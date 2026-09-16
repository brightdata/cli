import {describe, it, expect, vi, beforeEach} from 'vitest';

const mocks = vi.hoisted(()=>({
    set_config: vi.fn(),
    fail: vi.fn(),
    success: vi.fn(),
}));

vi.mock('../../utils/config', ()=>({
    load: vi.fn(),
    get: vi.fn(),
    set: mocks.set_config,
}));

vi.mock('../../utils/output', ()=>({
    print: vi.fn(),
    fail: mocks.fail,
    success: mocks.success,
}));

import {handle_set_config} from '../../commands/config';

describe('commands/config', ()=>{
    beforeEach(()=>{
        vi.clearAllMocks();
    });

    it('stores sanitize_csv false as boolean false', ()=>{
        handle_set_config('sanitize_csv', 'false');

        expect(mocks.set_config).toHaveBeenCalledWith(
            'sanitize_csv',
            false
        );
        expect(mocks.fail).not.toHaveBeenCalled();
        expect(mocks.success).toHaveBeenCalledWith(
            'Config updated: sanitize_csv=false'
        );
    });

    it('stores sanitize_csv true as boolean true', ()=>{
        handle_set_config('sanitize_csv', 'true');

        expect(mocks.set_config).toHaveBeenCalledWith(
            'sanitize_csv',
            true
        );
        expect(mocks.fail).not.toHaveBeenCalled();
        expect(mocks.success).toHaveBeenCalledWith(
            'Config updated: sanitize_csv=true'
        );
    });

    it('rejects invalid sanitize_csv value without modifying config', ()=>{
        handle_set_config('sanitize_csv', 'maybe');

        expect(mocks.fail).toHaveBeenCalledWith(
            'sanitize_csv must be true or false'
        );
        expect(mocks.set_config).not.toHaveBeenCalled();
        expect(mocks.success).not.toHaveBeenCalled();
    });
});