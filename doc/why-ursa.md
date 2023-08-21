# Why Ursa?

A lot of code doesn’t need to change a great deal over time. Simple
utilities, personal scripts, games, even complex systems such as
[TeX](https://tug.org).

Most widely-used languages evolve, from FORTRAN to C to Java to Python to
Rust. They balance backwards compatibility and evolution. For writing new
programs or evolving mature code bases, this is good: over time, we can
write clear, correct, concise, fast code more easily.

But some programs are basically finished. They don’t need to change, either
because their use is stable, because they are legacy programs, or, because
games, they are simply *done*. For such programs, it would be good to have a
language that doesn’t change, too.

Some old language standards continue to be supported, such as for C, Ada and
FORTRAN, but those are mostly for old languages, which lack modern
facilities such as a REPL, gradual typing, or running easily on all modern
platforms such as the web. Newer languages’ definitions tend to shift with
time.

Ursa is an attempt to capture the affordances of a circa 2010 programming
language and set them in stone. Hopefully, as C’s creators said of that
language, it will wear well. In 100 years’ time it will certainly feel
antiquated, but hopefully it will not be too painful to read and write (code
that “doesn’t change” of course will). Programmers used to current
mainstream languages such as Java, Python and TypeScript should feel at
home.

The other half is the run-time. Rather than try to create a program that
will run in decades’ time, Ursa will have a simple run-time environment
defined in much the same way as the language. It will specify basic I/O,
rather like the [Z Machine](https://en.wikipedia.org/wiki/Z-machine) does
for interactive fiction, but more like a cut-down web browser.

Finally, Ursa should be comfortable to use. That means, beyond the language
being pleasant, decent editor support, a simple single-command build and
packaging tool, and simple package distribution. To be long-lived, package
distribution will be decentralized.

I will concentrate on making Ursa usable and compatible. It will target
native and web environments. I will not prioritise performance, but it
should be possible to make it perform decently over time, mainly because it
will support static typing.
