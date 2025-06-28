// Ark errors.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import {Interval} from 'ohm-js'

export class ArkError extends Error {
  constructor(message: string, public source?: Interval, options: ErrorOptions = {}) {
    super(`${source ? `${source.getLineAndColumnMessage()}\n` : ''}${message}`, options)
  }
}

export class ArkCompilerError extends ArkError {}
