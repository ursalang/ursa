# Ursa to-do

## Version 0.3

* `Map` interface to internet.
* Structured concurrency: allow the declaration of new scopes, and to run a task in a new scope.
* A generator in a comprehension gives a lazy list/map.

## Ark improvements

* To optimize symbol references, evaluate as much as we can at compile time.
  Any expression with no free variables can be fully evaluated.
* Study vau and first-class environments (objects)
* Make code `readonly`. Start with `FreeVars`.
  See https://github.com/immutable-js/immutable-js/

## Ursa MVP

* Comprehensions: `loop [elem, …]` and `loop {k = v; …}`.
* 100% test coverage.
* Tail recursion elimination
* `self`
* Streams, and use as interface to files.
* Code formatting: have blank lines between top-level multiline `let`s, and
  after the last `use` in a series of `use`s.
* Structs: single-inheritance, data only.
* Unions = enums. (Only way to do union types.)
* Interfaces: methods only.
* Exceptions: `try EXP` is like Lua's `pcall`, and the value is discriminated using a Rust-like `Result` union type. `raise EXP` is like Lua's `error()`.

## Ursa v1

* Inter-working with C. Initial quick-and-dirty version: allow arbitrary C
  APIs to be declared (especially for POSIX; later add GLib introspection),
  and allow C bindings to be generated for Ark values that have C types, and
  any base Ark type.
* Type checking
* Extra `for` sugar where when an object `obj` is given as the iterator,
  `obj.iter()` is automatically used.
* Structs
* Enums
* Traits (use for built-in operators)
* Tuples
* Variadic functions?
* Slices (implement on lists and strings)
* Match statement
* String interpolation
* Long Unicode escapes
* Namespaces
* Macros: use for syntactic sugar to get e.g. `fn a () { }`, and for `+=`
* Module system. Mimic Rust: https://doc.rust-lang.org/rust-by-example/mod/split.html
