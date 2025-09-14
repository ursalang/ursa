// Ark compiler utility classes.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {type ArkType} from './type.js'

export class Location {
  constructor(public name: string, public type: ArkType, public isVar: boolean) {
  }
}

export class Frame {
  constructor(
    // Locals are undefined between the point where they are allocated and
    // the point at which they are declared.
    public locals: (Location | undefined)[],
    public captures: Location[],
    public fnName?: string,
  ) {}
}

export class Namespace<T> extends Map<string, T> {
  public with(substs: Namespace<T>): Namespace<T> {
    const res = new Namespace<T>(this)
    for (const [k, v] of substs) {
      res.set(k, v)
    }
    return res
  }
}

export class Scope<T> {
  constructor(public stack: Namespace<T>[] = []) {}

  get(name: string): T | undefined {
    for (const frame of this.stack) {
      if (frame.has(name)) {
        return frame.get(name)
      }
    }
    return undefined
  }

  push(frame: Namespace<T>) {
    return new Scope<T>([frame, ...this.stack])
  }
}
