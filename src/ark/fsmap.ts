import fs from 'fs'
import path from 'path'

class RawDirectory {
  directory: string

  // @param path directory path
  // @param t table to merge with directory
  // @return table bound to directory
  constructor(fspath: string) {
    if (!path.isAbsolute(fspath)) {
      fspath = path.join(process.cwd(), fspath)
    }
    if (!fs.statSync(fspath).isDirectory()) {
      throw new Error(`\`${fspath}' does not exist or is not a directory`)
    }
    this.directory = fspath
  }

  // eslint-disable-next-line generator-star-spacing
  *[Symbol.iterator]() {
    for (const entry of fs.readdirSync(this.directory)) {
      yield entry
    }
  }
}

export type ValueTree =
  | string
  | {[x: string]: ValueTree}

export const toObjectSym = Symbol.for('toObject')
export const directorySym = Symbol.for('getDirectory')

export type ValueDirectory = {
  [x: string]: ValueTree,
  [Symbol.iterator]: () => Iterator<string>,
  [toObjectSym]: ValueTree,
  [directorySym]: string,
}

export function valueDirectoryToObject(dir: ValueDirectory) {
  if (typeof dir === 'string') {
    return dir
  }
  const res: ValueTree = {}
  for (const obj of dir) {
    const subobj = dir[obj]
    if (typeof subobj === 'string') {
      res[obj] = subobj
    } else {
      const fspath = path.join(dir[directorySym], obj)
      res[obj] = valueDirectoryToObject(valueDirectory(fspath))
    }
  }
  return res
}

export function valueDirectory(fspath: string): ValueDirectory {
  const directory = new RawDirectory(fspath)
  return new Proxy(directory, {
    get(target: RawDirectory, prop: string | symbol, receiver: ValueDirectory) {
      if (prop === Symbol.iterator) {
        return target[Symbol.iterator].bind(target)
      } else if (prop === toObjectSym) {
        return valueDirectoryToObject(receiver)
      } else if (prop === directorySym) {
        return directory.directory
      }

      const fspath = path.join(target.directory, prop.toString())
      const stats = fs.statSync(fspath, {throwIfNoEntry: false})
      if (stats !== undefined) {
        if (stats.isFile()) {
          return fs.readFileSync(fspath, {encoding: 'utf-8'})
        } else if (stats.isDirectory()) {
          return new RawDirectory(fspath)
        }
      }
      return stats
    },

    set(target: RawDirectory, prop: string, value: ValueTree, _receiver) {
      if (typeof prop !== 'string') {
        throw new Error('keys of ValueDirectory must be of type string')
      } else {
        prop = prop.replace(path.sep, '_')
        const fspath = path.join(target.directory, prop)
        if (value === undefined) {
          fs.unlinkSync(fspath)
        } else if (typeof value !== 'object') {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          fs.writeFileSync(fspath, value.toString())
        } else if (value instanceof RawDirectory) {
          // To match object semantics we'd hardlink, but that's not allowed for directories
          fs.symlinkSync(value.directory, fspath)
        } else if (typeof value === 'object' && value !== null) {
          fs.mkdirSync(fspath)
          const dir = valueDirectory(fspath)
          for (const key in value) {
            if (Object.hasOwn(value, key)) {
              (dir as unknown as {[x: string]: ValueTree})[key] = value[key]
            }
          }
        }
        return true
      }
    },

    ownKeys(target: RawDirectory) {
      const keys = []
      for (const obj of target) {
        keys.push(obj)
      }
      return keys
    },

    getOwnPropertyDescriptor(_target, _prop) {
      return {enumerable: true, configurable: true, writable: true}
    },
  }) as unknown as ValueDirectory
}
