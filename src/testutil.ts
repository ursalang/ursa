import fs from 'fs'
import test from 'ava'
import tmp from 'tmp'
import execa from 'execa'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

async function run(args: string[]) {
  return execa(command, args)
}

// function doTest(inputFile: string, expected: string) {
//   const input = fs.readFileSync(inputFile, {encoding: 'utf-8'})
//   const output = toVal(input).eval(new EnvironmentVal([]))
//   assertStringEqual(String(output._value()), expected)
// }

// function failingTest(inputFile: string, expected: string) {
//   try {
//     doTest(inputFile, expected)
//   } catch (error: any) {
//     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
//     expect(error.message).to.contain(expected)
//     return
//   }
//   throw new Error('test passed unexpectedly')
// }

export async function cliTest(syntax: string, title: string, file: string, output?: string) {
  const tempFile = tmp.tmpNameSync()
  test(title, async (t) => {
    const {stdout} = await run([`${file}.${syntax}`, `--syntax=${syntax}`, `--output=${tempFile}`])
    const result = fs.readFileSync(tempFile, {encoding: 'utf-8'})
    const expected = fs.readFileSync(`${file}.result.json`, {encoding: 'utf-8'})
    if (output !== undefined) {
      t.is(output, stdout)
    }
    t.is(result, expected)
  })
}

// async function failingCliTest(args: string[], expected: string) {
//   try {
//     await cliTest(args, '')
//   } catch (error: any) {
//     expect(error.stderr).to.contain(expected)
//     return
//   }
//   throw new Error('test passed unexpectedly')
// }
