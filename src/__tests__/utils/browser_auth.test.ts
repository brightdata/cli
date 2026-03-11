import {describe, expect, it} from 'vitest';
import {
    build_authorize_url,
    build_device_start_body,
} from '../../utils/browser_auth';

describe('utils/browser_auth', ()=>{
    it('omits customer_id from the authorize URL when not provided', ()=>{
        const url = build_authorize_url({
            redirect_uri: 'http://127.0.0.1:3000/callback',
            state: 'state_123',
            code_challenge: 'challenge_123',
        });

        expect(url.searchParams.get('redirect_uri'))
            .toBe('http://127.0.0.1:3000/callback');
        expect(url.searchParams.get('state')).toBe('state_123');
        expect(url.searchParams.get('code_challenge')).toBe('challenge_123');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.has('customer_id')).toBe(false);
    });

    it('includes a trimmed customer_id in the authorize URL when provided', ()=>{
        const url = build_authorize_url({
            redirect_uri: 'http://127.0.0.1:3000/callback',
            state: 'state_123',
            code_challenge: 'challenge_123',
            customer_id: ' hl_123 ',
        });

        expect(url.searchParams.get('customer_id')).toBe('hl_123');
    });

    it('omits customer_id from the device start body when not provided', ()=>{
        expect(build_device_start_body(undefined)).toEqual({});
        expect(build_device_start_body('   ')).toEqual({});
    });

    it('includes a trimmed customer_id in the device start body when provided', ()=>{
        expect(build_device_start_body(' hl_123 ')).toEqual({
            customer_id: 'hl_123',
        });
    });
});
