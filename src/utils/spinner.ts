import {is_tty} from './output';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

type Spinner = {
    stop: (final_msg?: string)=>void;
};

const start = (msg: string): Spinner=>{
    if (!is_tty)
    {
        process.stderr.write(msg+'\n');
        return {stop: ()=>{}};
    }
    let frame = 0;
    const timer = setInterval(()=>{
        process.stderr.write(`\r\x1b[36m${FRAMES[frame % FRAMES.length]}`+
            `\x1b[0m ${msg}`);
        frame++;
    }, INTERVAL_MS);
    const stop = (final_msg?: string)=>{
        clearInterval(timer);
        process.stderr.write('\r\x1b[2K');
        if (final_msg)
            process.stderr.write(final_msg+'\n');
    };
    return {stop};
};

export {start};
export type {Spinner};
