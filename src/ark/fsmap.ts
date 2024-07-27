// Simple file system interface.
// © Reuben Thomas 2023
// Released under the MIT license.

import fs from 'fs'
import path from 'path'

export type ValueTree =
  | string
  | Map<string, ValueTree>

export class FsMap {
  directory: string

  constructor(fspath: string) {
    if (!path.isAbsolute(fspath)) {
      fspath = path.join(process.cwd(), fspath)
    } else if (!fs.statSync(fspath).isDirectory()) {
      throw new Error(`\`${fspath}' does not exist or is not a directory`)
    }
    this.directory = fspath
  }

  get(key: string): FsMap | string | undefined {
    key = key.replace(path.sep, '_')
    const fspath = path.join(this.directory, key.toString())
    const stats = fs.statSync(fspath, {throwIfNoEntry: false})
    if (stats === undefined) {
      return stats
    }
    if (stats.isFile()) {
      return fs.readFileSync(fspath, {encoding: 'utf-8'})
    } else if (stats.isDirectory()) {
      return new FsMap(fspath)
    } else {
      throw new Error(`${key} is not a file or directory in ValueDirectory`)
    }
  }

  set(key: string, value: ValueTree): FsMap {
    key = key.replace(path.sep, '_')
    const fspath = path.join(this.directory, key)
    if (typeof value === 'string') {
      fs.writeFileSync(fspath, value)
    } else {
      fs.mkdirSync(fspath)
      const dir = new FsMap(fspath)
      for (const [key, subval] of value) {
        dir.set(key, subval)
      }
    }
    return this
  }

  delete(key: string): boolean {
    const fspath = path.join(this.directory, key)
    if (fs.existsSync(fspath)) {
      fs.unlinkSync(fspath)
      return true
    }
    return false
  }

  keys(): string[] {
    return fs.readdirSync(this.directory)
  }

  toObject() {
    const res: ValueTree = new Map()
    for (const key of this.keys()) {
      const subobj = this.get(key)
      if (typeof subobj === 'string') {
        res.set(key, subobj)
      } else {
        const fspath = path.join(this.directory, key)
        res.set(key, new FsMap(fspath).toObject())
      }
    }
    return res
  }
}
