import test from 'ava'

import {dirTest} from '../testutil.js'
import {FsMap, ValueTree} from './fsmap.js'

function objTest(title: string, dir: string, value: ValueTree) {
  test(title, (t) => {
    const dirAsObj = new FsMap(dir).toStruct()
    t.deepEqual(dirAsObj, value)
  })
}

test(
  'Bind an empty directory',
  dirTest,
  'test/fsmap/empty',
  (_t, _dir) => {},
)

test(
  'Create one file',
  dirTest,
  'test/fsmap/one-file',
  (_t, dir) => {
    const dirMap = new FsMap(dir)
    dirMap.set('a', 'xyz')
  },
)

test(
  'Create a directory',
  dirTest,
  'test/fsmap/one-subdir',
  (_t, dir) => {
    const dirMap = new FsMap(dir)
    dirMap.set('a', new Map())
  },
)

test(
  'Create a directory with some contents',
  dirTest,
  'test/fsmap/subdir-with-contents',
  (_t, dir) => {
    const dirMap = new FsMap(dir)
    dirMap.set('a', new Map([['x', 'abc'], ['y', 'xyz']]))
  },
)

objTest(
  'Bind a directory with some contents',
  'test/fsmap/subdir-with-contents',
  new Map<string, ValueTree>([['a', new Map([['x', 'abc'], ['y', 'xyz']])]]),
)
