// Ark compiler utility classes.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import assert from 'assert'

import {globals} from './data.js'
import {ArkType} from './type.js'

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

export class Environment {
  constructor(
    public stack: [Frame, ...Frame[]] = [new Frame([], [])],
    public externalSyms = globals,
  ) {}

  top() {
    return this.stack[0]
  }

  push(items: (Location | undefined)[]) {
    return new Environment(
      [
        new Frame(
          [...this.top().locals, ...items],
          this.top().captures,
        ),
        ...this.stack.slice(1),
      ],
      this.externalSyms,
    )
  }

  pushFrame(frame: Frame) {
    return new Environment([frame, ...this.stack], this.externalSyms)
  }

  popFrame() {
    assert(this.stack.length > 1)
    return new Environment([this.stack[1], ...this.stack.slice(2)], this.externalSyms)
  }
}
