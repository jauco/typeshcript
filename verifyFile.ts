import fs from "fs"
import fsP from "fs/promises"

const fileChecks = {
    "NoLinkFile": "isFile",
    "NoLinkDir": "isDirectory",
    "NoLinkBlockDev": "isBlockDevice",
    "NoLinkCharDev": "isCharacterDevice",
    "NoLinkFIFO": "isFIFO",
    "NoLinkSocket": "isSocket",
    "UntargetedSymbolicLink": "isSymbolicLink",
    "LinkToFile": "isFile",
    "LinkToDir": "isDirectory",
    "LinkToBlockDev": "isBlockDevice",
    "LinkToCharDev": "isCharacterDevice",
    "LinkToFIFO": "isFIFO",
    "LinkToSocket": "isSocket",
} as const
export type FileTypes = keyof typeof fileChecks
/**
 * A replacement for bash's test builting (i.e. `[ -f somefile ]`)
 * 
 * It will tell if a path is an existing file or directory etc. It can also tell you if it has content
 * 
 * The isReadable/isWritable parts are discouraged by node, because you might as well just try to read it and handle the error. Works just as fine and saves you from a race condition.
 */
export async function verify(path: string, tests: {
  type?: FileTypes | Array<FileTypes>,
  permissions?: Array<"Readable" | "Writeable" | "Executable">,
  hasContent?: true,
  setUid?: boolean
}): Promise<boolean> {
  try {
    const directInfo = await fsP.lstat(path)
    let linkFollowedInfo: fs.Stats | undefined = undefined
    try {
      linkFollowedInfo = await fsP.stat(path)
    } catch (e) {

    }

    let success = true
    if (tests.type !== undefined) {
      const types = Array.isArray(tests.type) ? tests.type : [tests.type]
      success = success && types.some(t => {
        if (t.startsWith("NoLink")) {
          return directInfo[fileChecks[t]]()
        } else if (t === "UntargetedSymbolicLink") {
          return directInfo.isSymbolicLink() && linkFollowedInfo === undefined
        } else {
          return directInfo.isSymbolicLink() && linkFollowedInfo !== undefined && linkFollowedInfo[fileChecks[t]]()
        }
      })
    }
  
    if (tests.hasContent !== undefined) {
      success = success && linkFollowedInfo !== undefined && linkFollowedInfo.size > 0
    }
    if (tests.permissions !== undefined) {
      const requiredPermission = 
        (tests.permissions.indexOf("Readable") > -1 ? fs.constants.R_OK : 0) |
        (tests.permissions.indexOf("Writeable") > -1 ? fs.constants.W_OK : 0) |
        (tests.permissions.indexOf("Executable") > -1 ? fs.constants.X_OK : 0)
      try {
        await fsP.access(path, requiredPermission)
      } catch (e) {
        success = false
      }
    }
    return success
  } catch (e) {
    if (e.code === "ENOENT") {
      return false
    } else {
      throw e
    }
  }
}