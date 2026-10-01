import {describe, it, expect, vi} from 'vitest';
import {
    parse_major,
    is_supported_node,
    unsupported_message,
    assert_supported_node,
} from '../../utils/node-version';

describe('utils/node-version (floor 20)', ()=>{
    it('parses the major version', ()=>{
        expect(parse_major('20.17.0')).toBe(20);
        expect(parse_major('24.16.0')).toBe(24);
        expect(parse_major('garbage')).toBe(0);
    });

    it('accepts >= 20, rejects < 20', ()=>{
        expect(is_supported_node('20.0.0')).toBe(true);
        expect(is_supported_node('22.12.0')).toBe(true);
        expect(is_supported_node('24.16.0')).toBe(true);
        expect(is_supported_node('18.19.0')).toBe(false);
    });

    it('names the detected version in the message', ()=>{
        expect(unsupported_message('18.19.0')).toContain('v18.19.0');
        expect(unsupported_message('18.19.0')).toContain('Node 20 or newer');
    });

    it('writes + exits 1 on unsupported, no-ops on supported', ()=>{
        const write = vi.fn();
        const exit = vi.fn();
        assert_supported_node('18.19.0', write, exit as never);
        expect(write).toHaveBeenCalledOnce();
        expect(exit).toHaveBeenCalledWith(1);

        write.mockClear();
        exit.mockClear();
        assert_supported_node('20.0.0', write, exit as never);
        expect(write).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});
