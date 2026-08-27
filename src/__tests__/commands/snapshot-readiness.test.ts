import {describe, it, expect} from 'vitest';
import {snapshot_running_status} from '../../commands/dataset';
import type {Response_envelope} from '../../utils/client';

// The snapshot endpoint answers in two dimensions that vary independently:
// the HTTP status (200 data vs 202 still-building) and the body shape (a
// parsed object under --format json, raw text under csv/ndjson/jsonl). Every
// combination has to resolve correctly, because the failure that matters is
// silent: a not-ready response mistaken for data prints a status stub and
// exits 0, which downstream ETL then consumes as if it were the dataset.
const envelope = (status: number, body: unknown): Response_envelope=>({
    status,
    headers: new Headers(),
    body,
});

describe('commands/dataset.snapshot_running_status', ()=>{
    it('200 + object data is ready', ()=>{
        expect(snapshot_running_status(envelope(200, [{a: 1}])))
            .toBeUndefined();
    });

    it('200 + text data is ready (csv/jsonl formats)', ()=>{
        expect(snapshot_running_status(envelope(200, 'a,b\n1,2\n')))
            .toBeUndefined();
    });

    it('200 + object status body is still running', ()=>{
        expect(snapshot_running_status(envelope(200, {status: 'running'})))
            .toBe('running');
    });

    it('200 + TEXT status body is still running', ()=>{
        // The regression this predicate exists for: under a non-json format
        // the client hands back a string, so an object-only check misses it
        // and the status stub gets printed as data.
        expect(snapshot_running_status(
            envelope(200, '{"status":"running"}'))).toBe('running');
    });

    it('202 is still running even when the body looks like data', ()=>{
        // The protocol is the most authoritative signal available.
        expect(snapshot_running_status(envelope(202, [{a: 1}])))
            .toBe('building');
    });

    it('202 + text status body reports the real status', ()=>{
        expect(snapshot_running_status(
            envelope(202, '{"status":"starting"}'))).toBe('starting');
    });

    it('keeps the real status string rather than a flattened literal', ()=>{
        // Progress output prints this value, so collapsing every running
        // state to one token would lose starting -> building -> running.
        for (const s of ['starting', 'building', 'running'])
        {
            expect(snapshot_running_status(envelope(200, {status: s})))
                .toBe(s);
        }
    });

    it('treats terminal statuses as ready, not running', ()=>{
        expect(snapshot_running_status(envelope(200, {status: 'ready'})))
            .toBeUndefined();
        expect(snapshot_running_status(envelope(200, {status: 'failed'})))
            .toBeUndefined();
    });

    it('treats unparseable text as data', ()=>{
        expect(snapshot_running_status(envelope(200, 'not json at all')))
            .toBeUndefined();
    });
});
