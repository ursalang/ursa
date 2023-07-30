import test from 'ava'

import execa from 'execa'

const command = process.env.NODE_ENV === 'coverage' ? './bin/test-run.sh' : './bin/run.js'

async function run(args: string[]) {
  return execa(command, args)
}

// function assertStringEqual(output: string, expected: string) {
//   const patch = createPatch('test output', expected, output)
//   assert(output === expected, patch)
// }

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

async function cliTest(args: string[]) {
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

// Module tests
test('Repeated closure', async (t) => {
  t.is(await cliTest(['test/repeated-closure.ursa']), '[ 1, 2, 1 ]')
})

test('Repeated closure (sexp syntax)', async (t) => {
  t.is(await cliTest(['--sexp', 'test/repeated-closure.hak']), '[ 1, 2 ]')
})

// it('Test nested macro invocations', () => {
//   test(['nested-macro-src'], 'nested-macro-expected')
// })

// it('Failing executable test', () => {
//   failingTest([process.cwd()], 'Command failed with exit code 1', 'false.nancy.txt')
// })

// it('Passing executable test', () => {
//   test([process.cwd()], 'true-expected.txt', 'true.nancy.txt')
// })

// it('Executable test', () => {
//   test(['page-template-with-date-src'], 'page-template-with-date-expected')
// })

// it("Test that macros aren't expanded in Nancy's command-line arguments", () => {
//   test(['$path-src'], '$path-expected')
// })

// it("Test that $paste doesn't expand macros", () => {
//   test(['paste-src'], 'paste-expected')
// })

// it('Test that $include with no arguments gives an error', () => {
//   failingTest([process.cwd()], '$include expects at least one argument', 'include-no-arg.nancy.txt')
// })

// it('Test that $paste with no arguments gives an error', () => {
//   failingTest([process.cwd()], '$paste expects at least one argument', 'paste-no-arg.nancy.txt')
// })

// it('Test escaping a macro without arguments', () => {
//   test(['escaped-path-src'], 'escaped-path-expected')
// })

// it('Test escaping a macro with arguments', () => {
//   test(['escaped-include-src'], 'escaped-include-expected')
// })

// it('Test expanding a file with relative includes', () => {
//   test([process.cwd()], 'file-root-relative-include-expected.txt', 'file-root-relative-include.nancy.txt')
// })

// it('Empty input path should cause an error', () => {
//   failingTest([], 'at least one input must be given')
// })

// it('A non-existent input path should cause an error', () => {
//   failingTest(['a'], "input 'a' does not exist")
// })

// it('An input that is not a directory should cause an error', () => {
//   failingTest(['random-text.txt'], "input 'random-text.txt' is not a directory")
// })

// it('$include-ing a non-existent file should cause an error', () => {
//   failingTest([process.cwd()], "cannot find 'foo'", 'missing-include.nancy.txt')
// })

// it('Calling an undefined macro should cause an error', () => {
//   failingTest([process.cwd()], "no such macro '$foo'", 'undefined-macro.nancy.txt')
// })

// it('Calling an undefined single-letter macro should cause an error', () => {
//   failingTest([process.cwd()], "no such macro '$f'", 'undefined-short-macro.nancy.txt')
// })

// it('A macro call with a missing close brace should cause an error', () => {
//   failingTest([process.cwd()], 'missing close brace', 'missing-close-brace.nancy.txt')
// })

// // CLI tests
// it('--help should produce output', async () => {
//   const proc = run(['--help'])
//   const {stdout} = await proc
//   expect(stdout).to.contain('A simple templating system.')
// })

// it('Running with a single file as INPUT-PATH should work', async () => {
//   await cliTest(['file-root-relative-include.nancy.txt'], 'file-root-relative-include-expected.txt')
// })

// it('Missing command-line argument should cause an error', async () => {
//   await failingCliTest([], 'the following arguments are required')
// })

// it('Invalid command-line argument should cause an error', async () => {
//   await failingCliTest(['--foo', 'a'], 'unrecognized arguments: --foo')
// })

// it('Running on a non-existent path should cause an error (DEBUG=yes coverage)', async () => {
//   process.env.DEBUG = 'yes'
//   try {
//     await failingCliTest(['a'], "input 'a' does not exist")
//   } finally {
//     delete process.env.DEBUG
//   }
// })

// it('Non-existent --path should cause an error', async () => {
//   await failingCliTest(
//     ['--path', 'nonexistent', 'webpage-src'],
//     'matches no path in the inputs',
//   )
// })

// it('Empty INPUT-PATH should cause an error', async () => {
//   await failingCliTest([''], 'input path must not be empty')
// })
