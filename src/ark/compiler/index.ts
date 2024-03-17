// Generate JavaScript from Ark.
// © Reuben Thomas 2024
// Released under the GPL version 3, or (at your option) any later version.

import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import util from 'node:util'
import getSource from 'get-source'
import {
  CodeWithSourceMap, Position, SourceMapConsumer,
  SourceNode,
} from 'source-map'
import StackTracey, {Entry} from '@sc3d/stacktracey'
import {Interval} from 'ohm-js'
import prettier from '@prettier/sync'

import {
  flattenExp,
  ArkInst, ArkAndInst, ArkAwaitInst,
  ArkBlockCloseInst, ArkBlockOpenInst, ArkThenBlockOpenInst, ArkLoopBlockOpenInst,
  ArkBreakInst, ArkCallInst, ArkContinueInst, ArkCopyInst, ArkFnInst, ArkElseBlockOpenInst,
  ArkInsts, ArkLaunchInst, ArkLetInst, ArkLetCopyInst,
  ArkLexpInst, ArkListLiteralInst, ArkLiteralInst, ArkMapLiteralInst,
  ArkObjectLiteralInst, ArkOrInst, ArkPropertyInst, ArkReturnInst,
  ArkSetInst, ArkSetPropertyInst,
} from './flatten.js'
import {
  debug, globals as arkGlobals,
  ArkBoolean, ArkBooleanVal, ArkExp, ArkList, ArkMap, ArkNull,
  ArkNumber, ArkNullVal, ArkNumberVal, ArkObject, ArkString,
  ArkStringVal, ArkUndefined, ArkVal, NativeFn,
} from '../interpreter.js'

// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Clone interpreter globals
export const jsGlobals = new ArkObject(new Map())
for (const [k, v] of arkGlobals.properties.entries()) {
  jsGlobals.set(k, v)
}

// Compile prelude and add it to globals
const preludeJs = fs.readFileSync(path.join(__dirname, 'prelude.js'), {encoding: 'utf-8'})
const prelude = await evalArkJs(preludeJs) as ArkObject
prelude.properties.forEach((val, sym) => jsGlobals.set(sym, val))

// runtimeContext records the values that are needed by JavaScript at
// runtime, and prevents the TypeScript compiler throwing away their
// imports.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const runtimeContext: Record<string, unknown> = {
  ArkUndefined,
  ArkNull,
  ArkBoolean,
  ArkNumber,
  ArkString,
  ArkObject,
  ArkList,
  ArkMap,
  NativeFn,
  jsGlobals,
}

function valToJs(val: ArkVal): string {
  if (val instanceof ArkNullVal) {
    return 'ArkNull()'
  } else if (val instanceof ArkBooleanVal) {
    return `ArkBoolean(${val.val})`
  } else if (val instanceof ArkNumberVal) {
    return `ArkNumber(${val.val})`
  } else if (val instanceof ArkStringVal) {
    return `ArkString(${util.inspect(val.val)})`
  } else if (val === arkGlobals) {
    // FIXME: We should detect 'externalSyms', not 'jsGlobals'.
    return 'jsGlobals'
  } else {
    debug(val)
    throw new Error('flat-to-js.valToJs: unknown ArkVal')
  }
}

function assign(src: string, dest: string) {
  return `${dest} = ${src}`
}

function letAssign(instId: symbol, valueJs: string) {
  return `let ${assign(valueJs, instId.description!)}\n`
}

function sourceLocToLineAndCol(sourceLoc?: Interval): [number | null, number | null] {
  const loc = sourceLoc?.getLineAndColumn()
  const line = loc ? loc.lineNum : null
  const col = loc ? loc.colNum - 1 : null // Convert 1-based to 0-based column
  return [line, col]
}

export function arkToJs(exp: ArkExp, file: string | null = null): CodeWithSourceMap {
  function instsToJs(insts: ArkInsts, fnName?: string): SourceNode {
    function instToJs(inst: ArkInst): SourceNode {
      const [line, col] = sourceLocToLineAndCol(inst.sourceLoc)
      function sourceNode(stmt: string | SourceNode | (string | SourceNode)[]) {
        return new SourceNode(line, col, file, stmt, fnName)
      }
      if (inst instanceof ArkLiteralInst) {
        return sourceNode(letAssign(inst.id, valToJs(inst.val)))
      } else if (inst instanceof ArkCopyInst) {
        return sourceNode(`${assign(inst.src.description!, inst.dest)}\n`)
      } else if (inst instanceof ArkBlockCloseInst) {
        return sourceNode([`${assign(inst.blockId.description!, inst.id.description!)}\n`, '}\n'])
      } else if (inst instanceof ArkThenBlockOpenInst) {
        return sourceNode([letAssign(inst.id, 'ArkNull()'), `if (${inst.condId.description} !== ArkBoolean(false)) {\n`])
      } else if (inst instanceof ArkElseBlockOpenInst) {
        return sourceNode('else {\n')
      } else if (inst instanceof ArkLoopBlockOpenInst) {
        return sourceNode([letAssign(inst.id, 'ArkNull()'), 'for (;;) {\n'])
      } else if (inst instanceof ArkBlockOpenInst) {
        return sourceNode([`let ${inst.id.description!}\n`, '{\n'])
      } else if (inst instanceof ArkLaunchInst) {
        return sourceNode([
          letAssign(inst.id, 'new ArkPromise((async () => {'),
          instsToJs(inst.asyncInsts),
          `return ${inst.asyncInsts.id.description}\n`,
          '})())\n',
        ])
      } else if (inst instanceof ArkAwaitInst) {
        return sourceNode(letAssign(inst.id, `await ${inst.argId.description}.promise`))
      } else if (inst instanceof ArkBreakInst) {
        return sourceNode([`${assign(inst.argId.description!, inst.loopInst.id.description!)}\n`, 'break\n'])
      } else if (inst instanceof ArkContinueInst) {
        return sourceNode('continue\n')
      } else if (inst instanceof ArkReturnInst) {
        return sourceNode(`return ${inst.argId.description}\n`)
      } else if (inst instanceof ArkLetCopyInst) {
        return sourceNode(letAssign(inst.id, `${inst.argId.description}`))
      } else if (inst instanceof ArkFnInst) {
        return sourceNode([
          letAssign(inst.id, `new NativeFn([${inst.params.map((p) => `'${p}'`).join(', ')}], async (${inst.params.join(', ')}) => {`),
          instsToJs(inst.body, inst.name),
          `return ${inst.body.id.description}\n`,
          '})\n',
        ])
      } else if (inst instanceof ArkCallInst) {
        return sourceNode(letAssign(inst.id, `await ${inst.fnId.description}.body(${inst.argIds.map((id) => id.description).join(', ')})`))
      } else if (inst instanceof ArkSetInst) {
        return sourceNode([
          `if (${inst.lexpId} !== ArkUndefined && ${inst.lexpId}.constructor !== ArkNullVal && ${inst.valId.description}.constructor !== ${inst.lexpId}.constructor) {\n`,
          'throw new JsRuntimeError(\'Assignment to different type\')\n',
          '}\n',
          letAssign(inst.id, `${inst.lexpId} = ${inst.valId.description}`),
        ])
      } else if (inst instanceof ArkSetPropertyInst) {
        return sourceNode(letAssign(inst.id, `${inst.lexpId.description}.set('${inst.prop}', ${inst.valId.description})`))
      } else if (inst instanceof ArkLetInst) {
        return sourceNode(`let ${inst.vars.join(', ')}\n`)
      } else if (inst instanceof ArkObjectLiteralInst) {
        const objInits: string[] = []
        for (const [k, v] of inst.properties.entries()) {
          objInits.push(`[${util.inspect(k)}, ${v.description}]`)
        }
        return sourceNode(letAssign(inst.id, `new ArkObject(new Map([${objInits.join(', ')}]))`))
      } else if (inst instanceof ArkListLiteralInst) {
        return sourceNode(letAssign(inst.id, `new ArkList([${inst.valIds.map((id) => id.description).join(', ')}])`))
      } else if (inst instanceof ArkMapLiteralInst) {
        const mapInits: string[] = []
        for (const [k, v] of inst.map.entries()) {
          mapInits.push(`[${k.description}, ${v.description}]`)
        }
        return sourceNode(letAssign(inst.id, `new ArkMap(new Map([${mapInits.join(', ')}]))`))
      } else if (inst instanceof ArkAndInst) {
        return sourceNode([
          letAssign(inst.id, 'undefined'),
          instsToJs(inst.leftInsts),
          `if (${inst.leftInsts.id.description} === ArkBoolean(false)) {\n`,
          `${inst.id.description} = ${inst.leftInsts.id.description}\n`,
          '} else {\n',
          instsToJs(inst.rightInsts),
          `${inst.id.description} = ${inst.rightInsts.id.description}\n`,
          '}\n',
        ])
      } else if (inst instanceof ArkOrInst) {
        return sourceNode([
          letAssign(inst.id, 'undefined'),
          instsToJs(inst.leftInsts),
          `if (${inst.leftInsts.id.description} !== ArkBoolean(false)) {\n`,
          `${inst.id.description} = ${inst.leftInsts.id.description}\n`,
          '} else {\n',
          instsToJs(inst.rightInsts),
          `${inst.id.description} = ${inst.rightInsts.id.description}\n`,
          '}\n',
        ])
      } else if (inst instanceof ArkPropertyInst) {
        return sourceNode(letAssign(inst.id, `${inst.objId.description}.get('${inst.prop}')`))
      } else if (inst instanceof ArkLexpInst) {
        return sourceNode(letAssign(inst.id, inst.lexp.debug.name!))
      } else {
        console.log('Invalid ArkInst:')
        debug(inst)
        throw new Error('invalid ArkInst')
      }
    }

    const [line, col] = sourceLocToLineAndCol(
      insts.insts.length > 0 ? insts.insts[0].sourceLoc : undefined,
    )
    return new SourceNode(line, col, file, insts.insts.map((inst) => instToJs(inst)))
  }

  const insts = flattenExp(exp)
  const sourceNode = new SourceNode(1, 1, 'src/ursa/flat-to-js.ts', [
  // FIXME: work out how to eval ESM, so we can use top-level await.
    '"use strict";\n',
    '(async () => {\n',
    instsToJs(insts),
    `return ${insts.id.description}\n})()`,
  ])
  const jsCode = sourceNode.toStringWithSourceMap({file: file ?? undefined})
  if (process.env.DEBUG) {
    console.log(prettier.format(jsCode.code, {parser: 'babel'}))
  }
  return jsCode
}

class UrsaStackTracey extends StackTracey {
  isThirdParty(path: string) {
    return super.isThirdParty(path) || path.includes('ark/') || path.includes('ursa/') || path.includes('node:')
  }

  isClean(entry: Entry, index: number) {
    return super.isClean(entry, index) && !entry.file.includes('node:')
  }
}

class JsRuntimeError extends Error {}

export async function evalArkJs(source: CodeWithSourceMap | string, file = '(Compiled Ark)'): Promise<ArkVal> {
  let jsSource: string
  if (typeof source === 'string') {
    jsSource = source
  } else {
    const urlString = `data:application/json;base64,${Buffer.from(source.map.toString()).toString('base64')}`
    jsSource = `${source.code}\n//# sourceMappingURL=${urlString}\n//# sourceURL=${path.basename(file)}`
    // Useful for debugging stack trace
    // fs.writeFileSync('tmp.js', source.code)
    // jsSource = `${source.code}\n//# sourceURL=tmp.js`
  }
  try {
    // eslint-disable-next-line no-eval
    return await (eval(jsSource) as Promise<ArkVal>)
  } catch (e) {
    assert(e instanceof Error)
    const dirtyStack = new UrsaStackTracey(e).withSources()
    // Useful for debugging stack trace
    // debug(dirtyStack.items.map((i) => `${i.file} ${i.line}:${i.column}:${i.sourceLine}`), null)
    const stack = dirtyStack.clean()
    const newError = new JsRuntimeError('')
    const trace = []
    let message = e.message
    if (stack.items.length > 0) {
      const curFrame = stack.items[0]
      let prefix: string
      if (curFrame.line !== undefined) {
        if (message.match('is not a function')) {
          const index = curFrame.column! - 1
          if (curFrame.sourceLine !== undefined && index < curFrame.sourceLine.length) {
            if (curFrame.sourceLine[index + 1] === '(') {
              message = 'Invalid call'
            } else if (curFrame.sourceLine[index + 1] === '.') {
              message = 'Invalid property'
            }
          }
        }
        prefix = `Line ${curFrame.line}, col ${curFrame.column}:`
        const lineNumWidth = (curFrame.line + 1).toString().length
        const fileSource = getSource(file)
        if (curFrame.line > 1) {
          prefix += `\n  ${(curFrame.line - 1).toString().padStart(lineNumWidth, ' ')} | ${fileSource.resolve({line: curFrame.line - 1, column: 1}).sourceLine}`
        }
        prefix += `\n> ${curFrame.line.toString().padStart(lineNumWidth, ' ')} | ${curFrame.sourceLine}\n${' '.repeat(curFrame.column! + lineNumWidth + 4)}^`
        if (curFrame.line < fileSource.lines.length) {
          prefix += `\n  ${(curFrame.line + 1).toString()} | ${fileSource.resolve({line: curFrame.line + 1, column: 1}).sourceLine}\n`
        }
      } else {
        prefix = 'unknown location'
      }
      newError.message = `${prefix}\n${message}`
      let consumer
      if (typeof source !== 'string') {
        consumer = await new SourceMapConsumer(source.map.toJSON())
      }
      for (const [i, frame] of stack.items.slice(1).entries()) {
        let fnLocation
        if (i === stack.items.length - 2) {
          fnLocation = 'at top level'
        } else {
          let fnName = '(anonymous function)'
          if (consumer) {
            const generatedPosition = consumer.generatedPositionFor({
              source: path.normalize(file),
              line: frame.line!,
              column: frame.column!,
            })
            if (generatedPosition.line !== null) {
              const origPosition = consumer.originalPositionFor(generatedPosition as Position)
              if (origPosition.name !== null) {
                fnName = origPosition.name
              }
            }
          }
          fnLocation = `in ${fnName}`
        }
        if (frame.line !== undefined) {
          trace.push(`line ${frame.line}\n    ${frame.sourceLine}, ${fnLocation}`)
        } else {
          trace.push('(uninstrumented stack frame)')
        }
      }
      if (consumer) {
        consumer.destroy()
      }
    }
    if (trace.length > 0) {
      newError.message += `

Traceback (most recent call last)
${trace.map((s) => `  ${s}`).join('\n')}`
    }
    throw newError
  }
}
