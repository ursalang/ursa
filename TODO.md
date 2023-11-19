# Ursa to-do

## Version 0.2

* `range()` iterator, written in Ursa (start of stdlib/prelude).
* Maps: symbol keys
* Sets: use `{ Exp, }` notation, with mandatory first comma.
* Map interface to file system and internet.

## Ursa MVP

* Comprehensions: `loop [ … ]` and `loop {k : v}` (`k:v` being syntactic
  sugar for a pair?).
* Generators and co-routines. A generator in a comprehension gives a lazy
  list/map.
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
  the iterator, `obj.iterator()` is automatically used.
* Structs
* Enums
* Traits (use for built-in operators)
* Classes: properties, names for List, Map and Set
* Tuples
* Variadic functions?
* Slices (implement on lists and strings)
* Match statement
* String interpolation
* Long Unicode escapes
* Namespaces
* Macros: use for syntactic sugar to get e.g. `fn a () { }`, and for `+=`
* Module system. Mimic Rust: https://doc.rust-lang.org/rust-by-example/mod/split.html
