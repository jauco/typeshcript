/// <reference types="node" />

// Some examples:

/**
 * this is a script that runs a docker container. It's a really simple bash script. But in bash the docker invocation becomes quite unwieldy
 */
async function downloadMail() {
    const run = inScriptDir()
    await run("docker", "run", "--rm", "-it", 
        "-v", run.pwd("/configs") + ":/Configs", 
        "-v", run.pwd("/runscripts.sh") + ":/runscripts.sh",  
        "-v", run.pwd("/Mail") + ":/Mail",
        `-e PW=${await run("security", "find-generic-password", "-w", "-l", "webmail.knaw.nl")}`,
        "--entrypoint=/runscript.sh",
        "resnellius/offlineimap"
    )
    await run("git", "add", "-A")
    await run("git", "commit", "-m", "sync")

    await run("git", "add", "-A")

    run.cd("/Users/jauco/Documents/zorg-mode")
    await run("node", "./src/lib/fetchmail.js", "/Users/jauco/Documents/zorg-mode-data/datastore.json")
}

/**
 * This script creates a config file based on separate json files
 * interestingly, jq was not easily replaced by JS invocations
 */
async function createRelyingParties() {
    const {find, jq, mv, rm, ls, echo} = inScriptDir().makeCommand("find", "jq", "rm", "mv", "ls", "echo")

    await pipe(echo("{}"), toFile("/registered-relying-parties.json"))
    
    // No longer needed
    // if ((await find("./registered-relying-parties/", "-name", "* *")).length > 0) {
    //     console.log("Some files contained spaces. This is not allowed")
    //     process.exit(1)
    // }
    
    for await (const file of ls("./registered-relying-parties/*.json").splitBy("\n")) {
        console.log("Converting " + file)
        const {name: id} = path.parse(file)
        await pipe(
            jq(
                "--arg", "client_id", id, 
                '. | .[$client_id]= . | .[$client_id].client_id=$client_id | .[$client_id].application_type="web" | .[$client_id].subject_type="public" | .[$client_id].response_types=["code"] | .[$client_id].client_secret_expires_at=0 | .[$client_id].client_id_issued_at=0 | del(.redirect_uris, .client_secret, .client_name)', 
                file
            ), 
            toFile("temp.json")
        )

        await pipe(jq("-s", ".[0] * .[1]", "./registered-relying-parties.json", "./temp.json"), toFile("./merged.json"))
        await rm("./temp.json")
        await mv("./merged.json", "./registered-relying-parties.json")
    }
}

/**
 * This is a docker launch script. It shows that sometimes you want "exec" which node doesn't really have
 */
async function startSatosa() {
    const run = inCwd()
    const {test, cp} = run.makeCommand("test", 'cp')
    function t(...args: string[]): Promise<boolean> {
        return test(...args).success
    }
    let {PROXY_PORT} = process.env;
    const CONFIG_DIR="/opt/satosa/etc"
    // if (await t("-z", PROXY_PORT)) {
    //     PROXY_PORT = "8000"
    // }

    run.cd(CONFIG_DIR);

    if (await t("!", "-d", `${CONFIG_DIR}/attributemaps`)) {
        cp("-pr", "/opt/satosa/attributemaps", `${CONFIG_DIR}/attributemaps`)
    }
    run("./frontends/oidc/create-replying-parties.sh")

    // Activate virtualenv
    await run.source("/opt/satosa/bin/activate")
    // start the proxy
    await run.execLike("gunicorn", `-b0.0.0.0:${PROXY_PORT || 8000}`, "satosa.wsgi:app")
}

/**
 * This one really makes use of pipes
 */
async function fd() {
    const run = inCwd()
    do {
        const input = process.argv[2] !== undefined ? process.argv[2] : await read("Search query: ")
        const options = await pipe(
            run("notmuch", "address", "--deduplicate=address", "--output=recipients", "--output=sender", "--output=count", `to:*${input}* OR from:*${input}*`),
            run("grep", "-i", input),
            run("sort", "-rn"),
        ).fullOutput({stripNewLines: false})
        
        const option = await read("Please choose an option: ", options.split("\n"));
        await pipe(run("echo", option), run("xsel", "-ib"))
        console.log(option)
    } while (process.argv[2] === undefined)
}

/**
 * this one prompts for input
 */
async function setScreen() {
    const run = inCwd()
    let HDMI: string | undefined = undefined

    const args = 
        yargs
            .completion()
            .option("location", {
                choices: ["werkhok", "bureau", "knaw", "presentatie"] as const
            })
            .argv

    if (args.location === "werkhok" || args.location === "knaw") {
        HDMI = "left"
    } else if (args.location === "bureau") {
        HDMI = "above"
    }
    await run("xrandr",
        "--output", "HDMI-1", ...(HDMI === undefined ? ["--off"] : ["--mode", "1920x1080", "--rate", "60", "--pos", "0x0"]),
        "--output", "eDP-1", "--mode", "2560x1440", "--rate", "60", "--pos", (HDMI === "above" ? "0x1080" : "1920x0"), "--scale", "0.65x0.65", "--primary", 
        "--output", "DP-1", "--off", 
        "--output", "DP-2", "--off"
    )

    await run('xinput', 'map-to-output', 'Wacom Pen and multitouch sensor Finger', 'eDP-1')
    await run('xinput', 'map-to-output', "Wacom Pen and multitouch sensor Pen Pen (0xaf8c107d)", 'eDP-1')
}

/**
 * A port of a more complex script (mgitstatus)
 */

async function mgitstatus() {
    const VERSION="2.0"
    const DEBUG=0
    function debug(varName: string, value: any) {
        if (DEBUG) {
            console.debug(varName + ": ", value)
        }
    }


    const run = inCwd();

    async function test(...args: string[]) {
        return await run("test", ...args).success
    }
    const toggleOptions = {
        boolean: true,
        group: "You can limit output with the following options:",
    };
    
    const args = 
        yargs
            .version(VERSION)
            .completion()
            .usage("mgitstatus shows uncommited, untracked and unpushed changes in multiple Git repositories.")
            .option("fetch", {
                description: "Do a 'git fetch' on each repo (slow for many repos)",
                alias: ["f"]
            })
            .option("color", {
                description: "Force color output (preserve colors when using pipes)",
            })
            .option("depth", {
                type: "number",
                default: 2,
                description: "How many subdirectories to recurse into. 0 means infinitely deep."
            })
            .options("no-push", toggleOptions)
            .options("no-pull", toggleOptions)
            .options("no-upstream", toggleOptions)
            .options("no-uncommitted", toggleOptions)
            .options("no-untracked", toggleOptions)
            .options("no-stashes", toggleOptions)
            .argv

    const C_OK=chalkPipe("green")
    const C_NOT_GIT=chalkPipe("red")
    const C_LOCKED=chalkPipe("red")
    const C_NEEDS_PUSH=chalkPipe("yellow")
    const C_NEEDS_PULL=chalkPipe("blue")
    const C_NEEDS_COMMIT=chalkPipe("red")
    const C_NEEDS_UPSTREAM=chalkPipe("purple")
    const C_UNTRACKED=chalkPipe("cyan")
    const C_STASHES=chalkPipe("yellow")

    // Go through positional arguments (DIRs) or '.' if no argumnets are given
    const dirs = args._.length > 0 ? args._ : ["."];
    for (const DIR in dirs) {
        for await (const PROJ_DIR of pipe(run("find", "-L", DIR, "-maxdepth", "1", "-mindepth", "1", "-type", "d"), run("sort")).splitBy("\n")) {
            const GIT_DIR=`${PROJ_DIR}/.git`
            const GIT_CONF=`${GIT_DIR}/config`
            const gitAtDir = run.bindCommand("git", "--work-tree", PROJ_DIR, "--git-dir", GIT_DIR)

            console.log(PROJ_DIR + ": ")
            if (await test("!", "-d", GIT_DIR)) {
                C_NOT_GIT("not a git repo")
                continue
            }

            if (await test("-f", GIT_DIR + "/index.lock")) {
                C_LOCKED("Locked. Skipping.")
                continue
            }

            if (args.fetch) {
                await gitAtDir("fetch", "-q")
            }
            // Refresh the index, or we might get wrong results.
            await gitAtDir("update-index", "-q", "--refresh")

            // Find all remote branches that have been checked out and figure out if
            // they need a push or pull. We do this with various tests and put the name
            // of the branches in NEEDS_XXXX, seperated by newlines. After we're done,
            // we remove duplicates from NEEDS_XXX.
            const NEEDS_PUSH_BRANCHES: {[key:string]: boolean} = {}
            const NEEDS_PULL_BRANCHES: {[key:string]: boolean} = {}
            const NEEDS_UPSTREAM_BRANCHES: {[key:string]: boolean} = {}

            for (const REF_HEAD in pipe(gitAtDir("for-each-ref", "--format='%(refname)", "refs/heads"), run("sed", 's|refs/heads/||'))) {
                // Check if this branch is tracking an upstream (local/remote branch)
                const [exitCode, UPSTREAM] = await gitAtDir("rev-parse", "--abbrev-ref", "--symbolic-full-name", `${REF_HEAD}@{u}`).result()
                if (exitCode === 0) {
                    // Branch is tracking a remote branch. Find out how much behind /
                    // ahead it is of that remote branch.
                    const CNT_AHEAD_BEHIND=gitAtDir("rev-list", "--left-right", "--count", `${REF_HEAD}...${UPSTREAM}`)
                    const [CNT_AHEAD, CNT_BEHIND] = (await CNT_AHEAD_BEHIND.fullOutput()).split(" ")

                    debug("CNT_AHEAD_BEHIND", CNT_AHEAD_BEHIND)
                    debug("CNT_AHEAD", CNT_AHEAD)
                    debug("CNT_BEHIND", CNT_BEHIND)

                    if (+CNT_AHEAD > 0) {
                        NEEDS_PUSH_BRANCHES[REF_HEAD] = true
                    }
                    if (+CNT_BEHIND > 0) {
                        NEEDS_PULL_BRANCHES[REF_HEAD] = true
                    }

                    // Check if this branch is a branch off another branch. and if it needs
                    // to be updated.
                    const REV_LOCAL=await gitAtDir("rev-parse", "--verify", REF_HEAD).fullOutput()
                    const REV_REMOTE=await gitAtDir("rev-parse", "--verify", UPSTREAM).fullOutput()
                    const REV_BASE=await gitAtDir("merge-base", REF_HEAD, UPSTREAM).fullOutput()

                    debug("REV_LOCAL", REV_LOCAL);
                    debug("REV_REMOTE", REV_REMOTE);
                    debug("REV_BASE", REV_BASE);

                    if (REV_LOCAL == REV_REMOTE) {

                    } else {
                        if (REV_LOCAL == REV_BASE) {
                            NEEDS_PULL_BRANCHES[REF_HEAD] = true
                        }
                        if (REV_REMOTE == REV_BASE) {
                            NEEDS_PUSH_BRANCHES[REF_HEAD] = true
                        }
                    }
                    
                } else {
                       // Branch does not have an upstream (local/remote branch).
                    NEEDS_UPSTREAM_BRANCHES[REF_HEAD] = true
                }
            }

            // Remove duplicates from NEEDS_XXXX and make comma-seperated
            const NEEDS_PUSH_BRANCHES_LOG=Object.keys(NEEDS_PUSH_BRANCHES).sort().join(", ")
            const NEEDS_PULL_BRANCHES_LOG=Object.keys(NEEDS_PULL_BRANCHES).sort().join(", ")
            const NEEDS_UPSTREAM_BRANCHES_LOG=Object.keys(NEEDS_UPSTREAM_BRANCHES).sort().join(", ")

            // Find out if there are unstaged, uncommitted or untracked changes
            async function ALLSTAGED() {
                return gitAtDir("diff-index", "--quiet", "HEAD", "--").success
            }
            async function ALLCOMMITTED() {
                return gitAtDir("diff-files", "--quiet", "--ignore-submodules", "--").success
            }
            async function HAS_UNTRACKED() {
                return (await gitAtDir("ls-files", "--exclude-standard", "--others").fullOutput()) !== ""
            }
            async function HAS_STASHES() {
                return (await pipe(gitAtDir("stash", "list"), run("wc", "-l")).fullOutput())  !== "0"
            }

               // Build up the status string
            let HAS_WARNING=0
            if (args["no-push"] || NEEDS_PUSH_BRANCHES_LOG !== "") {
                C_NEEDS_PUSH(`Needs push (${NEEDS_PUSH_BRANCHES})`)
                HAS_WARNING=1
            }
            if (args["no-pull"] || NEEDS_PULL_BRANCHES_LOG !== "") {
                C_NEEDS_PULL(`Needs pull (${NEEDS_PULL_BRANCHES_LOG})`)
                HAS_WARNING=1
            }
            if (args["no-upstream"] || NEEDS_UPSTREAM_BRANCHES_LOG !== "") {
                C_NEEDS_UPSTREAM(`Needs upstream (${NEEDS_UPSTREAM_BRANCHES_LOG})`)
                HAS_WARNING=1
            }
            if (args["no-uncommitted"] || !(await ALLSTAGED) || !(await ALLCOMMITTED)) {
                C_NEEDS_COMMIT(`Uncommitted changes`)
                HAS_WARNING=1
            }
            if (args["no-untracked"] || await HAS_UNTRACKED()) {
                C_UNTRACKED(`Untracked files`)
                HAS_WARNING=1
            }
            if (args["no-stashes"] || HAS_STASHES() ) {
                C_STASHES(`${HAS_STASHES} stashes`)
                HAS_WARNING=1
            }
            if (HAS_WARNING == 0) {
                C_OK(`ok`)
            }
        }
    }
}

// Implementing code (might not work, this is really just a copy paste from the editor I had open)



import * as cp from "child_process";
import * as path from "path";
import { Writable, Readable, Stream, Transform } from "stream";
import * as fs from "fs";
import {quote} from "./shell-quote"
import prompt from "prompts"
import pump from "pump";
import concat from "concat-stream";
import yargs, { Options } from "yargs"
import chalk from "chalk"
import chalkPipe from "chalk-pipe"
import { debug } from "vscode";

interface BoundCommand {
    (...args: string[]): CmdExecution
}
let idSrc = 0
class MappedLazyPromise<T, U> implements Promise<U> {
    private id: number = idSrc++;
    constructor(private promise: Promise<T>, private map: (input: T) => U) {
    }

    then<TResult1 = U, TResult2 = never>(onfulfilled?: (value: U) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        const intermediate = this.promise.then(v => this.map(v))
        return intermediate.then.apply(intermediate, arguments);
    }
    catch<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<U | TResult> {
        const intermediate = this.promise.then(v => this.map(v))
        return intermediate.catch.apply(intermediate, arguments);
    }
    [Symbol.toStringTag]: string;
    finally(onfinally?: () => void): Promise<U> {
        const intermediate = this.promise.then(v => this.map(v))
        return intermediate.finally.apply(intermediate, arguments);
    }

}

class LazyPromise<T> implements Promise<T> {
    private id: number = idSrc++;
    private _promise: Promise<T>
    constructor(private resolver: (resolve: (input: T) => void, reject: (input: any) => void) => void) {
    }

    lazily<TResult>(map:  (input: T) => TResult): Promise<TResult> {
        return new MappedLazyPromise(this, map);
    }

    triggerRun(): Promise<T> {
        return this._promise = this._promise || new Promise(this.resolver)
    }

    then<TResult1 = T, TResult2 = never>(onfulfilled?: (value: T) => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        const promise = this.triggerRun();
        return promise.then.apply(promise, arguments);
    }
    catch<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<T | TResult> {
        const promise = this.triggerRun();
        return promise.catch.apply(promise, arguments);
    }
    [Symbol.toStringTag]: string;
    finally(onfinally?: () => void): Promise<T> {
        const promise = this.triggerRun();
        return promise.finally.apply(promise, arguments);
    }
    
}

interface Execution extends Promise<void> {
    tap(output: Writable): this

    fullOutput(opts?: {ignoreExit?: boolean, stripNewLines?: boolean }): Promise<string>

    stream(io: 0): Writable
    stream(io: 1): Readable
}

interface CmdExecution extends Execution {
    readonly exitStatus: Promise<number | null>
    readonly success: Promise<boolean>

    fullOutput(opts?: {ignoreExit?: boolean, io?: number; stripNewLines?: boolean }): Promise<string>
    result(opts?: {io?: number; stripNewLines?: boolean }): Promise<[number | null, string]>

    splitBy(sep: string, opts?: {ignoreExit?: boolean, io?: number}): AsyncIterable<string>

    stream(io: 0): Writable
    stream(io: number): Readable

    tap(output: Writable): this
    tap(io: number, output: Writable): this

}

interface PipeExecution extends Execution {
    readonly exitStatuses: Promise<Array<number | null>>
    readonly lastSuccess: Promise<boolean>
    readonly allSuccess: Promise<boolean>

    stream(io: 0): Writable
    stream(io: 1): Readable
    stream(io: number): Array<Readable | undefined>

    tap(output: Writable): this
    tap(io: number, output: (item: number) => Writable): this

    splitBy(sep: string, opts?: {ignoreExit?: boolean}): AsyncIterable<string>
}

type NonNestedPipeConsumer = 
    | CmdExecution
    | ((input: AsyncIterable<string>) => AsyncIterable<string>)
    | Writable

type PipeConsumer = 
    | [number, NonNestedPipeConsumer, ...PipeConsumer[]]
    | NonNestedPipeConsumer

function stripNewlines(input: string): string {
    return input.trim().replace(/\n/g, " ")
}
class IterableExecution {
    private reject: (error: any) => void
    private resolve: (input: string) => void
    private finished: Promise<string>
    private outputs: Writable[] = [];
    private isSpawned: boolean = false;

    success: Promise<boolean>;

    constructor(private transformer: ((input: AsyncIterable<string>) => AsyncIterable<string>)) {
        this.finished = new Promise((res, rej) => {
            this.reject = rej
            this.resolve = res
        })
        this.success = this.finished.then(s => true, () => false)
    }

    tap(output: Writable): this {
        this.outputs.push(output)
        return this;
    }

    fullOutput(opts: { ignoreExit?: boolean; stripNewLines?: boolean; } = {}): Promise<string> {
        if (opts.stripNewLines) {
            return this.finished.then(stripNewlines)
        } else {
            return this.finished
        }
    }

    connect(input: Readable): Readable {
        if (this.isSpawned) {
            throw new Error("This async iterable is already connected to an input stream")
        }
        this.isSpawned = true;
        const writable = concat(b => this.resolve(b as unknown as string))
        const readable = Stream.Readable.from(this.transformer(input))
        pump([readable, writable], e => {
            if (e) {
                this.reject({location: "iterableCmd", error: e})
            }
        })
        readable.on("error", this.reject)
        for (const item of this.outputs) {
            readable.pipe(item)
        }
        return readable
    }

}    

function isExecution(item: any): item is CmdExecution {
    return typeof item.fullOutput === "function"
}


function isWritable(item: any): item is Writable {
    return (item as Writable).writable === true;
}

function isReadable(item: any): item is Readable {
    return (item as Readable).readable === true;
}
 
class PipeExecutionImpl implements PipeExecution {
    private lastOutputConsumer: CmdExecution | IterableExecution
    private outputGeneratingConsumers: Array<Execution | IterableExecution> = []
    private resultPromises: Array<Promise<number | null>> = []

    exitStatuses: Promise<Array<number | null>>;
    lastSuccess: Promise<boolean>
    allSuccess: Promise<boolean>

    constructor(private consumers: [CmdExecution, ...PipeConsumer[]]) {
        const [start, ...tail] = consumers;
        this.procesPipeItems(start, tail);
        this.exitStatuses = Promise.all(this.resultPromises)
        this.lastSuccess = this.lastOutputConsumer.success
        this.allSuccess = this.exitStatuses.then(x => x.every(s => s === null || s === 0))
    }
    
    procesPipeItems(start: CmdExecution | Readable, items: PipeConsumer[]) {
        let cur = start;
        if (isReadable(start)) {
            //The tail must start with an iterableExec or cmdExec
        } else {
            this.lastOutputConsumer = start
            this.resultPromises.push(start.exitStatus)
        }
        for (const item of items) {
            if (Array.isArray(item)) {
                const [io, ...sub] = item
                if (io === 1) { //that's silly but maybe it's a configurable variable?
                    this.procesPipeItems(cur, sub)
                } if (io > 1 && isExecution(cur)) {
                    this.procesPipeItems(cur.stream(io), sub)
                } else {
                    throw new Error(`You can't read io ${io} from a stream or transformer function`);
                }
            } else {
                const curstream = isExecution(cur) ? cur.stream(1) : cur
                if (isExecution(item)) {
                    this.outputGeneratingConsumers.push(item)
                    curstream.pipe(item.stream(0))
                    cur = item
                    this.lastOutputConsumer = cur
                    this.resultPromises.push(cur.exitStatus)
                } else if (typeof item === "function") {
                    const wrapped = new IterableExecution(item)
                    this.outputGeneratingConsumers.push(wrapped)
                    cur = wrapped.connect(curstream)
                    this.lastOutputConsumer = wrapped
                    this.resultPromises.push(wrapped.success.then(x => null))
                } else if (isWritable(item)) {
                    this.resultPromises.push(new Promise((res, rej) => {
                        pump([curstream, item], error => {
                            if (error) {
                                rej(error)
                            } else {
                                res(null)
                            }
                        })
                    }))
                } else {
                    catchElseBlock(item)
                }
            }
        }
    }

    async *splitBy(sep: string, opts: {ignoreExit?: boolean} = {}): AsyncIterable<string> {
        if (isExecution(this.lastOutputConsumer)) {
            return this.lastOutputConsumer.splitBy(sep, {io: 1, ...opts})
        } else {
            return this.lastOutputConsumer.connect
        }
    }

    stream(io: 0): Writable;
    stream(io: 1): Readable;
    stream(io: number): Readable[];
    stream(io: number): Writable | Readable | Readable[] {
        if (io === 0) {
            const first: any = this.consumers[0]
            return typeof first.stream === "function" ? first.stream(0) : first
        } else if (io === 1) {
            const first: any = this.consumers[0]
            return typeof first.stream === "function" ? first.stream(1) : first
        } else {
            return this.consumers.map((c: any, i) => typeof c.stream === "function" ? c.stream(io) : undefined)
        }
    }

    tap(output: Writable): this;
    tap(io: number, output: (item: number) => Writable): this;
    tap(...args: [Writable] | [number, (item: number) => Writable]): this {
        if (args.length === 1) {
            this.lastOutputConsumer.tap(args[0])
        } else if (args[0] === 1) {
            this.outputGeneratingConsumers.forEach((c, i) => c.tap(args[1](i)))
        } else {
            this.consumers.forEach((c, i) => {
                if (isExecution(c)) {
                    c.tap(args[0], args[1](i))
                }
            })
        }
        return this;
    }

    fullOutput(opts: { ignoreExit?: boolean; } = {}): Promise<string> {
        return this.lastOutputConsumer.fullOutput(opts)
    }

    get [Symbol.toStringTag](): string {
        return `[Pipeline ]`
    }

    then<TResult1 = void, TResult2 = never>(onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null | undefined, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): Promise<TResult1 | TResult2> {
        return this.allSuccess.then.apply(this.allSuccess, arguments)
    }

    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined): Promise<void | TResult> {
        return this.allSuccess.catch.apply(this.allSuccess, arguments)
    }

    finally(onfinally?: (() => void) | null | undefined): Promise<void> {
        return this.allSuccess.finally.apply(this.allSuccess, arguments)
    }

}

class CmdExecutionImpl implements CmdExecution {
    private outputs: Transform[] = []
    stdin: Transform;
    private spawned = false;

    throwOnError: Promise<void>
    success: Promise<boolean>
    exitStatus: LazyPromise<number | null>;

    constructor(dir: string, private cmd: string, private args: string[], env: {[key: string]: string | undefined}, updateEnv: boolean, stdErr: Writable | NodeJS.WriteStream | null) {
        this.exitStatus = new LazyPromise<number | null>((resolve, reject) => {

            let envPipe = 3;
            if (stdErr !== null) {
                if (this.outputs[2] === undefined) {
                    this.outputs[2] = new Stream.PassThrough()
                }
                this.outputs[2].pipe(stdErr);
            }
            if (updateEnv) {
                while (this.outputs[envPipe] !== undefined) {
                    envPipe++
                }
                cmd = `${quote([cmd].concat(args))}; retval=$?; env --null >&${envPipe}; exit $retval`
                this.fullOutput({ignoreExit: true, io: 3}).then(envResult => {
                    const pwd = env["PWD"]
                    for (const key in env) {
                        delete env[key]
                    }
                    for (const variable of envResult.split("\0")) {
                        const [key, value] = variable.split("=", 2)
                        env[key] = value
                    }
                    if (env["PWD"] === undefined) {
                        env["PWD"] = pwd;
                    }
                })
            }
            this.spawned = true
            const stdioSpec: Array<"pipe" | "ignore"> = []
            stdioSpec[0] = this.stdin === undefined ? "ignore" : "pipe"
            for (let i = 1; i < this.outputs.length; i++) {
                stdioSpec[i] = this.outputs[i] === undefined ? "ignore" : "pipe"
            }
            const child = cp.spawn(cmd, args, {
                cwd: dir,
                env,
                shell: updateEnv,
                stdio: stdioSpec
            });
            this.outputs.forEach((o,i) => {
                if (o !== undefined) {
                    (child.stdio[i] as Readable).setEncoding("utf8");
                    child.stdio[i]!.pipe(this.outputs[i] as Writable)
                }
            })
            if (this.stdin !== undefined) {
                child.stdin!.setDefaultEncoding("utf8")
                this.stdin.pipe(child.stdin!)
            }
            
            child.once('exit', (code, signal) => {
                resolve(code)
            })
            child.once('error', (error) => {
                reject({from: "child process error", error: error})
            });
        })
        this.throwOnError = this.exitStatus.lazily((exitStatus) => {
            if (exitStatus != 0) {
                throw new Error(this.getCmd() + " exit status: " + exitStatus)
            }
        })
        this.success = this.exitStatus.lazily((exitStatus) => exitStatus === 0)
    }

    fullOutput(opts: { ignoreExit?: boolean; io?: number; stripNewLines?: boolean } = {}): Promise<string> {
        const io = opts.io ?? 1;
        const stripNewLines = opts.stripNewLines ?? true
        if (io < 1) {
            throw new Error("You cannot read from io " + io)
        }
        if (this.spawned) {
            throw new Error("You must call fullOutput before awaiting any of the command's promises. You might need to first assign the various output promises to variables and then await, .then(), .catch() or .finally() them");
        }
        return new Promise((resolve, reject) => {
            const output = concat(async (b) => {
                if (!opts.ignoreExit) {
                    const exit = await this.exitStatus
                    if (exit === 0) {
                        if (stripNewLines) {
                            const output = stripNewlines(b.toString("utf8"));
                            resolve(output)
                        } else {
                            resolve(b.toString("utf8"))
                        }
                    } else {
                        reject({output: b, error: `non-zero exit code for '${this.cmd}'`})
                    }
                } else {
                    resolve(b.toString("utf8"));
                }
            })
            const src = this.outputs[io] ?? (this.outputs[io] = new Stream.PassThrough())
            pump([src, output], (err) => {
                if (err !== undefined) {
                    reject({ location: "pipe error", error: err });
                }
            });
            this.exitStatus.triggerRun()
        })
    }

    async result(opts: { io?: number; stripNewLines?: boolean } = {}): Promise<[number | null, string]> {
        const result = await this.fullOutput({...opts, ignoreExit: true})
        const exitCode = await this.exitStatus
        return [exitCode, result]
    }

    async *splitBy(sep: string, opts: {ignoreExit?: boolean, io?: number} = {}): AsyncIterable<string> {
        const io = opts.io ?? 1;
        if (io < 1) {
            throw new Error("You cannot read from io " + io)
        }
        if (this.spawned) {
            throw new Error("You must call tap before awaiting any of the command's promises. You might need to first assign the various output promises to variables and then await, .then(), .catch() or .finally() them");
        }
        const src = this.outputs[io] ?? (this.outputs[io] = new Stream.PassThrough())

        let previous = '';
        for await (const chunk of src) {
            previous += chunk;
            while (true) {
                const eolIndex = previous.indexOf(sep);
                if (eolIndex < 0) break;
                const line = previous.slice(0, eolIndex);
                if (line !== "")
                yield line;
                previous = previous.slice(eolIndex+1); //skip over the \n
            }
        }
        if (previous.length > 0) {
            yield previous;
        }
        if (opts.ignoreExit !== true) {
            const exitStatus = await this.exitStatus
            if (exitStatus !== 0) {
                throw new Error("Exit status was: " + exitStatus);
            }
        }
    }

    stream(io: 0): Writable;
    stream(io: number): Readable;
    stream(io: number): Readable | Writable {
        if (this.spawned) {
            throw new Error("You must call stream before awaiting any of the command's promises. You might need to first assign the various output promises to variables and then await, .then(), .catch() or .finally() them");
        }

        if (io === 0) {
            return this.stdin ?? (this.stdin = new Stream.PassThrough())
        } else {
            return this.outputs[io] ?? (this.outputs[io] = new Stream.PassThrough())
        }
    }

    tap(output: Writable): this;
    tap(io: number, output: Writable): this;
    tap(...args: [Writable] | [number, Writable]): this {
        const output = args.length === 1 ? args[0] : args[1]
        const io = args.length === 1 ? 1 : args[0]

        if (io < 1) {
            throw new Error("You cannot read from io " + io)
        }
        if (this.spawned) {
            throw new Error("You must call tap before awaiting any of the command's promises. You might need to first assign the various output promises to variables and then await, .then(), .catch() or .finally() them");
        }
        const src = this.outputs[io] ?? (this.outputs[io] = new Stream.PassThrough())
        src.pipe(output) //FIXME: handle errors
        return this;
    }

    get [Symbol.toStringTag](): string {
        return `[Cmd ${this.getCmd()} ${this.spawned ? "(running)" : "(initialized)"}]`
    }
    
    private getCmd(): string {
        return `${quote(this.cmd)} ${this.args.map(quote).join(" ")}`
    } 

    then<TResult1 = void, TResult2 = never>(onfulfilled?: () => TResult1 | PromiseLike<TResult1>, onrejected?: (reason: any) => TResult2 | PromiseLike<TResult2>): Promise<TResult1 | TResult2> {
        return this.throwOnError.then.apply(this.success, arguments);
    }
    catch<TResult = never>(onrejected?: (reason: any) => TResult | PromiseLike<TResult>): Promise<TResult> {
        return this.throwOnError.catch.apply(this.success, arguments);
    }

    finally(onfinally?: () => void): Promise<void> {
        return this.throwOnError.finally.apply(this.success, arguments);
    }
}

function catchElseBlock(input: never) {
    console.error("This input was not anticipated", input)
    throw new Error("This input was not anticipated" + input)
}

interface Run {
    (cmd: string, ...args: string[]): CmdExecution
    source(cmd: string, ...args: string[]): CmdExecution
    makeCommand<T extends string>(...input: T[]): {[K in T]: BoundCommand}
    bindCommand<T extends string>(command: string, ...args: string[]): BoundCommand
    export(key: string, value?: string): void
    pwd(...relativeSegments: string[]): string
    cd(path: string): void
    execLike(cmd: string, ...args: string[]): Promise<void>
}

function makeRun(dir: string, envStore: {[key: string]: string | undefined}, stderr: Writable | NodeJS.WriteStream | null): Run {
    envStore["PWD"] = dir;
    function run(cmd: string, ...args: string[]): CmdExecution {
        return new CmdExecutionImpl(envStore["PWD"]!, cmd, args, envStore, false, stderr);
    }
    run.source = function(cmd: string, ...args: string[]): CmdExecution {
        return new CmdExecutionImpl(envStore["PWD"]!, cmd, args, envStore, true, stderr);
    }
    run.makeCommand = function makeCommand<T extends string>(...cmds: T[]): {[K in T]: BoundCommand} {
        const result: {[key: string]: BoundCommand} = {}
        for (const command of cmds) {
            result[command] = makeBoundCommand(run, command, []);
        }
        return result as {[K in T]: BoundCommand};
    }

    run.bindCommand = function bindCommand<T extends string>(command: string, ...args: string[]): BoundCommand {
        return makeBoundCommand(run, command, args);
    }
    run.export = function (key: string, value?: string) {
        if (value === undefined) {
            delete envStore[key]
        } else {
            envStore[key] = value
        }
    }

    run.pwd = function(...relativeSegments: string[]): string {
        return path.join(dir, ...relativeSegments)
    }

    run.cd = function (newDir: string) {
        const resolved = path.resolve(dir, newDir)
        if (!fs.statSync(dir).isDirectory()) {
            throw new Error((newDir === resolved ? newDir : `${newDir} resolved to ${resolved} but that`) + " is not a directory")
        }
        envStore["PWD"] = resolved
    }

    run.execLike = function (cmd: string, ...args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const sub = cp.spawn(cmd, args, {
                cwd: dir,
                stdio: "inherit",
                env: envStore,
            });
            sub.once("exit", (code, signal) => {
                if (code !== null) {
                    process.exitCode = code
                }
                resolve()
            })
            sub.once("error", (error) => {
                reject({from: "run execlike", error: error})
            })
        })
    }

    return run;
}

function makeBoundCommand(run: Run, cmd: string, boundArgs: string[]): BoundCommand {
    return function boundRun(...args: string[]): CmdExecution {
        return run(cmd, ...boundArgs.concat(args))
    }
}

export function pipe(...consumers: [CmdExecution, ...PipeConsumer[]]): PipeExecution {
    return new PipeExecutionImpl(consumers);
}

export function inDir(opts: {stderr?: Writable | null, env?: {[key: string]: string}}, dir: string, ...relativePaths: string[]): Run
export function inDir(dir: string, ...relativePaths: string[]): Run
export function inDir(...args: [{stderr?: Writable | null, env?: {[key: string]: string}}, string, ...string[]] | [string, ...string[]]): Run {
    const opts = typeof args[0] === "string" ? {env: process.env, stderr: process.stderr} : args[0];
    let dir = typeof args[0] === "string" ? args[0] : args[1];
    let paths = (typeof args[0] === "string" ? args.slice(1) : args.slice(2)) as string[];
    if (!path.isAbsolute(dir)) {
        throw new Error("Specify an absolute directory, or use inHome inCwd or inScriptDir");
    }
    return makeRun(path.join(dir, ...paths), opts.env ?? process.env, opts.stderr === undefined ? process.stderr : opts.stderr)
}

export function inScriptDir(opts: {stderr?: Writable | null, env?: {[key: string]: string}}, ...relativePaths: string[]): Run
export function inScriptDir(...relativePaths: string[]): Run
export function inScriptDir(first: string | {stderr?: Writable | null, env?: {[key: string]: string}}, ...relativePaths: string[]): Run {
    const opts = typeof first === "string" ? {env: process.env, stderr: process.stderr} : first;
    if (typeof first === "string") {
        relativePaths.unshift(first)
    }
    return makeRun(path.join(__dirname, ...relativePaths), opts.env ?? process.env, opts.stderr === undefined ? process.stderr : opts.stderr)
}

export function inCwd(opts: {stderr?: Writable | null, env?: {[key: string]: string}} = {}): Run {
    return makeRun(process.cwd(), opts.env || process.env, opts.stderr === undefined ? process.stderr : opts.stderr)
}

export async function fromCwd(opts: {stderr?: Writable | null, env?: {[key: string]: string}}, resolver: (run: Run) => Promise<string>): Promise<Run>
export async function fromCwd(resolver: (run: Run) => Promise<string>): Promise<Run>
export async function fromCwd(...args: [{stderr?: Writable | null, env?: {[key: string]: string}}, (run: Run) => Promise<string>] | [(run: Run) => Promise<string>]): Promise<Run> {
    const env = args.length === 1 ? process.env : args[0].env ?? process.env
    const stderr = args.length === 1 ? process.stderr : args[0].stderr === undefined ? process.stderr : args[0].stderr
    if (args.length === 1) {
        return makeRun(await args[0](makeRun(process.cwd(), env, stderr)), env, stderr)
    } else {
        return makeRun(await args[1](makeRun(process.cwd(), env, stderr)), env, stderr)
    }
}

export function sleep(x: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, x*1000))
}

export async function read(message: string, options?: string[]): Promise<string> {
    if (options === undefined) {
        return (await prompt({ type: "text", name: "val", message })).val;
    } else {
        return (await prompt({ type: "list", name: "val", message, choices: options.map(x_1 => ({ title: x_1, value: x_1 })) })).val;
    }
}

export function toFile(filename: string, encoding?: string, append?: boolean) {
    return fs.createWriteStream(filename, {
        encoding,
        flags: append ? 'a' : undefined
    })
}
