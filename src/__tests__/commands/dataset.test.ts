import {describe, it, expect, vi, afterEach} from 'vitest';
import {handle_pipelines} from '../../commands/dataset';

describe('commands/pipelines list', ()=>{
    afterEach(()=>{
        vi.restoreAllMocks();
    });

    it('prints available pipeline dataset types', async()=>{
        let output = '';
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(
            text=>{
                output += String(text);
                return true;
            }
        );
        await handle_pipelines('list', [], {});
        expect(write).toHaveBeenCalled();
        expect(output.includes('amazon_product')).toBe(true);
        expect(output.includes('linkedin_person_profile')).toBe(true);
        expect(output.includes('youtube_comments')).toBe(true);
    });
});
