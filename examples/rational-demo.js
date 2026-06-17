// A small exact-arithmetic demo built on a user-defined `Rational` primitive.
//
// What it shows off:
//   - operator overloading: `+ - * / <` read like math on fractions
//   - identity-less value equality: because the constructor normalizes to
//     lowest terms, 1/2 and 2/4 build the *same* slots and are `===`
//   - no boxing: `typeof r === "primitive"`, these are not objects

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

var Rational = new Primitive({
  constructor(p, num, den) {
    if (den === 0) throw new RangeError("zero denominator");
    // Normalize: keep the sign on the numerator, reduce to lowest terms.
    let sign = den < 0 ? -1 : 1;
    let g = gcd(num, den);
    Primitive.setSlot(p, "n", sign * num / g);
    Primitive.setSlot(p, "d", Math.abs(den) / g);
  },
  add(a, b) { return Rational(a.n * b.d + b.n * a.d, a.d * b.d); },
  sub(a, b) { return Rational(a.n * b.d - b.n * a.d, a.d * b.d); },
  mul(a, b) { return Rational(a.n * b.n, a.d * b.d); },
  div(a, b) { return Rational(a.n * b.d, a.d * b.n); },
  lessThan(a, b) { return a.n * b.d < b.n * a.d; },
  toString(r) { return r.d === 1 ? `${r.n}` : `${r.n}/${r.d}`; },
});

var half = Rational(1, 2);
var third = Rational(1, 3);

print("half =", half, " third =", third);

// Normalization happens in the constructor, so distinct constructions of the
// same value reduce to identical slots -- and identity-less equality makes
// them `===`. No `.equals()`, and `2/4` is literally the same value as `1/2`.
assertEq(Rational(2, 4) === half, true);
assertEq(Rational(-1, -2) === half, true);
assertEq(half === third, false);
print("2/4 === 1/2 ?", Rational(2, 4) === half);

// Arithmetic reads like the blackboard. 1/2 + 1/3 = 5/6.
assertEq(half + third === Rational(5, 6), true);
assertEq(half - third === Rational(1, 6), true);
assertEq(half * third === Rational(1, 6), true);
assertEq(half / third === Rational(3, 2), true);
print("1/2 + 1/3 =", half + third);
print("1/2 - 1/3 =", half - third);
print("1/2 * 1/3 =", half * third);
print("1/2 / 1/3 =", half / third);

// Exactness: a third added three times is exactly one, where 0.1+0.2 floats
// would drift. The result reduces to 1/1.
var whole = third + third + third;
assertEq(whole === Rational(1, 1), true);
assertEq(whole.d, 1);
print("1/3 + 1/3 + 1/3 =", whole);

// Relational operators are all derived from the single `lessThan` trap.
assertEq(third < half, true);
assertEq(half > third, true);
assertEq(half <= Rational(2, 4), true);
assertEq(half >= third, true);
print("1/3 < 1/2 ?", third < half);

// Stringification via the toString trap, including the integer case.
assertEq(String(half), "1/2");
assertEq(`${third + third}`, "2/3");
assertEq(String(whole), "1");
print("String(1/2) =", String(half), " String(whole) =", String(whole));

// These are values, not objects.
assertEq(typeof half, "primitive");
assertEq(half instanceof Rational, true);
print("typeof half =", typeof half);

print("All Rational checks passed.");
