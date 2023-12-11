# Ursa to-do

## Version 0.3

* Map interface to internet.
* Classes: properties, names for List, Map and Set
* Ability to use async JavaScript APIs.
* Generators and co-routines. A generator in a comprehension gives a lazy
  list/map.

# Ark improvements

* To optimize symbol references, add `var` (mutable `let`), and
  evaluate as much as we can at compile time. Any expression with no free
  variables can be fully evaluated.
* Make everything objects (arithmetic should be methods of `Num`).
* Study vau, first-class environments (objects), and delimited
  continuations: https://github.com/catseye/Robin ; also see
  https://github.com/nukata/little-scheme-in-typescript
* Make code `readonly`. Start with `FreeVars`.
  See https://github.com/immutable-js/immutable-js/

## Ursa MVP

* Comprehensions: `loop [ … ]` and `loop {k : v}` (`k:v` being syntactic
  sugar for a pair?).
* 100% test coverage.
* Tail recursion elimination
* Co-routines (copy Python?)
* `self`
* Streams, and use as interface to files.
* Code formatting: `ursa fmt`; use [Prettier](https://prettier.io/).

## Ursa v1

* Inter-working with C. Initial quick-and-dirty version: allow arbitrary C
  APIs to be declared (especially for POSIX; later add GLib introspection),
  and allow C bindings to be generated for Ark values that have C types, and
  any base Ark type.
* Type checking; extra `for` sugar where when an object `obj` is given as
  the iterator, `obj.iter()` is automatically used.
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
