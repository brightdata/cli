import {describe, it, expect} from 'vitest';
import {pick_hint, ERROR_HINTS, type Body_hint} from '../../utils/client';

// pick_hint is the layer the per-command hint lists plug into.
// The client itself ships ZERO command-specific patterns — every test
// here uses generic mock patterns so the contract is clear.

const MOCK_HINTS: Body_hint[] = [
    {pattern: /quota.*exceeded/i,
        hint: 'Your monthly quota is exhausted. Top up in the dashboard.'},
    {pattern: /not allowed in region/i,
        hint: 'This API is geo-restricted. Use --country to override.'},
];

describe('utils/client.pick_hint', ()=>{
    it('returns the status-based hint when no extra hints are passed', ()=>{
        expect(pick_hint(401, 'anything')).toBe(ERROR_HINTS[401]);
        expect(pick_hint(403, 'anything')).toBe(ERROR_HINTS[403]);
        expect(pick_hint(404, 'anything')).toBe(ERROR_HINTS[404]);
        expect(pick_hint(429, 'anything')).toBe(ERROR_HINTS[429]);
    });

    it('returns the status-based hint when extra hints are passed '
        +'but nothing matches the body', ()=>{
        expect(pick_hint(403, 'plain unauthorized message', MOCK_HINTS))
            .toBe(ERROR_HINTS[403]);
    });

    it('overrides with the first matching extra hint', ()=>{
        expect(pick_hint(429, 'monthly quota exceeded', MOCK_HINTS))
            .toMatch(/Top up in the dashboard/);
        expect(pick_hint(403, 'not allowed in region: CN', MOCK_HINTS))
            .toMatch(/geo-restricted/);
    });

    it('is case-insensitive on the caller\'s pattern', ()=>{
        expect(pick_hint(429, 'MONTHLY QUOTA EXCEEDED', MOCK_HINTS))
            .toMatch(/Top up in the dashboard/);
    });

    it('respects first-match-wins order in the caller\'s list', ()=>{
        const ordered: Body_hint[] = [
            {pattern: /generic/, hint: 'first wins'},
            {pattern: /generic/, hint: 'second loses'},
        ];
        expect(pick_hint(500, 'generic error', ordered))
            .toBe('first wins');
    });

    it('returns undefined for unknown statuses with no body match', ()=>{
        expect(pick_hint(418, 'teapot')).toBeUndefined();
        expect(pick_hint(599, 'mystery')).toBeUndefined();
    });

    it('does not consult ERROR_HINTS when an extra-hint pattern '
        +'matches', ()=>{
        // The override should win even when the generic status hint
        // would also be applicable.
        const matches_403: Body_hint[] = [
            {pattern: /custom 403 case/i,
                hint: 'override hint, not the zone-permissions one'},
        ];
        expect(pick_hint(403, 'this is a custom 403 case', matches_403))
            .toBe('override hint, not the zone-permissions one');
    });

    it('does not leak any scraper-studio vocabulary in the default '
        +'hints', ()=>{
        // The shared client must stay generic. Catches accidental
        // regressions where someone adds a domain-specific hint here.
        for (const hint of Object.values(ERROR_HINTS))
        {
            expect(hint).not.toMatch(/scraper create/i);
            expect(hint).not.toMatch(/collector/i);
            expect(hint).not.toMatch(/AI[- ]Flow/i);
            expect(hint).not.toMatch(/automate_template/i);
        }
    });
});
