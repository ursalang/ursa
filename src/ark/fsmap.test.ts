import util from 'util'
import test from 'ava'
import tmp from 'tmp'
import {compareSync, Difference} from 'dir-compare'

import {
  valueDirectory, ValueDirectory, valueDirectoryToObject, ValueTree,
} from './fsmap.js'

function diffsetDiffsOnly(diffSet: Difference[]): Difference[] {
  return diffSet.filter((diff) => diff.state !== 'equal')
}

function dirTest(title: string, dir: string, callback: (dirObj: ValueDirectory) => void) {
  test(title, (t) => {
    const tmpDir = tmp.dirSync({unsafeCleanup: true})
    const dirObj = valueDirectory(tmpDir.name)
    callback(dirObj)
    const compareResult = compareSync(tmpDir.name, dir, {compareContent: true})
    t.assert(
      compareResult.same,
      util.inspect(diffsetDiffsOnly(compareResult.diffSet as Difference[])),
    )
    // AVA seems to prevent automatic cleanup.
    tmpDir.removeCallback()
  })
}

function objTest(title: string, dir: string, value: ValueTree) {
  test(title, (t) => {
    const dirAsObj = valueDirectoryToObject(valueDirectory(dir))
    t.deepEqual(dirAsObj, value)
  })
}

dirTest(
  'Bind an empty directory',
  'test/fsmap/empty',
  (_dir) => {},
)

dirTest(
  'Create one file',
  'test/fsmap/one-file',
  (dir) => {
    dir.a = 'xyz'
  },
)

dirTest(
  'Create a directory',
  'test/fsmap/one-subdir',
  (dir) => {
    dir.a = {}
  },
)

dirTest(
  'Create a directory with some contents',
  'test/fsmap/subdir-with-contents',
  (dir) => {
    dir.a = {x: 'abc', y: 'xyz'}
  },
)

objTest(
  'Bind a directory with some contents',
  'test/fsmap/subdir-with-contents',
  {a: {x: 'abc', y: 'xyz'}},
)
