// Ark utility functions.
// © Reuben Thomas 2023-2025
// Released under the MIT license.

import util from 'util'

export type Class<T> = abstract new (...args: never[]) => T

export function valToString(x: unknown, depth: number | null = 1) {
  return util.inspect(
    x,
    {
      depth,
      colors: process.stdout && process.stdout.isTTY,
      sorted: true,
    },
  )
}

export function debug(x: unknown, depth?: number | null) {
  console.log(valToString(x, depth))
}
