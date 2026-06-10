;; Ursa prelude for Guile
;; © Reuben Thomas 2026
;; Released under the MIT license.

(use-modules
 (ice-9 textual-ports))

;; Aliases for Ursa method names
(define equals eqv?)
(define (notEquals x y) (not (eqv? x y)))
(define lt <)
(define leq <=)
(define gt >)
(define geq >=)
(define add +)
(define neg -)
(define sub -)
(define mul *)
(define div /)
(define mod remainder)
(define len length)
(define (push l o) (append! l `(,o)))
(define (normalize-index l i)
  (let ((len (len l)))
    (if (< i 0) (+ len i) i)))
(define (slice l start end)
  (let ((start+ (normalize-index l start))
        (end+ (normalize-index l end)))
    (list-head (list-tail l start+) (- end+ start+))))
(define toString object->string)

;; Basic facilities
(define (print obj) (display obj) (newline))
(define (write s) (put-string (current-output-port) s))

;; Maths
(define pi (acos -1))
(define infinity +inf.0)
;; Already defined in Guile
;; sqrt
;; exp
;; log
;; sin
;; cos
;; tan

;; Range iterator
(define (range limit)
  (let ((current 0))
    (lambda ()
      (if (eqv? current limit) '()
          (let ((value current))
            (set! current (+ current 1))
            value)))))
