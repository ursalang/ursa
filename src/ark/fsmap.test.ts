import util from 'util'
import test from 'ava'
import tmp from 'tmp'
import {compareSync, Difference} from 'dir-compare'

import {FsMap, ValueTree} from './fsmap.js'

function diffsetDiffsOnly(diffSet: Difference[]): Difference[] {
  return diffSet.filter((diff) => diff.state !== 'equal')
}

export function dirTest(title: string, dir: string, callback: (dirObj: FsMap) => void) {
  const tmpDir = tmp.dirSync({unsafeCleanup: true})
  const dirObj = new FsMap(tmpDir.name)
  callback(dirObj)
  test(title, (t) => {
    t.teardown(() => {
      // AVA seems to prevent automatic cleanup.
      tmpDir.removeCallback()
    })
    const compareResult = compareSync(tmpDir.name, dir, {
      compareContent: true,
      excludeFilter: '.gitkeep',
    })
    t.assert(
      compareResult.same,
      util.inspect(diffsetDiffsOnly(compareResult.diffSet as Difference[])),
    )
  })
}

function objTest(title: string, dir: string, value: ValueTree) {
  test(title, (t) => {
    const dirAsObj = new FsMap(dir).toObject()
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
    dir.set('a', 'xyz')
  },
)

dirTest(
  'Create a directory',
  'test/fsmap/one-subdir',
  (dir) => {
    dir.set('a', new Map())
  },
)

dirTest(
  'Create a directory with some contents',
  'test/fsmap/subdir-with-contents',
  (dir) => {
    dir.set('a', new Map([['x', 'abc'], ['y', 'xyz']]))
  },
)

objTest(
  'Bind a directory with some contents',
  'test/fsmap/subdir-with-contents',
  new Map<string, ValueTree>([['a', new Map([['x', 'abc'], ['y', 'xyz']])]]),
)
