// Floor = genuine dependency minimum (driven by deps' own `engines`, e.g.
// commander), NOT the require(ESM) boundary. The dynamic-import loader in
// utils/load-prompts.ts removes the ERR_REQUIRE_ESM crash at its source, so the
// CLI runs on Node 20 again; this guard only catches runtimes below that floor.
const MIN_NODE_MAJOR = 20;

const parse_major = (version: string): number=>{
    const major = Number(version.split('.')[0]);
    return Number.isFinite(major) ? major : 0;
};

const is_supported_node = (version = process.versions.node): boolean=>
    parse_major(version) >= MIN_NODE_MAJOR;

const unsupported_message = (version = process.versions.node): string=>
    `✗ Unsupported Node.js version: you are running Node v${version}.\n`
    +`  @brightdata/cli requires Node ${MIN_NODE_MAJOR} or newer.\n`
    +`  Please update Node and try again: https://nodejs.org\n`;

const assert_supported_node = (
    version = process.versions.node,
    write: (s: string)=>void = s=>{ process.stderr.write(s); },
    exit: (code: number)=>never = code=>process.exit(code),
): void=>{
    if (is_supported_node(version))
        return;
    write(unsupported_message(version));
    exit(1);
};

export {
    MIN_NODE_MAJOR,
    parse_major,
    is_supported_node,
    unsupported_message,
    assert_supported_node,
};
