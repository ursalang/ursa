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

// eslint-disable-next-line import/prefer-default-export
export async function cliTest(args: string[]) {
  const {stdout} = await run(args)
  return stdout
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
