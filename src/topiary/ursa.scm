; Topiary queries for Ursa.

; Sometimes we want to indicate that certain parts of our source text should
; not be formatted, but taken as-is. We use the leaf capture name to inform the
; tool of this.
[
  (raw_string_literal)
  (string)
] @leaf

; Allow blank line before
[
  (line_comment)
  (block_comment)
  (statement)
  (member)
] @allow_blank_line_before

; Surround spaces
[
  "and"
  "else"
  "in"
  "or"
  "="
  ":="
] @prepend_space @append_space

(binary_exp (_) _ @prepend_space @append_space (_))

; Append spaces
[
  "await"
  "break"
  (continue)
  "for"
  "if"
  "launch"
  "let"
  "loop"
  "not"
  "return"
  "use"
  "var"
  "yield"
  ":"
] @append_space

; Input softlines before all comments. This means that the input decides if
; a comment should have line breaks before. A line comment always ends with
; a line break.
[
  (block_comment)
  (line_comment)
  "else"
] @prepend_input_softline

; Input softline after block comments unless followed by comma or semicolon, as
; they are always put directly after.
(
  (block_comment) @append_input_softline
  .
  ["," ";"]* @do_nothing
)

; Put on a separate line. If there is a comment following, we don't add anything,
; because the input softlines and spaces above will already have sorted out the
; formatting.
(
  [
    (statement)
    (member)
  ] @prepend_input_softline @append_input_softline
)

(line_comment) @append_hardline

(block_comment) @multi_line_indent_all

; Append softlines, unless followed by comments.
(
  [
    ","
    ";"
  ] @append_spaced_softline
  .
  [(block_comment) (line_comment)]* @do_nothing
)

; Prepend softlines before dots
(_
  "." @prepend_empty_softline
)

; This patterns is duplicated for all nodes that can contain curly braces.
; Hoping to be able to generalise them like this:
; (_
;   .
;   "{" @prepend_space
;   (#for! block declaration_list enum_variant_list field_declaration_list)
; )
; Perhaps even the built in #match! can do this

;; fn
; (fn
;   (identifier) @prepend_space
; )

(block
  .
  "{" @prepend_space
)

(block
  .
  "{" @append_spaced_softline @append_indent_start
  _
  "}" @prepend_spaced_softline @prepend_indent_end
  .
)

(object
  .
  "{" @append_spaced_softline @append_indent_start
  _
  "}" @prepend_spaced_softline @prepend_indent_end
  .
)
