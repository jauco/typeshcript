Here's a bunch of side by side comparisons of the bash and typeshcript solutions for common problems (where "common" has been defined as: most-upvoted stackoverflow questions). This puts bash at a slight disadvantage because these are all questions that people found unintuitive in bash. I don't yet have a list of things people find unintuitive about typeshcript however.

The goal isn't to show that typeshcript is obviously better at each of them. (in fact there's a bunch where I personally prefer the bash command). But this allows you to decide for yourself whether you are interested enough in this typeshcript thing to even give it a try. 

# How to get the source directory of a Bash script from within the script itself?

link: https://stackoverflow.com/questions/59895/how-to-get-the-source-directory-of-a-bash-script-from-within-the-script-itself

bash answer

```bash
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE" # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"

```

```ts
//well, technically
const scriptDir = __dirname

//but the question stated:
//I want to use a Bash script as a launcher for another application. I want to change the working directory to the one where the Bash script is located, so I can operate on the files in that directory

//which is done by saying:
const {run} = inScriptDir()

//running commands from the cwd is:
const {run2} = inCwd()

```
Also not that the "beware's" from the original answer no longer apply.

# How can I check if a directory exists in a Bash shell script?

link: https://stackoverflow.com/questions/59838/how-can-i-check-if-a-directory-exists-in-a-bash-shell-script

```bash
#the short and sweet one that everyone uses and is ok most of the time
if [ -d "$DIRECTORY" ]; then
  # Control will enter here if $DIRECTORY exists.
fi

# the correct one

if [ -d "$LINK_OR_DIR" ]; then 
  if [ -L "$LINK_OR_DIR" ]; then
    # It is a symlink!
    # Symbolic link specific commands go here.
    rm "$LINK_OR_DIR"
  else
    # It's a directory!
    # Directory command goes here.
    rmdir "$LINK_OR_DIR"
  fi
fi
```

```ts
//a bit longer, but you will never forget to think about handling symlinks
if (await verify(dirname, {type: ["NoLinkDir", "LinkToDir"]})) {

}
```

Bash is the winner here, but might cause a subtle bug (as mentioned in the stackoverflow question a little below the part that everyone will copy paste)


https://stackoverflow.com/questions/638975/how-do-i-tell-if-a-regular-file-does-not-exist-in-bash

```ts

if (!(await verify(filename, {type: "File"}))) {

}
 //if you don't care if it's a file or directory:

if (!(await verify(filename))) {

}

```

https://stackoverflow.com/questions/4181703/how-to-concatenate-string-variables-in-bash

```ts

const concatenated = varA + varB
```

https://stackoverflow.com/questions/229551/how-to-check-if-a-string-contains-a-substring-in-bash


```ts

if (myStr.includes(substr)) {

}
```

https://stackoverflow.com/questions/8467424/echo-newline-in-bash-prints-literal-n

```ts
console.log("hello\nworld")

```

(For those saying: works for me: you're right node does not differ that much between versions)

https://stackoverflow.com/questions/818255/in-the-shell-what-does-21-mean

In this case it's more of a "would people have trouble remembering this in tys?"

```ts

//send both stdout and stderr to head
pipe(run({sendOnwards: ["stdout", "stderr"]}, "g++", "lots_of_errors"), run("head"))

//only stdout
pipe(run({sendOnwards: ["stdout"]}, "g++", "lots_of_errors"), run("head"))
//sending only stdout onwards is the default so ommitting sendOnwards has the same effect
pipe(run("g++", "lots_of_errors"), run("head"))

//only stderr
pipe(run({sendOnwards: ["stderr"]}, "g++", "lots_of_errors"), run("head"))

```

https://stackoverflow.com/questions/592620/how-can-i-check-if-a-program-exists-from-a-bash-script

//okay. No help from tys here. Just use command -v like a muggle

```ts

if (!await run({sendUpwards: []}, "command", "-v", COMMAND).success) {
    console.log("COMMAND could not be found")
}

```


https://stackoverflow.com/questions/965053/extract-filename-and-extension-in-bash

```ts
const ext = someFileNameThatMayHaveAnExtension.split(".").pop()

```

https://stackoverflow.com/questions/918886/how-do-i-split-a-string-on-a-delimiter-in-bash

```ts
const result = someFileNameThatMayHaveAnExtension.split(".")

```

https://stackoverflow.com/questions/192249/how-do-i-parse-command-line-arguments-in-bash

Just use yargs

https://stackoverflow.com/questions/5947742/how-to-change-the-output-color-of-echo-in-linux

Just use chalk

https://stackoverflow.com/questions/4651437/how-do-i-set-a-variable-to-the-output-of-a-command-in-bash

Actually, while reading that. I don't think anyone answered the initial question. but anyway, 

```ts
let VAR1 = process.argv[2]

let MOREF = await pipe(
    {sendUpwards: ["stdout"]}, 
    run('sudo', "run", "command", "against", VAR1), 
    run("grep", "name"), run("cut", "-c7-")
)

//note that VAR1 is now neatly quoted. In the original script you could pass something with spaces and get unpredictable results (many of the answers are about that fact rather than the actual question)

```

https://stackoverflow.com/questions/1358540/how-to-count-all-the-lines-of-code-in-a-directory-recursively

```bash
find . -name '*.php' | xargs wc -l
```

```ts
  let total = 0
  for await (const file of recurse(await pwd())) {
      if (file.type === "LinkToFile" || file.type === "NoLinkFile" && file.name.endsWith(".php")) {
        total += + await run("wc", "-l", file.name)
      } else if (file.type === "LinkToDir" || file.type === "NoLinkDir") {
        file.recurse()
      }
  }
```

https://stackoverflow.com/questions/3601515/how-to-check-if-a-variable-is-set-in-bash

```ts
    //when talking about environment variables explicitly:

    if ($("envName") !== undefined) {
         //here the var might be set to ""
    }

    if ($("envName")) {
        //here it's guaranteed to be a non-zero-length string
    }
    
```

https://stackoverflow.com/questions/169511/how-do-i-iterate-over-a-range-of-numbers-defined-by-variables-in-bash


```ts
let END=5
for(var i = 0; i < END; i++){
  
}

for (const i of (await run("seq", "1", END)).split(" ")) {

}

```

https://stackoverflow.com/questions/876239/how-to-redirect-and-append-both-stdout-and-stderr-to-a-file-with-bash

```ts
//write stdout and stderr to a file, truncating it
run({sendOnwards: ["stdout", "stderr"]}, "cmd", "with", "args").writeTo(fileName)

//The question was: how to make this an appending write:
run({sendOnwards: ["stdout", "stderr"]}, "cmd", "with", "args").writeTo(fileName, {flags: "a"})
```

https://stackoverflow.com/questions/8880603/loop-through-an-array-of-strings-in-bash

```ts
for(const databaseName of listOfNames) {
  // Do something
}
```