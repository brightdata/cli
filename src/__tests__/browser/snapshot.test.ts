import {describe, expect, it} from 'vitest';
import {
    DOM_REF_ATTRIBUTE,
    capture_snapshot,
    format_snapshot_text,
} from '../../browser/snapshot';
import type {Page} from 'playwright-core';
import type {Snapshot_node} from '../../browser/snapshot';

class Mock_snapshot_page {
    readonly args: Array<{attr_name: string; selector?: string}> = [];
    private readonly payload_factory: (arg: {attr_name: string; selector?: string})=>unknown;
    private readonly title_value: string;
    private readonly url_value: string;

    constructor(
        payload_factory: (arg: {attr_name: string; selector?: string})=>unknown,
        title_value = 'Example Domain',
        url_value = 'https://example.com',
    ){
        this.payload_factory = payload_factory;
        this.title_value = title_value;
        this.url_value = url_value;
    }

    async evaluate(_fn: unknown, arg: {attr_name: string; selector?: string}){
        this.args.push(arg);
        return this.payload_factory(arg);
    }

    async title(){
        return this.title_value;
    }

    url(){
        return this.url_value;
    }
}

const create_snapshot_payload = ()=>({
    nodes: [
        {
            children: [],
            level: 1,
            name: 'Welcome',
            role: 'heading',
        },
        {
            children: [
                {
                    children: [],
                    interactive: true,
                    name: 'Pricing',
                    ref: 'e1',
                    role: 'link',
                },
            ],
            role: 'navigation',
        },
        {
            children: [
                {
                    children: [],
                    interactive: true,
                    name: 'Buy',
                    ref: 'e2',
                    role: 'button',
                },
                {
                    children: [
                        {
                            children: [],
                            interactive: true,
                            name: 'Nested Link',
                            ref: 'e3',
                            role: 'link',
                        },
                    ],
                    role: 'group',
                },
            ],
            role: 'main',
        },
        {
            children: [],
            interactive: true,
            placeholder: 'Search...',
            ref: 'e4',
            role: 'textbox',
        },
    ],
    refs: [
        {ref: 'e1', selector: `[${DOM_REF_ATTRIBUTE}="e1"]`},
        {ref: 'e2', selector: `[${DOM_REF_ATTRIBUTE}="e2"]`},
        {ref: 'e3', selector: `[${DOM_REF_ATTRIBUTE}="e3"]`},
        {ref: 'e4', selector: `[${DOM_REF_ATTRIBUTE}="e4"]`},
    ],
});

describe('browser/snapshot', ()=>{
    it('formats snapshot trees with refs and attributes', ()=>{
        const nodes: Snapshot_node[] = [
            {
                children: [
                    {
                        children: [],
                        name: 'Pricing',
                        ref: 'e1',
                        role: 'link',
                    },
                ],
                role: 'main',
            },
            {
                children: [],
                level: 1,
                name: 'Welcome',
                role: 'heading',
            },
            {
                children: [],
                placeholder: 'Search...',
                ref: 'e2',
                role: 'textbox',
            },
        ];

        expect(format_snapshot_text({
            nodes,
            title: 'Example Domain',
            url: 'https://example.com',
        })).toBe([
            'Page: Example Domain',
            'URL: https://example.com',
            '',
            '- main',
            '  - link "Pricing" [ref=e1]',
            '- heading "Welcome" [level=1]',
            '- textbox [ref=e2, placeholder="Search..."]',
        ].join('\n'));
    });

    it('applies compact and depth filters and prunes hidden refs', async()=>{
        const page = new Mock_snapshot_page(()=>create_snapshot_payload());

        const snapshot = await capture_snapshot(page as unknown as Page, {
            compact: true,
            depth: 1,
        });

        expect(page.args).toEqual([{attr_name: DOM_REF_ATTRIBUTE, selector: undefined}]);
        expect(snapshot.refs).toEqual([
            {ref: 'e1', selector: `[${DOM_REF_ATTRIBUTE}="e1"]`},
            {ref: 'e2', selector: `[${DOM_REF_ATTRIBUTE}="e2"]`},
            {ref: 'e4', selector: `[${DOM_REF_ATTRIBUTE}="e4"]`},
        ]);
        expect(snapshot.depth).toBe(1);
        expect(snapshot.snapshot).toBe([
            'Page: Example Domain',
            'URL: https://example.com',
            '',
            '- navigation',
            '  - link "Pricing" [ref=e1]',
            '- main',
            '  - button "Buy" [ref=e2]',
            '- textbox [ref=e4, placeholder="Search..."]',
        ].join('\n'));
    });

    it('renders interactive snapshots as a flat list and forwards selector scope', async()=>{
        const page = new Mock_snapshot_page(arg=>{
            expect(arg.selector).toBe('#checkout');
            return create_snapshot_payload();
        });

        const snapshot = await capture_snapshot(page as unknown as Page, {
            interactive: true,
            selector: '#checkout',
        });

        expect(page.args).toEqual([
            {attr_name: DOM_REF_ATTRIBUTE, selector: '#checkout'},
        ]);
        expect(snapshot.interactive).toBe(true);
        expect(snapshot.selector).toBe('#checkout');
        expect(snapshot.refs).toEqual([
            {ref: 'e1', selector: `[${DOM_REF_ATTRIBUTE}="e1"]`},
            {ref: 'e2', selector: `[${DOM_REF_ATTRIBUTE}="e2"]`},
            {ref: 'e3', selector: `[${DOM_REF_ATTRIBUTE}="e3"]`},
            {ref: 'e4', selector: `[${DOM_REF_ATTRIBUTE}="e4"]`},
        ]);
        expect(snapshot.snapshot).toBe([
            'Page: Example Domain',
            'URL: https://example.com',
            '',
            '- link "Pricing" [ref=e1]',
            '- button "Buy" [ref=e2]',
            '- link "Nested Link" [ref=e3]',
            '- textbox [ref=e4, placeholder="Search..."]',
        ].join('\n'));
    });

    it('renders an interactive empty-state when no visible interactive nodes are captured', async()=>{
        const page = new Mock_snapshot_page(()=>({
            nodes: [
                {
                    children: [],
                    name: 'Welcome',
                    role: 'heading',
                },
            ],
            refs: [],
        }), 'Blank', 'about:blank');

        const snapshot = await capture_snapshot(page as unknown as Page, {
            interactive: true,
        });

        expect(snapshot.snapshot).toBe([
            'Page: Blank',
            'URL: about:blank',
            '',
            '(no interactive elements)',
        ].join('\n'));
    });
});
