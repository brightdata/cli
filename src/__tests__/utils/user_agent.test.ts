import {describe, it, expect, vi, afterEach} from 'vitest';
import packageJson from '../../../package.json';

vi.mock('../../utils/config', ()=>({load: ()=>({})}));

import {get} from '../../utils/client';

describe('utils/user_agent', ()=>{
    afterEach(()=>{
        vi.unstubAllGlobals();
    });

    it('sends brightdata-cli/<version> on API requests', async()=>{
        const fetch_mock = vi.fn().mockResolvedValue(new Response('{}', {
            headers: {'content-type': 'application/json'}}));
        vi.stubGlobal('fetch', fetch_mock);
        await get('key', '/status');
        const headers = fetch_mock.mock.calls[0][1].headers;
        expect(headers['User-Agent'])
            .toBe(`brightdata-cli/${packageJson.version}`);
    });
});
