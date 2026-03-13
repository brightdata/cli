import {Command} from 'commander'
import {ensure_authenticated} from '../utils/auth'
import {get} from '../utils/client'
import {start as start_spinner} from '../utils/spinner'
import {dim, green, print, print_table, yellow} from '../utils/output'

type Budget_opts = {
    from?: string;
    to?: string;
    json?: boolean;
    pretty?: boolean;
    timing?: boolean;
    apiKey?: string;
}

type Balance_response = {
    balance?: number;
    pending_balance?: number;
}

type Zone_summary = {
    name?: string;
}

type Zone_cost_totals = {
    bw: number;
    cost: number;
}

type Zone_cost_row = {
    zone: string;
    cost: number;
    bw: number;
}

type Zone_plan = {
    product?: string;
    type?: string;
    bandwidth?: string;
}

type Zone_info_response = {
    plan?: Zone_plan;
}

const add_common_options = (cmd: Command): Command=>{
    cmd.option('--json', 'Force JSON output')
    cmd.option('--pretty', 'Pretty-print JSON output')
    cmd.option('--timing', 'Show request timing')
    cmd.option('-k, --api-key <key>', 'Override API key')
    return cmd
}

const format_usd = (value: number)=>{
    return `$${value.toFixed(2)}`
}

const format_bytes = (n: number): string=>{
    if (n < 1024)
        return `${Math.round(n)} B`
    if (n < 1024**2)
        return `${(n/1024).toFixed(1)} KB`
    if (n < 1024**3)
        return `${(n/1024**2).toFixed(1)} MB`
    return `${(n/1024**3).toFixed(1)} GB`
}

const sum_zone_cost = (response: unknown): Zone_cost_totals=>{
    if (!response || typeof response != 'object')
        return {bw: 0, cost: 0}

    let bw = 0
    let cost = 0

    for (const period of Object.values(response as Record<string, unknown>))
    {
        if (!period || typeof period != 'object')
            continue

        for (const item of Object.values(period as Record<string, unknown>))
        {
            if (!item || typeof item != 'object')
                continue

            const item_bw = 'bw' in item
                && typeof item.bw == 'number'
                && Number.isFinite(item.bw)
                ? item.bw
                : 0
            const item_cost = 'cost' in item
                && typeof item.cost == 'number'
                && Number.isFinite(item.cost)
                ? item.cost
                : 0

            bw += item_bw
            cost += item_cost
        }
    }

    return {bw, cost}
}

const print_detail_rows = (rows: Array<[string, string]>)=>{
    if (!rows.length)
        return

    const label_width = Math.max(...rows.map(([label])=>label.length))
    for (const [label, value] of rows)
    {
        process.stdout.write(
            `${dim(label.padEnd(label_width))}  ${value}\n`
        )
    }
}

const build_zone_cost_endpoint = (zone: string, opts: Budget_opts)=>{
    const params = new URLSearchParams({zone})
    if (opts.from)
        params.set('from', opts.from)
    if (opts.to)
        params.set('to', opts.to)
    return `/zone/cost?${params.toString()}`
}

const print_balance_summary = (balance: Balance_response)=>{
    const balance_value = typeof balance.balance == 'number' ? balance.balance : 0
    const pending_value = typeof balance.pending_balance == 'number'
        ? balance.pending_balance
        : 0
    const labels = ['Balance', 'Pending charge']
    const label_width = Math.max(...labels.map(label=>label.length))
    const balance_text = format_usd(balance_value)
    const colored_balance = balance_value > 0
        ? green(balance_text)
        : yellow(balance_text)

    process.stdout.write(
        `${dim('Balance'.padEnd(label_width))}  ${colored_balance}\n`
    )
    process.stdout.write(
        `${dim('Pending charge'.padEnd(label_width))}  `
        +`${format_usd(pending_value)}\n`
    )
}

const handle_budget_balance = async(opts: Budget_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey)
    const spinner = start_spinner('Fetching account balance...')

    try {
        const balance = await get<Balance_response>(
            api_key,
            '/customer/balance',
            {timing: opts.timing}
        )
        spinner.stop()

        if (opts.json || opts.pretty)
        {
            print(balance, {json: opts.json, pretty: opts.pretty})
            return
        }

        print_balance_summary(balance)
    } catch(e) {
        spinner.stop()
        console.error((e as Error).message)
        process.exit(1)
    }
}

const handle_budget_zones = async(opts: Budget_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey)
    const spinner = start_spinner('Fetching zone costs...')

    try {
        const zones = await get<Zone_summary[]>(
            api_key,
            '/zone/get_active_zones',
            {timing: opts.timing}
        )
        const zone_names = zones
            .map(zone=>zone.name)
            .filter((name): name is string=>!!name)

        if (!zone_names.length)
        {
            spinner.stop()

            if (opts.json || opts.pretty)
            {
                print([], {json: opts.json, pretty: opts.pretty})
                return
            }

            console.log(dim('No active zones found.'))
            return
        }

        const rows = await Promise.all(zone_names.map(async zone=>{
            const totals = sum_zone_cost(await get<unknown>(
                api_key,
                build_zone_cost_endpoint(zone, opts),
                {timing: opts.timing}
            ))

            return {
                zone,
                cost: totals.cost,
                bw: totals.bw,
            } satisfies Zone_cost_row
        }))

        spinner.stop()

        if (opts.json || opts.pretty)
        {
            print(rows, {json: opts.json, pretty: opts.pretty})
            return
        }

        const total_cost = rows.reduce((sum, row)=>sum + row.cost, 0)
        const total_bw = rows.reduce((sum, row)=>sum + row.bw, 0)
        const table_rows = rows.map(row=>({
            zone: row.zone,
            'cost ($)': format_usd(row.cost),
            bandwidth: format_bytes(row.bw),
        }))

        table_rows.push({
            zone: 'TOTAL',
            'cost ($)': format_usd(total_cost),
            bandwidth: format_bytes(total_bw),
        })

        print_table(table_rows, ['zone', 'cost ($)', 'bandwidth'])
    } catch(e) {
        spinner.stop()
        console.error((e as Error).message)
        process.exit(1)
    }
}

const handle_budget_zone = async(name: string, opts: Budget_opts)=>{
    const api_key = ensure_authenticated(opts.apiKey)
    const spinner = start_spinner(`Fetching cost details for "${name}"...`)

    try {
        const [info, raw_cost] = await Promise.all([
            get<Zone_info_response>(
                api_key,
                `/zone?zone=${encodeURIComponent(name)}`,
                {timing: opts.timing}
            ),
            get<unknown>(
                api_key,
                build_zone_cost_endpoint(name, opts),
                {timing: opts.timing}
            ),
        ])
        const totals = sum_zone_cost(raw_cost)

        spinner.stop()

        if (opts.json || opts.pretty)
        {
            print(
                {
                    zone: name,
                    info,
                    cost: raw_cost,
                    totals,
                },
                {json: opts.json, pretty: opts.pretty}
            )
            return
        }

        const type_parts = [info.plan?.product, info.plan?.type]
            .filter((value): value is string=>!!value)
        const zone_type = type_parts.length
            ? type_parts.join(' / ')
            : dim('unknown')
        const plan_bandwidth = info.plan?.bandwidth ?? dim('unknown')

        print_detail_rows([
            ['Zone:', name],
            ['Type:', zone_type],
            ['Plan bandwidth:', plan_bandwidth],
        ])
        process.stdout.write('\n')

        print_detail_rows([
            ['Cost (this month):', format_usd(totals.cost)],
            ['Bandwidth used:', format_bytes(totals.bw)],
        ])
    } catch(e) {
        spinner.stop()
        console.error((e as Error).message)
        process.exit(1)
    }
}

const budget_command = add_common_options(
    new Command('budget')
        .description('View account balance and zone spending')
        .action(handle_budget_balance)
)

budget_command.addCommand(
    add_common_options(
        new Command('balance')
            .description('Show account balance')
            .action(handle_budget_balance)
    )
)

budget_command.addCommand(
    add_common_options(
        new Command('zones')
            .description('Show cost and bandwidth for all active zones')
            .option('--from <date>', 'Start date for cost lookup')
            .option('--to <date>', 'End date for cost lookup')
            .action(handle_budget_zones)
    )
)

budget_command.addCommand(
    add_common_options(
        new Command('zone')
            .description('Show cost and bandwidth for a single zone')
            .argument('<name>', 'Zone name')
            .option('--from <date>', 'Start date for cost lookup')
            .option('--to <date>', 'End date for cost lookup')
            .action(handle_budget_zone)
    )
)

export {
    budget_command,
    handle_budget_balance,
    handle_budget_zones,
    handle_budget_zone,
}
