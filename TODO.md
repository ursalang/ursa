# Ursa to-do

## Version 0.2

* Long strings.
* Long comments.
* Lists: iteration (with yield)
* Vectors (this is really current List, for List we need `push`/`pop` etc.).
* Maps: iteration (with yield), symbol keys
* Sets.
* Split into multiple packages (issue #7).
* Map interface to file system and internet.

## Ursa MVP

* 100% test coverage.
* Tail recursion elimination
* Co-routines (copy Python?)
* `self`
* Streams, and use as interface to files.
* Code formatting: `ursa fmt`; use [Prettier](https://prettier.io/).

## Ark improvements

* To optimize symbol references, add `var` (mutable `let`), and
  evaluate as much as we can at compile time. Any expression with no free
  variables can be fully evaluated.
* Make everything objects (arithmetic should be methods of `Num`).
* Study vau, first-class environments (objects), and delimited
  continuations: https://github.com/catseye/Robin ; also see
  https://github.com/nukata/little-scheme-in-typescript
* Make code `readonly` (except `Ref` and `SymRef`). Start with `FreeVars`.
  See https://github.com/immutable-js/immutable-js/

## Ursa v1

* Inter-working with C. Initial quick-and-dirty version: allow arbitrary C
  APIs to be declared (especially for POSIX; later add GLib introspection),
  and allow C bindings to be generated for Ark values that have C types, and
  any base Ark type.
* Type checking
* Structs
* Enums
* Traits (use for built-in operators)
* Classes: properties
* Tuples
* Variadic functions?
* Slices (implement on lists and strings)
* Match statement
* String interpolation
* Raw strings
* Long Unicode escapes
* Namespaces
* Macros: use for syntactic sugar to get e.g. `fn a () { }`, and for `+=`
* Module system. Mimic Rust: https://doc.rust-lang.org/rust-by-example/mod/split.html
