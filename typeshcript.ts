// Typeshcript: The performance is not completely terrible!
// Typeshcript: You too can become a full stack developer!
// Typeshcript: Add null _and_ undefined to your shell scripts!
// Typeshcript: The name slithers right off the tongue!
// Typeshcript: let your frontend devs execute commands on your filesystem!

/*
    - [ ] create npm package that you can install globally
    - [ ] with tys wrapper command that calls https://github.com/alangpierce/sucrase for .tsh files and node for .jsh files
    - [X] use yarn global add <package>
*/

import * as util from "util";
import * as cp from "child_process";
import * as path from "path";
import { Writable, Readable, PassThrough } from "stream";
import * as fs from "fs";

function catchElseBlock(input: never): never {
  console.error("This input was not anticipated", input);
  throw new Error("This input was not anticipated" + input);
}

type GetSecondArg<T> = T extends (arg1: any, arg2: infer U) => infer V ? U : never

type FsOptions = Exclude<GetSecondArg<typeof fs.createWriteStream>, string | undefined>

export interface CmdExecution extends Promise<string> {
  readonly output: Promise<Readable>;
  provideInput(input: Promise<Readable>): this;
  writeTo(filename: string, options?: FsOptions): this

  fullResult(opts?: {
    newLineHandling?: "trimLast" | "leaveAll" | "trimAllTrailing";
  }): Promise<{ code: number | string; stderr: string; stdout: string }>;

  readonly exitStatus: Promise<number | string>;
  readonly success: Promise<boolean>;

}

export interface SingleCmdExecution extends CmdExecution {
  command: string[]
}

export interface PipeExecution extends CmdExecution {
  readonly exitStatuses: Promise<Array<number | string>>;
  readonly commands: CmdExecution[];

}

class PipeExecutionImpl implements PipeExecution {
  public exitStatuses: Promise<Array<number | string>>;
  public exitStatus: Promise<number | string>;
  public success: Promise<boolean>;
  public lastCommand: CmdExecution;

  constructor(opts: {pipeFail: boolean}, public commands: CmdExecution[]) {
    if (commands.length === 0) {
      throw new Error("Empty pipe");
    }
    let inputGetter = commands[0].output;
    (commands[0] as any).resultAwaited = true;
    (commands[0] as CmdExecutionImpl).quickResolve(null);
    this.lastCommand = commands[commands.length - 1];
    for (const command of commands.slice(1)) {
      (command as CmdExecutionImpl).quickResolve(null);
      if (command !== this.lastCommand) {
        (command as any).resultAwaited = true;
      }
      // eslint disabled because the promise will be awaited in the user code. not here.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      command.provideInput(inputGetter);
      inputGetter = command.output;
    }
    this.exitStatuses = Promise.all(commands.map((x) => x.exitStatus));
    if (opts.pipeFail) {
      this.exitStatus = this.exitStatuses.then((x) =>
        x.reduce((acc, cur) => (typeof acc === "string" ? acc : typeof cur === "string" ? cur : Math.max(acc, cur))),
      );
    } else {
      this.exitStatus = this.lastCommand.exitStatus
    }
    this.success = this.exitStatus.then((x) => x === 0);
  }
  [Symbol.toStringTag] = "PipeExecutionImpl";


  provideInput(input: Promise<Readable>) {
    // eslint disabled because the promise will be awaited in the user code. not here.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.commands[0].provideInput(input);
    return this
  }

  toString() {
    return "( " + this.commands.map((x) => x.toString()).join(" | ") + " )";
  }

  then<TResult1 = string, TResult2 = never>(onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null | undefined, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): Promise<TResult1 | TResult2> {
    return this.lastCommand.then(onfulfilled, onrejected)
  }

  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined): Promise<string | TResult> {
    return this.lastCommand.catch(onrejected)
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<string> {
    return this.lastCommand.finally(onfinally)
  }

  fullResult(
    opts: {
      newLineHandling?: "trimLast" | "leaveAll" | "trimAllTrailing";
    } = {},
  ): Promise<{ code: number | string; stderr: string; stdout: string }> {
    return this.lastCommand.fullResult(opts);
  }

  public get output(): Promise<Readable> {
    return this.lastCommand.output;
  }

  writeTo(fileName: string, options?: FsOptions): this {
    // eslint disabled because the promise will be awaited in the user code. not here.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.lastCommand.writeTo(fileName, options)
    return this
  }
}

function sendLines(input: Readable, output: Writable) {
  let prevOut = '';
  input.on("data", d => {
    prevOut += d
    let eolIndex;
    while ((eolIndex = prevOut.indexOf('\n')) >= 0) {
      // line includes the EOL
      const line = prevOut.slice(0, eolIndex+1);
      output.write(line + "\n")
      prevOut = prevOut.slice(eolIndex+1);
    }
  })
  input.on("end", () => {
    if (prevOut.length > 0) {
      output.write(prevOut)
    }
  })
  input.on("error", () => {
    output.destroy()
  })
}

class CmdExecutionImpl implements SingleCmdExecution {
  private inputStream: Promise<Readable> | undefined = undefined;
  public resultPromise: Promise<{
    code: number | string;
    stderr: string;
    stdout: string;
  }>;
  public output: Promise<Readable>;
  private stringRep: string;
  public quickResolve: (e: unknown) => void;
  private resultAwaited = false;
  command: string[]

  constructor(
    startPromise: Promise<any>,
    private cmd: string,
    rawArgs: Runarg[],
    env: { [key: string]: string | undefined },
    stdOut: Writable | NodeJS.WriteStream | null,
    stdErr: Writable | NodeJS.WriteStream | null,
    sendUp: Array<OutputStreams>,
    logStdout: SendStdoutUpwardsOpts,
    sendOnwards: Array<OutputStreams>,
  ) {
    const args = rawArgs
      .map((x) => {
        if (typeof x === "string") {
          return x;
        } else {
          return x.ignorable;
        }
      })
      .filter(<T>(input: T | null | undefined): input is T => input != null);

    this.command = [cmd].concat(args)
    this.stringRep = JSON.stringify([this.cmd].concat(args));

    let outputResolver: (val: Readable) => void;
    this.output = new Promise<Readable>((r) => (outputResolver = r));

    this.quickResolve = () => {
      throw new Error("This should never happen! because this value is overwritten on the next line!");
    };
    const pipePromise = new Promise((resolver) => (this.quickResolve = resolver));
    this.resultPromise = Promise.race([startPromise, pipePromise])
      .then(() => this.inputStream)
      .then(async (input) => {
        const result = { stderr: "", stdout: "", code: -1 as number | string };

        return new Promise((resolve, reject) => {
          const child = cp.spawn(cmd, args, {
            cwd: env["PWD"],
            env,
            stdio: [
              input === undefined ? "ignore" : "pipe",
              "pipe",
              "pipe",
            ],
          });
          if (input !== undefined) {
            input.pipe(child.stdin!);
          }
          child.stdout!.setEncoding("utf8");
          child.stderr!.setEncoding("utf8");

          if (stdOut !== null) {
            if ((logStdout === "whenExplicitlyRequested" && sendUp.indexOf(1) > -1) || (logStdout === "whenUnused" && !this.resultAwaited)) {
              child.stdout!.pipe(stdOut);
            }
          }

          if (stdErr !== null && (sendUp.length === 0 || sendUp.indexOf(2) > -1)) {
            child.stderr!.pipe(stdErr);
          }

          child.stdout!.on("data", (d) => {
            result.stdout += d;
          });
          child.stderr!.on("data", (d) => {
            result.stderr += d;
          });
          
          if (sendOnwards.length === 1) {
            if (sendOnwards[0] === 1 || sendOnwards[0] === "stdout") {
              outputResolver(child.stdout!);
            } else if (sendOnwards[0] === 2 || sendOnwards[0] === "stderr") {
              outputResolver(child.stderr!);
            } 
          } else if (sendOnwards.length > 1) {
            const outputStr = new PassThrough();
            for (const output of sendOnwards) {
              if (output === 1 || output === "stdout") {
                sendLines(child.stdout!, outputStr)
              } else if (output === 2 || output === "stderr") {
                sendLines(child.stderr!, outputStr)
              }
            }
            outputResolver(outputStr)
          }

          child.once("exit", (code, signal) => {
            result.code = code ?? signal!;
            resolve(result);
          });
          child.once("error", (error) => {
            reject({ from: "child process error", error: error });
          });
        });
      });
  }
  [Symbol.toStringTag] = "CmdExecutionImpl";

  then<TResult1 = string, TResult2 = never>(onfulfilled?: ((value: string) => TResult1 | PromiseLike<TResult1>) | null | undefined, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): Promise<TResult1 | TResult2> {
    return this.stdout.then(onfulfilled, onrejected)
  }
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined): Promise<string | TResult> {
    return this.stdout.catch(onrejected)
  }
  finally(onfinally?: (() => void) | null | undefined): Promise<string> {
    return this.stdout.finally(onfinally)
  }

  writeTo(fileName: string, options?: FsOptions): this {
    const s = fs.createWriteStream(fileName, options)
    
    // eslint disabled because the promise will be awaited in the user code. not here.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.output.then(r => {
      r.on("error", e => s.close())
      r.pipe(s);
    })
    
    return this
  }

  provideInput(input: Promise<Readable>) {
    if (this.inputStream !== undefined) {
      throw new Error("The input stream is already bound");
    } else {
      this.inputStream = input;
    }
    return this
  }

  async fullResult(
    opts: {
      newLineHandling?: "trimLast" | "leaveAll" | "trimAllTrailing";
    } = {},
  ): Promise<{ code: number | string; stderr: string; stdout: string }> {
    this.resultAwaited = true;
    const result = await this.resultPromise;
    const newLineHandling = opts.newLineHandling ?? "trimLast";
    if (newLineHandling === "leaveAll") {
      return result;
    } else if (newLineHandling === "trimLast") {
      if (result.stderr.endsWith("\n")) {
        result.stderr = result.stderr.slice(0, -1);
      }
      if (result.stdout.endsWith("\n")) {
        result.stdout = result.stdout.slice(0, -1);
      }
      return result;
    } else if (newLineHandling === "trimAllTrailing") {
      result.stderr = result.stderr.replace(/\n*$/, "");
      result.stdout = result.stdout.replace(/\n*$/, "");
      return result;
    } else {
      return catchElseBlock(newLineHandling);
    }
  }

  private async commonSenseHandling(): Promise<{ stderr: string; stdout: string }> {
    const result = await this.fullResult({ newLineHandling: "trimLast" });
    if (result.code !== 0) { //a string (i.e. termination by a signal) is also treated as an error so that ctrl-c will stop the script
      return Promise.reject({ errorType: "nonzero", result: result });
    }
    else {
      return result;
    }
  }

  private get stdout(): Promise<string> {
    return this.commonSenseHandling().then((x) => x.stdout);
  }

  public get exitStatus(): Promise<number | string> {
    return this.resultPromise.then((x) => x.code);
  }
  public get success(): Promise<boolean> {
    return this.resultPromise.then((x) => x.code === 0);
  }

  toString() {
    return this.stringRep;
  }
}

interface Ignorable {
  ignorable: string | null | undefined;
}

type Runarg = string | Ignorable;

type OutputStreams = 1 | 2 | "stdout" | "stderr"

export interface Runner {
  (opts: { sendUp?: Array<OutputStreams>; sendOnwards?: Array<OutputStreams> }, cmd: string, ...args: Runarg[]): CmdExecution;
  (cmd: string, ...args: Runarg[]): CmdExecution;
}

export interface Run {
  run: Runner;

  $: {[key: string]: string | undefined}
  pwd(): Promise<string>;
  resolveFromPwd(...relativeSegments: string[]): Promise<string>;
  cd(path: string): Promise<void>;

  pipe(...cmds: CmdExecution[]): PipeExecution;
}

function makeRun(dir: string, opts: RunOpts): Run {
  const envStore = opts.env ?? {};
  const stdout = opts.stdout === undefined ? process.stdout : opts.stdout;
  const stderr = opts.stderr === undefined ? process.stderr : opts.stderr;

  envStore["PWD"] = dir;

  let startPromise: Promise<any> = Promise.resolve();

  function pwd() {
    return (startPromise = startPromise.then(() => envStore["PWD"]!));
  }
  function run(...params: any[]): CmdExecution {
    const callOpts = typeof params[0] === "string" ? { } : params[0];
    const sendUp = callOpts.sendUp ?? [];
    const sendOnwards = callOpts.sendOnwards ?? [1];
    const cmd = typeof params[0] === "string" ? params[0] : params[1];
    const args = params.slice(typeof params[0] === "string" ? 1 : 2);
    const exec = new CmdExecutionImpl(
      startPromise,
      cmd,
      args,
      envStore,
      stdout,
      stderr,
      sendUp,
      opts.sendStdoutUpwards ?? "whenUnused",
      sendOnwards,
    );
    startPromise = exec.resultPromise;
    if (opts.continueOnError) {
      startPromise = startPromise.catch( e => {
        return (stderr as Writable).write("Command failed! " + util.inspect(e), "utf8", (e) => {
          console.error("Failure while writing to stderr. What I meant to write was: Command failed! " + util.inspect(e))
        });
      })
    }
    return exec;
  }
  return {
    run: run,

    $: new Proxy(envStore, {
      set(tgt, prop, val, receiver) {
        if (prop === "PWD") {
          throw new Error("You cannot change $PWD directly because then it would be unclear what directory the commands that have been created, but are not executed would run in. Use `await cd(newDir)` to change the current directory")
        }
        return Reflect.set(tgt, prop, val, receiver);
      }
    }),

    pwd: pwd,

    resolveFromPwd: function (...relativeSegments: string[]) {
      return (startPromise = pwd().then((pwd) => path.join(pwd, ...relativeSegments)));
    },

    cd: function (newDir: string) {
      return (startPromise = startPromise.then(() => {
        const resolved = path.resolve(dir, newDir);
        if (!fs.statSync(dir).isDirectory()) {
          throw new Error((newDir === resolved ? newDir : `${newDir} resolved to ${resolved} but that`) + " is not a directory");
        }
        envStore["PWD"] = resolved;
      }));
    },
    pipe: function (...args: CmdExecution[] | [{ignoreIntermediatePipeErrors: boolean}, ...CmdExecution[]]) {
      if ((args[0] as any).ignoreIntermediatePipeErrors !== undefined) {
        return new PipeExecutionImpl({pipeFail: !(args[0] as any).ignoreIntermediatePipeErrors}, (args as any).slice(1));
      } else {
        return new PipeExecutionImpl({pipeFail: !opts.ignoreIntermediatePipeErrors}, (args as any));
      }
    },
  };
}


interface RunOptsArg extends RunOpts {
  env: { [key: string]: string | undefined };
}

type SendStdoutUpwardsOpts = "whenExplicitlyRequested" | "whenUnused"

interface RunOpts {
  stderr?: Writable | null;
  stdout?: Writable | null;
  env?: { [key: string]: string | undefined };
  sendStdoutUpwards?: "whenExplicitlyRequested" | "whenUnused";
  continueOnError?: boolean;
  ignoreIntermediatePipeErrors?: boolean
  //FIXME: trap: (signal: string) => void
}

export function inDir(opts: RunOptsArg, dir: string, ...relativePaths: string[]): Run;
export function inDir(dir: string, ...relativePaths: string[]): Run;
export function inDir(...args: [RunOptsArg, string, ...string[]] | [string, ...string[]]): Run {
  let opts: RunOpts, dir: string;
  if (typeof args[0] === "string") {
    opts = {};
    dir = path.join(...(args as string[]));
  } else {
    opts = args[0];
    dir = path.join(...(args.slice(1) as string[]));
  }
  if (!path.isAbsolute(dir)) {
    throw new Error("Specify an absolute directory or use either inCwd(), fromCwd() or inScriptDir()");
  }
  return makeRun(dir, opts);
}

export function inScriptDir(opts: RunOptsArg, ...relativePaths: string[]): Run;
export function inScriptDir(...relativePaths: string[]): Run;
export function inScriptDir(...args: [RunOptsArg, ...string[]] | [...string[]]): Run {
  let opts: RunOpts, dir: string;
  if (typeof args[0] === "string") {
    opts = {};
    dir = path.join(__dirname, ...(args as string[]));
  } else {
    opts = args[0];
    dir = path.join(__dirname, ...(args.slice(1) as string[]));
  }
  return makeRun(dir, opts);
}

export function inCwd(opts?: RunOptsArg): Run {
  return makeRun(process.cwd(), opts || {});
}

export async function fromCwd(opts: RunOptsArg, resolver: (run: Run) => Promise<string>): Promise<Run>;
export async function fromCwd(resolver: (run: Run) => Promise<string>): Promise<Run>;
export async function fromCwd(...args: [RunOptsArg, (run: Run) => Promise<string>] | [(run: Run) => Promise<string>]): Promise<Run> {
  let opts: RunOpts, resolver: (run: Run) => Promise<string>;
  if (typeof args[0] === "function") {
    opts = {};
    resolver = args[0];
  } else {
    opts = args[0];
    resolver = args[1]!;
  }
  return makeRun(await resolver(makeRun(process.cwd(), opts)), opts);
}

export function sleep(x: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, x * 1000));
}

export function ignoreNull(val: string | null | undefined): Ignorable {
  return { ignorable: val };
}
