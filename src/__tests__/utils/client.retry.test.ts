import {describe, it, expect} from 'vitest';
import {
    compute_backoff,
    RETRY_BASE_MS,
    RETRY_MAX_MS_DEFAULT,
} from '../../utils/client';

describe('utils/client.compute_backoff', ()=>{
    it('grows exponentially with attempt', ()=>{
        // min over many samples so jitter doesn't flake the assertion.
        const sample_min = (attempt: number)=>{
            let m = Infinity;
            for (let i = 0; i < 50; i++)
            {
                const d = compute_backoff(attempt, 1000, 1_000_000);
                if (d < m) m = d;
            }
            return m;
        };
        expect(sample_min(0)).toBeGreaterThanOrEqual(500);
        expect(sample_min(1)).toBeGreaterThanOrEqual(1000);
        expect(sample_min(2)).toBeGreaterThanOrEqual(2000);
    });

    it('honors the max_ms ceiling', ()=>{
        for (let i = 0; i < 50; i++)
            expect(compute_backoff(20, 1000, 5000)).toBeLessThanOrEqual(5000);
    });

    it('uses full-jitter (delay falls in [exp/2, exp])', ()=>{
        // base 1000, attempt 0 -> exp 1000, so range is [500, 1000].
        const samples: number[] = [];
        for (let i = 0; i < 200; i++)
            samples.push(compute_backoff(0, 1000, 1_000_000));
        expect(Math.min(...samples)).toBeGreaterThanOrEqual(500);
        expect(Math.max(...samples)).toBeLessThanOrEqual(1000);
        const below_mid = samples.filter(d=>d < 750).length;
        const above_mid = samples.filter(d=>d >= 750).length;
        expect(below_mid).toBeGreaterThan(20);
        expect(above_mid).toBeGreaterThan(20);
    });

    it('exported defaults match the documented short schedule', ()=>{
        expect(RETRY_BASE_MS).toBe(500);
        expect(RETRY_MAX_MS_DEFAULT).toBe(16_000);
    });
});
