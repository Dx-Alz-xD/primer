// The coding window: the interpreters (assets/js/widgets/code-core.js), what the server keeps
// (server/widgets/code.mjs, through server/widgets.mjs and the lesson checks in server/ai.mjs), and how the
// browser half checks and describes an attempt (assets/js/widgets/code.js, run here without a page).
//   node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const DB = path.join(os.tmpdir(), `primer-code-${process.pid}.db`);
process.env.PRIMER_DB = DB;
test.after(() => { for (const f of [DB, DB + '-wal', DB + '-shm']) rmSync(f, { force: true }); });

const C = createRequire(import.meta.url)('../assets/js/widgets/code-core.js');
const code = await import('../server/widgets/code.mjs');
const widgets = await import('../server/widgets.mjs');
const ai = await import('../server/ai.mjs');

// what a program prints (and its error line, if any)
const py = (src, stdin) => { const r = C.run('python', src, { stdin }); return r.error ? r.stdout + 'ERR ' + r.error.text : r.stdout; };
const js = (src, stdin) => { const r = C.run('javascript', src, { stdin }); return r.error ? r.stdout + 'ERR ' + r.error.text : r.stdout; };
const pyErr = (src, stdin) => C.run('python', src, { stdin }).error;
const lines = (...l) => l.join('\n') + '\n';

/* ---------------- Python ---------------- */

test('python: numbers as Python has them', () => {
  assert.equal(py('print(7 + 3, 7 - 10, 6 * 7, 7 / 2, 7 // 2, 7 % 3)'), '10 -3 42 3.5 3 1\n');
  assert.equal(py('print(-7 // 2, -7 % 3, 7 % -3, 2 ** 10, 2 ** -1, 10 / 5)'), '-4 2 -2 1024 0.5 2.0\n');
  assert.equal(py('print(2 ** 100)'), '1267650600228229401496703205376\n');
  assert.equal(py('print(0.1 + 0.2, 1e16, 1e-5, 3.0, 1/3, -0.0, float("inf"))'), '0.30000000000000004 1e+16 1e-05 3.0 0.3333333333333333 -0.0 inf\n');
  assert.equal(py('print(int("42"), int(" -7 "), int(3.9), int("ff", 16), float("2.5"), int("१२"))'), '42 -7 3 255 2.5 12\n');
  assert.equal(py('print(round(2.5), round(3.5), round(3.14159, 2), round(1234, -2), abs(-4.5), divmod(17, 5))'), '2 4 3.14 1200 4.5 (3, 2)\n');
  assert.equal(py('print(True + True, 1 == 1.0, 10 > 3 > 1, 3 < 2 < 5, 0.1 * 3 == 0.3)'), '2 True True False False\n');
  assert.equal(py('x = 5\nx += 2\nx *= 3\nx -= 1\nx //= 4\nx **= 2\nprint(x)'), '25\n');
  assert.equal(py('print(hex(255), bin(5), oct(8), chr(65), ord("a"), pow(2, 10, 1000))'), '0xff 0b101 0o10 A 97 24\n');
  assert.equal(py('print(sum([0.1] * 10), sum(range(101)), max(3, 9, 2), min([4, 1, 8]))'), '1.0 5050 9 1\n');
});

test('python: strings, slicing, methods and formatting', () => {
  assert.equal(py('s = "Hello, World"\nprint(s[0], s[-1], s[7:], s[:5], s[::-1], s[::2])'), 'H d World Hello dlroW ,olleH Hlo ol\n');
  assert.equal(py('s = "  Mixed Case  "\nprint(s.strip().upper(), s.strip().lower(), s.strip().title(), s.strip().swapcase())'), 'MIXED CASE mixed case Mixed Case mIXED cASE\n');
  assert.equal(py('print("a,b,,c".split(","), "a  b c".split(), "-".join(["x", "y"]), "banana".count("a"), "banana".find("n"), "banana".replace("a", "o", 2))'),
    "['a', 'b', '', 'c'] ['a', 'b', 'c'] x-y 3 2 bonona\n");
  assert.equal(py('print("abc".startswith("ab"), "abc".endswith(("x", "c")), "42".isdigit(), "ab1".isalnum(), "AB".isupper(), "hi".center(6, "*"), "7".zfill(3))'),
    'True True True True True **hi** 007\n');
  assert.equal(py('n = "Asha"\nage = 12\nprint(f"{n} is {age} years old", f"{age * 2}", f"{3.14159:.2f}", f"{n!r}", f"{age=}")'), "Asha is 12 years old 24 3.14 'Asha' age=12\n");
  assert.equal(py('print(f"{7:>4}|{7:<4}|{7:^5}|{7:04d}|{1234567:,}|{0.256:.1%}|{255:x}|{3.5:e}|{\'ab\':*^6}")'),'   7|7   |  7  |0007|1,234,567|25.6%|ff|3.500000e+00|**ab**\n');
  assert.equal(py('print("{} + {} = {}".format(2, 3, 5), "{0}{1}{0}".format("a", "b"), "{name}!".format(name="Hi"), "{:.3f}".format(2/3))'), '2 + 3 = 5 aba Hi! 0.667\n');
  assert.equal(py('print("%d apples cost %.2f" % (3, 4.5), "%s|%5s|%-5s|" % ("x", "y", "z"), "%03d" % 7)'), '3 apples cost 4.50 x|    y|z    | 007\n');
  assert.equal(py('print(len("नमस्ते"), "नमस्ते"[0], "ab" * 3, "x" in "xyz", str(12) + "3", repr("it\'s"))'), '6 न ababab True 123 "it\'s"\n');
  assert.equal(py('print("a\\tb\\\\n", r"a\\n", """two\nlines""")'), 'a\tb\\n a\\n two\nlines\n');
});

test('python: lists, tuples, dicts and sets', () => {
  assert.equal(py('a = [3, 1, 2]\na.append(5)\na.insert(0, 9)\na.remove(1)\nprint(a, a.pop(), a, len(a), a.index(2), 3 in a)'), '[9, 3, 2] 5 [9, 3, 2] 3 2 True\n', 'the same list, printed after pop()');
  assert.equal(py('a = [5, 2, 8, 1]\na.sort()\nb = sorted(a, reverse=True)\na.reverse()\nprint(a, b, sorted(["bb", "a", "ccc"], key=len), a[1:3], a[::-1])'), "[8, 5, 2, 1] [8, 5, 2, 1] ['a', 'bb', 'ccc'] [5, 2] [1, 2, 5, 8]\n");
  assert.equal(py('m = [[0] * 3 for _ in range(2)]\nm[0][1] = 5\nprint(m, [x * x for x in range(6) if x % 2], {x % 3 for x in range(9)}, {k: len(k) for k in ["ab", "c"]})'), "[[0, 5, 0], [0, 0, 0]] [1, 9, 25] {0, 1, 2} {'ab': 2, 'c': 1}\n");
  assert.equal(py('t = (1, 2, 3)\na, b, c = t\nfirst, *rest = [1, 2, 3, 4]\nx, y = 1, 2\nx, y = y, x\nprint(t, a + c, first, rest, x, y, (5,), t.count(2))'), '(1, 2, 3) 4 1 [2, 3, 4] 2 1 (5,) 1\n');
  assert.equal(py('d = {"a": 1}\nd["b"] = 2\nd.update(c=3)\nprint(d, d.get("z"), d.get("z", 0), list(d.keys()), list(d.values()), list(d.items())[0], "a" in d, len(d))'), "{'a': 1, 'b': 2, 'c': 3} None 0 ['a', 'b', 'c'] [1, 2, 3] ('a', 1) True 3\n");
  assert.equal(py('d = {"x": 1, "y": 2}\nfor k, v in d.items():\n    print(k, v)\nprint(d.pop("x"), d, d.setdefault("z", 9), d)'), "x 1\ny 2\n1 {'y': 2, 'z': 9} 9 {'y': 2, 'z': 9}\n");
  assert.equal(py('s = {3, 1, 2}\ns.add(2)\ns.add(4)\nprint(s, s & {1, 4, 7}, s | {9}, s - {1}, {1, 2} <= s, set(), len(s))'), '{1, 2, 3, 4} {1, 4} {1, 2, 3, 4, 9} {2, 3, 4} True set() 4\n');
  assert.equal(py('a = [1, 2]\nb = a\nb.append(3)\nc = a.copy()\nc.append(4)\nprint(a, c, a == [1, 2, 3], a is b, a is c, [1, [2]] < [1, [3]])'), '[1, 2, 3] [1, 2, 3, 4] True True False True\n');
  assert.equal(py('print(list(range(5)), list(range(2, 10, 3)), list(range(5, 0, -2)), list(reversed([1, 2, 3])), list(enumerate("ab", 1)), list(zip("ab", [1, 2, 3])))'),
    "[0, 1, 2, 3, 4] [2, 5, 8] [5, 3, 1] [3, 2, 1] [(1, 'a'), (2, 'b')] [('a', 1), ('b', 2)]\n");
  assert.equal(py('print(list(map(int, "1 2 3".split())), list(filter(lambda x: x > 1, [0, 1, 2, 3])), any([0, 1]), all([1, 0]), sum(x for x in range(4)))'), '[1, 2, 3] [2, 3] True False 6\n');
  assert.equal(py('print(isinstance(3, int), isinstance(True, int), isinstance(2.0, (int, float)), type(3), type("a").__name__, type([]) == list, bool([]), bool("x"))'),
    "True True True <class 'int'> str True False True\n");
});

test('python: control flow', () => {
  assert.equal(py('for x in [5, 15, 25]:\n    if x < 10:\n        print("small")\n    elif x < 20:\n        print("medium")\n    else:\n        print("big")'), lines('small', 'medium', 'big'));
  assert.equal(py('for i in range(10):\n    if i == 2:\n        continue\n    if i == 5:\n        break\n    print(i)\nelse:\n    print("never")'), lines('0', '1', '3', '4'));
  assert.equal(py('n = 0\nwhile n < 3:\n    n += 1\nelse:\n    print("done", n)'), 'done 3\n');
  assert.equal(py('for i in range(1, 4):\n    for j in range(1, 4):\n        if j > i:\n            break\n        print(i * j, end=" ")\n    print()'), '1 \n2 4 \n3 6 9 \n');
  assert.equal(py('x = 7\nprint("odd" if x % 2 else "even")\nif not x == 3 and (x > 5 or x < 0):\n    print("yes")\npass'), 'odd\nyes\n');
  assert.equal(py('print(1, 2, 3, sep="-")\nprint("a", end="")\nprint("b")\nprint()'), '1-2-3\nab\n\n');
});

test('python: functions, recursion, lambda, closures, global and nonlocal', () => {
  assert.equal(py('def greet(name, greeting="Hello"):\n    return f"{greeting}, {name}!"\nprint(greet("Ravi"), greet("Ravi", "Hi"), greet(greeting="Yo", name="Mia"))'), 'Hello, Ravi! Hi, Ravi! Yo, Mia!\n');
  assert.equal(py('def total(*nums, scale=1):\n    return sum(nums) * scale\ndef info(**kw):\n    return sorted(kw)\nprint(total(1, 2, 3), total(1, 2, scale=10), info(b=1, a=2), total(*[4, 5]))'), "6 30 ['a', 'b'] 9\n");
  assert.equal(py('def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\nprint(fact(20), fib(15))'), '2432902008176640000 610\n');
  assert.equal(py('sq = lambda x: x * x\nprint(sq(5), list(map(lambda a: a + 1, [1, 2])), sorted([(1, "b"), (0, "a")], key=lambda p: p[1]))'), "25 [2, 3] [(0, 'a'), (1, 'b')]\n");
  assert.equal(py('def counter():\n    count = 0\n    def inc():\n        nonlocal count\n        count += 1\n        return count\n    return inc\nc = counter()\nc()\nprint(c())'), '2\n');
  assert.equal(py('score = 0\ndef add(n):\n    global score\n    score += n\nadd(5)\nadd(2)\nprint(score)'), '7\n');
  assert.equal(py('def f():\n    pass\nprint(f(), f.__name__)\ndef g(x):\n    return\nprint(g(1))'), 'None f\nNone\n');
  assert.equal(py('def apply(f, x):\n    return f(x)\nprint(apply(len, "abc"), apply(str.upper, "abc"))'), '3 ABC\n');
  assert.equal(py('if __name__ == "__main__":\n    print("main")'), 'main\n');
});

test('python: exceptions', () => {
  assert.equal(py('try:\n    x = 1 / 0\nexcept ZeroDivisionError as e:\n    print("caught:", e)\nelse:\n    print("no")\nfinally:\n    print("finally")'), 'caught: division by zero\nfinally\n');
  assert.equal(py('try:\n    int("abc")\nexcept (TypeError, ValueError) as e:\n    print(type(e).__name__, e)'), "ValueError invalid literal for int() with base 10: 'abc'\n");
  assert.equal(py('class TooBig(Exception):\n    pass\ntry:\n    raise TooBig("over 100")\nexcept Exception as e:\n    print(repr(e), e.args)'), "TooBig('over 100') ('over 100',)\n");
  assert.equal(py('def check(n):\n    if n < 0:\n        raise ValueError("negative")\n    return n\ntry:\n    check(-1)\nexcept ValueError as err:\n    print("Error:", err)'), 'Error: negative\n');
  assert.equal(py('try:\n    try:\n        [][1]\n    except KeyError:\n        print("no")\nexcept IndexError as e:\n    print("outer", e)'), 'outer list index out of range\n');
  assert.equal(py('d = {}\ntry:\n    d["k"]\nexcept KeyError as e:\n    print("missing", e)\ntry:\n    raise\nexcept RuntimeError:\n    print("re")'), "missing 'k'\nre\n");
  assert.equal(py('def f():\n    try:\n        return "try"\n    finally:\n        print("cleanup")\nprint(f())'), 'cleanup\ntry\n');
  assert.equal(py('assert 1 + 1 == 2\nassert 1 > 2, "maths is broken"'), 'ERR Line 2: AssertionError: maths is broken');
});

test('python: classes', () => {
  const src = [
    'class Animal:',
    '    legs = 4',
    '    def __init__(self, name):',
    '        self.name = name',
    '    def speak(self):',
    '        return "..."',
    '    def __str__(self):',
    '        return f"{self.name} ({type(self).__name__})"',
    'class Dog(Animal):',
    '    def speak(self):',
    '        return "Woof"',
    'class Puppy(Dog):',
    '    def __init__(self, name, age):',
    '        super().__init__(name)',
    '        self.age = age',
    '    def speak(self):',
    '        return super().speak() + "!"',
    'p = Puppy("Rex", 1)',
    'print(p, p.speak(), p.legs, p.age, isinstance(p, Animal), Dog.legs)',
    'p.legs = 3',
    'print(p.legs, Animal.legs, hasattr(p, "age"), getattr(p, "x", "none"))'
  ].join('\n');
  assert.equal(py(src), 'Rex (Puppy) Woof! 4 1 True 4\n3 4 True none\n');
  assert.equal(py('class P:\n    def __init__(self, x, y):\n        self.x, self.y = x, y\n    def __eq__(self, o):\n        return self.x == o.x and self.y == o.y\n    def __add__(self, o):\n        return P(self.x + o.x, self.y + o.y)\n    def __repr__(self):\n        return f"P({self.x}, {self.y})"\n    def __lt__(self, o):\n        return self.x < o.x\nprint(P(1, 2) + P(3, 4), P(1, 2) == P(1, 2), sorted([P(3, 0), P(1, 0)]), [P(0, 0)])'),
    'P(4, 6) True [P(1, 0), P(3, 0)] [P(0, 0)]\n');
  assert.match(py('class C:\n    def __init__(self):\n        self._v = 1\n    @property\n    def v(self):\n        return self._v * 10\n    @staticmethod\n    def s(a):\n        return a + 1\n    @classmethod\n    def make(cls):\n        return cls()\nprint(C().v, C.s(1), type(C.make()).__name__, C())'),
    /^10 2 C <__main__\.C object at 0x[0-9a-f]+>\n$/);
  assert.equal(py('class Stack:\n    def __init__(self):\n        self.items = []\n    def push(self, x):\n        self.items.append(x)\n    def __len__(self):\n        return len(self.items)\ns = Stack()\ns.push(1)\ns.push(2)\nprint(len(s), bool(s), s.items)'), '2 True [1, 2]\n');
  assert.equal(py('class A:\n    pass\nA(1)'), 'ERR Line 3: TypeError: A() takes no arguments');
  assert.equal(py('class Dog:\n    def bark(self):\n        return "w"\nDog().bake()'), "ERR Line 4: AttributeError: 'Dog' object has no attribute 'bake'. Did you mean: 'bark'?");
});

test('python: the modules math, random, string and time', () => {
  assert.equal(py('import math\nprint(math.sqrt(16), math.pi, math.floor(2.7), math.ceil(2.1), math.factorial(6), math.gcd(12, 18), math.isqrt(17))'), '4.0 3.141592653589793 2 3 720 6 4\n');
  assert.equal(py('from math import sin, cos, radians, log, hypot\nprint(round(sin(radians(30)), 2), cos(0), log(100, 10), hypot(3, 4))'), '0.5 1.0 2.0 5.0\n');
  assert.equal(py('import math\nmath.sqrt(-1)'), 'ERR Line 2: ValueError: math domain error');
  const r1 = py('import random\nprint([random.randint(1, 6) for _ in range(5)], random.choice("abc"))');
  assert.equal(py('import random\nprint([random.randint(1, 6) for _ in range(5)], random.choice("abc"))'), r1, 'random is seeded: the same every run');
  assert.match(r1, /^\[[1-6], [1-6], [1-6], [1-6], [1-6]\] [abc]\n$/);
  assert.equal(py('import random\nrandom.seed(5)\na = random.random()\nrandom.seed(5)\nprint(a == random.random(), 0 <= a < 1)\nx = [1, 2, 3, 4]\nrandom.shuffle(x)\nprint(sorted(x))'), 'True True\n[1, 2, 3, 4]\n');
  assert.equal(py('import string\nprint(string.ascii_lowercase[:5], string.digits)\nimport time\ntime.sleep(1)\nprint("ok")'), 'abcde 0123456789\nok\n');
  assert.equal(py('import numpy'), "ERR Line 1: ModuleNotFoundError: No module named 'numpy' (only math, random, string, time and turtle are available here)");
});

test('python: the turtle draws, as a list of lines, dots and fills', () => {
  const r = C.run('python', 'import turtle\nt = turtle.Turtle()\nt.color("red", "yellow")\nt.begin_fill()\nfor i in range(4):\n    t.forward(100)\n    t.left(90)\nt.end_fill()\nt.penup()\nt.goto(0, -50)\nt.pendown()\nt.circle(30)\nt.dot(10, "blue")\nprint(round(t.xcor()), round(t.ycor()), t.heading())');
  assert.equal(r.error, null);
  assert.equal(r.stdout, '0 -50 0.0\n');
  const ops = r.turtle.ops;
  const linesDrawn = ops.filter((o) => o.o === 'line');
  assert.ok(linesDrawn.length > 4);
  assert.deepEqual([linesDrawn[0].x2, Math.round(linesDrawn[1].y2)], [100, 100]);
  assert.equal(linesDrawn[0].c, 'red');
  const fill = ops.find((o) => o.o === 'fill');
  assert.equal(fill.c, 'yellow');
  assert.equal(fill.pts.length, 5);
  assert.ok(ops.some((o) => o.o === 'dot' && o.c === 'blue'));
  assert.equal(py('import turtle\nturtle.forward(10)\nturtle.color("bad colour!")'), "ERR Line 3: TurtleGraphicsError: bad color string: bad colour!");
  // module-level turtle functions use one turtle
  assert.equal(C.run('python', 'from turtle import *\nforward(50)\nright(90)\nforward(50)\ndone()').turtle.ops.filter((o) => o.o === 'line').length, 2);
});

test('python: errors read like Python\'s last line, with the line number', () => {
  assert.equal(pyErr('total = 0\nfor i in range(3):\n    total += i\nprint(totl)').text, "Line 4: NameError: name 'totl' is not defined. Did you mean: 'total'?");
  assert.equal(pyErr('print("Age: " + 12)').text, 'Line 1: TypeError: can only concatenate str (not "int") to str');
  assert.equal(pyErr('x = 5 + "a"').text, "Line 1: TypeError: unsupported operand type(s) for +: 'int' and 'str'");
  assert.equal(pyErr('a = [1, 2]\nprint(a[2])').text, 'Line 2: IndexError: list index out of range');
  assert.equal(pyErr('print(10 % 0)').text, 'Line 1: ZeroDivisionError: integer modulo by zero');
  assert.equal(pyErr('n = int("3.5")').text, "Line 1: ValueError: invalid literal for int() with base 10: '3.5'");
  assert.equal(pyErr('x = [1]\nx.push(2)').text, "Line 2: AttributeError: 'list' object has no attribute 'push'");
  assert.equal(pyErr('count = 0\ndef inc():\n    count += 1\ninc()').text, "Line 3: UnboundLocalError: cannot access local variable 'count' where it is not associated with a value");
  assert.equal(pyErr('def f(a, b):\n    return a\nf(1)').text, "Line 3: TypeError: f() missing 1 required positional argument: 'b'");
  assert.equal(pyErr('def f(a):\n    return a\nf(1, 2)').text, 'Line 3: TypeError: f() takes 1 positional argument but 2 were given');
  assert.equal(pyErr('len(5)').text, "Line 1: TypeError: object of type 'int' has no len()");
  assert.equal(pyErr('"abc"[0] = "x"').text, "Line 1: TypeError: 'str' object does not support item assignment");
  assert.equal(pyErr('for x in 5:\n    pass').text, "Line 1: TypeError: 'int' object is not iterable");
  assert.equal(pyErr('def f():\n    return g()\ndef g():\n    return 1 / 0\nf()').text, 'Line 4: ZeroDivisionError: division by zero', 'the line where it was raised');
  assert.equal(pyErr('print(sorted([1, "a"]))').text, "Line 1: TypeError: '<' not supported between instances of 'str' and 'int'");
});

test('python: syntax errors, found before the program runs', () => {
  const syn = (src) => { const e = pyErr(src); assert.equal(e.kind, 'syntax'); return e.text; };
  assert.equal(syn('if x > 3\n    print(x)'), "Line 1: SyntaxError: expected ':'");
  assert.equal(syn('x = 5\nif x > 3:\nprint("big")'), "Line 3: IndentationError: expected an indented block after 'if' statement on line 2");
  assert.equal(syn('print("hi")\n    print("there")'), 'Line 2: IndentationError: unexpected indent');
  assert.equal(syn('if True:\n        a = 1\n    b = 2'), 'Line 3: IndentationError: unindent does not match any outer indentation level');
  assert.equal(syn('print("hi"'), "Line 1: SyntaxError: '(' was never closed");
  assert.equal(syn('print "hi"'), "Line 1: SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?");
  assert.equal(syn('if x = 5:\n    pass'), "Line 1: SyntaxError: invalid syntax. Maybe you meant '==' or ':=' instead of '='?");
  assert.equal(syn('print(\u201chi\u201d)'), "Line 1: SyntaxError: invalid character '\u201c' (U+201C): use straight quotes, ' or \"");
  assert.equal(syn('s = "open'), 'Line 1: SyntaxError: unterminated string literal (detected at line 1)');
  assert.equal(syn('break'), "Line 1: SyntaxError: 'break' outside loop");
  assert.equal(syn('return 5'), "Line 1: SyntaxError: 'return' outside function");
  assert.equal(syn('5 = x'), "Line 1: SyntaxError: cannot assign to literal here. Maybe you meant '==' instead of '='?");
  assert.equal(syn('def f():\n    yield 1'), "Line 2: SyntaxError: 'yield' (generators) is not available here: build a list instead");
  assert.equal(syn('print(1 2)'), 'Line 1: SyntaxError: invalid syntax. Perhaps you forgot a comma?');
});

test('python: input() takes the lines in turn; its prompts are not part of what is printed', () => {
  const r = C.run('python', 'name = input("Name: ")\nage = int(input("Age: "))\nprint(f"{name} will be {age + 1}")', { stdin: 'Asha\n11' });
  assert.equal(r.stdout, 'Asha will be 12\n');
  assert.deepEqual(r.out.map((c) => c.k), ['prompt', 'echo', 'prompt', 'echo', 'out']);
  assert.equal(r.inputs, 2);
  assert.equal(r.asked, true);
  const e = pyErr('a = input()\nb = input()', '5');
  assert.equal(e.kind, 'eof');
  assert.equal(e.line, 2);
  assert.equal(py('nums = list(map(int, input().split()))\nprint(sum(nums))', '3 4 5'), '12\n');
});

test('limits: a loop that never ends, deep recursion, too much output, things too big', () => {
  const t0 = Date.now();
  const loop = C.run('python', 'while True:\n    pass', { steps: 200000 });
  assert.equal(loop.error.kind, 'timeout');
  assert.equal(loop.error.text, 'Your program ran for too long. Is there a loop that never ends?');
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(C.run('javascript', 'for (;;) {}', { steps: 200000 }).error.kind, 'timeout');
  assert.equal(C.run('python', 'x = 0\nwhile x >= 0:\n    x += 1\n    print(x)', { output: 5000 }).error.kind, 'output');
  const deep = C.run('python', 'def f(n):\n    return f(n + 1)\nf(0)');
  assert.equal(deep.error.kind, 'depth');
  assert.equal(deep.error.text, 'Line 2: RecursionError: maximum recursion depth exceeded');
  assert.equal(C.run('javascript', 'function f(n) { return f(n + 1); }\nf(0);').error.text, 'Line 1: RangeError: Maximum call stack size exceeded');
  assert.equal(py('def f(n):\n    return 0 if n == 0 else 1 + f(n - 1)\nprint(f(300))'), '300\n', 'ordinary recursion is fine');
  assert.equal(C.run('python', 'x = [0] * 10**8').error.kind, 'memory');
  assert.equal(C.run('python', 's = "ab" * 10**8').error.kind, 'memory');
  assert.equal(pyErr('print(2 ** 10**7)').type, 'OverflowError');
  assert.equal(C.run('python', 'print(list(range(10**9)))').error.kind, 'memory');
  // the budget counts steps, not time: the same program stops at the same place every time
  const a = C.run('python', 'i = 0\nwhile True:\n    i += 1', { steps: 5000 }), b = C.run('python', 'i = 0\nwhile True:\n    i += 1', { steps: 5000 });
  assert.equal(a.steps, b.steps);
});

test('python: nothing of the host can be reached', () => {
  assert.equal(pyErr('open("x.txt")').type, 'OSError');
  assert.equal(pyErr('eval("1+1")').text, 'Line 1: NotImplementedError: eval() is not available here');
  assert.equal(pyErr('import os').type, 'ModuleNotFoundError');
  assert.equal(pyErr('().__class__.__bases__[0].__subclasses__()').type, 'AttributeError');
  assert.equal(py('print(type(print), type(len).__name__)'), "<class 'builtin_function_or_method'> builtin_function_or_method\n");
});

/* ---------------- JavaScript ---------------- */

test('javascript: declarations, functions, arrows and closures', () => {
  assert.equal(js('let a = 5;\nconst b = 2;\nvar c = a * b;\nconsole.log(a + b, a - b, a / b, a % b, a ** b, c)'), '7 3 2.5 1 25 10\n');
  assert.equal(js('function add(x, y = 10) { return x + y; }\nconst sq = (n) => n * n;\nconst twice = f => x => f(f(x));\nconsole.log(add(1), add(1, 2), sq(4), twice(sq)(3))'), '11 3 16 81\n');
  assert.equal(js('function counter() { let n = 0; return () => ++n; }\nconst c = counter();\nc(); c();\nconsole.log(c())'), '3\n');
  assert.equal(js('console.log(hoisted());\nfunction hoisted() { return "up"; }'), 'up\n');
  assert.equal(js('const fns = [];\nfor (let i = 0; i < 3; i++) fns.push(() => i);\nconsole.log(fns.map(f => f()).join(","))'), '0,1,2\n');
  assert.equal(js('function sum(...nums) { return nums.reduce((a, b) => a + b, 0); }\nconsole.log(sum(1, 2, 3), sum(...[4, 5]), Math.max(...[3, 9]))'), '6 9 9\n');
  assert.equal(js('const fact = n => n <= 1 ? 1 : n * fact(n - 1);\nconsole.log(fact(10))'), '3628800\n');
});

test('javascript: control flow', () => {
  assert.equal(js('for (let i = 0; i < 6; i++) {\n  if (i === 1) continue;\n  if (i === 4) break;\n  console.log(i);\n}'), lines('0', '2', '3'));
  assert.equal(js('let n = 0;\nwhile (n < 3) { n++; }\ndo { n += 10; } while (n < 5);\nconsole.log(n)'), '13\n');
  assert.equal(js('for (const x of [1, 2]) console.log(x);\nfor (const ch of "hi") console.log(ch);\nfor (const k in {a: 1, b: 2}) console.log(k);'), lines('1', '2', 'h', 'i', 'a', 'b'));
  assert.equal(js('function grade(m) {\n  if (m >= 90) { return "A"; } else if (m >= 75) { return "B"; } else { return "C"; }\n}\nconsole.log(grade(95), grade(80), grade(10))'), 'A B C\n');
  assert.equal(js('const day = 2;\nswitch (day) {\n  case 1: console.log("Mon"); break;\n  case 2: console.log("Tue");\n  case 3: console.log("Wed"); break;\n  default: console.log("?");\n}'), lines('Tue', 'Wed'));
  assert.equal(js('const x = 5;\nconsole.log(x > 3 ? "big" : "small", x > 3 && x < 10, null ?? "d", 0 || "f", "5" == 5, "5" === 5)'), 'big true d f true false\n');
  assert.equal(js('let s = 0\nfor (let i = 1; i <= 3; i++) s += i\nconsole.log(s)'), '6\n', 'semicolons are optional');
});

test('javascript: arrays, objects, strings, numbers, Math and JSON', () => {
  assert.equal(js('const a = [5, 1, 4];\na.push(2);\nconsole.log(a, a.length, a.indexOf(4), a.includes(9), a.slice(1, 3), [...a].sort((x, y) => x - y), a.join("-"))'), '[ 5, 1, 4, 2 ] 4 2 false [ 1, 4 ] [ 1, 2, 4, 5 ] 5-1-4-2\n');
  assert.equal(js('const a = [1, 2, 3, 4];\nconsole.log(a.map(x => x * 2), a.filter(x => x % 2 === 0), a.reduce((s, x) => s + x), a.find(x => x > 2), a.some(x => x > 3), a.every(x => x > 0))'), '[ 2, 4, 6, 8 ] [ 2, 4 ] 10 3 true true\n');
  assert.equal(js('console.log([10, 9, 1].sort(), [3, 1, 2].reverse(), [[1, 2], [3]].flat(), Array.from({length: 3}, (_, i) => i * i), [1, 2, 3].splice(1, 1))'), '[ 1, 10, 9 ] [ 2, 1, 3 ] [ 1, 2, 3 ] [ 0, 1, 4 ] [ 2 ]\n');
  assert.equal(js('const p = {name: "Ravi", age: 12};\np.city = "Pune";\ndelete p.age;\nconsole.log(p, Object.keys(p), p["name"], "age" in p, p.zip)'), "{ name: 'Ravi', city: 'Pune' } [ 'name', 'city' ] Ravi false undefined\n");
  assert.equal(js('const {name, ...rest} = {name: "a", x: 1, y: 2};\nlet [p, q] = [1, 2];\n[p, q] = [q, p];\nconsole.log(name, rest, p, q, {...rest, z: 3})'), "a { x: 1, y: 2 } 2 1 { x: 1, y: 2, z: 3 }\n");
  assert.equal(js('const s = "Hello, World";\nconsole.log(s.length, s.toUpperCase(), s.slice(-5), s.split(", "), s.includes("lo"), s.replace("l", "L"), s.replaceAll("l", "L"), s.indexOf("o"), s.at(-1))'),
    "12 HELLO, WORLD World [ 'Hello', 'World' ] true HeLlo, World HeLLo, WorLd 4 d\n");
  assert.equal(js('const n = 7;\nconsole.log(`${n} squared is ${n * n}`, "x".repeat(3), "5".padStart(3, "0"), "  t ".trim() + "|")'), '7 squared is 49 xxx 005 t|\n');
  assert.equal(js('console.log((1 / 3).toFixed(2), (255).toString(16), Number("3.5"), parseInt("42px"), parseFloat("2.5kg"), Number.isInteger(5), String(12) + 1, 0.1 + 0.2)'), '0.33 ff 3.5 42 2.5 true 121 0.30000000000000004\n');
  assert.equal(js('console.log(Math.max(3, 8), Math.floor(4.7), Math.round(2.5), Math.abs(-3), Math.sqrt(81), Math.PI.toFixed(4), Math.min())'), '8 4 3 3 9 3.1416 Infinity\n');
  assert.equal(js('const o = JSON.parse(\'{"a": [1, 2], "b": null}\');\nconsole.log(o.a[1], JSON.stringify(o), JSON.stringify([1, "x"]))'), '2 {"a":[1,2],"b":null} [1,"x"]\n');
  assert.equal(js('const m = new Map([["a", 1]]);\nm.set("b", 2);\nconst s = new Set([1, 1, 2]);\nconsole.log(m.get("b"), m.size, s.has(2), s.size, [...s], m)'), "2 2 true 2 [ 1, 2 ] Map(2) { 'a' => 1, 'b' => 2 }\n");
  assert.equal(js('console.log(typeof 1, typeof "a", typeof null, typeof undefined, typeof [], typeof (() => 1), [1, 2] + "", 1 + "2", "3" * "4")'), 'number string object undefined object function 1,2 12 12\n');
});

test('javascript: errors, try/catch and throw', () => {
  assert.equal(js('let total = 1;\nconsole.log(totl);'), "ERR Line 2: ReferenceError: totl is not defined. Did you mean 'total'?");
  assert.equal(js('const x = 1;\nx = 2;'), 'ERR Line 2: TypeError: Assignment to constant variable.');
  assert.equal(js('const o = {};\no.run();'), 'ERR Line 2: TypeError: o.run is not a function');
  assert.equal(js('let u;\nconsole.log(u.length);'), "ERR Line 2: TypeError: Cannot read properties of undefined (reading 'length')");
  assert.equal(js('console.log(a);\nlet a = 1;'), "ERR Line 1: ReferenceError: Cannot access 'a' before initialization");
  assert.equal(js('try {\n  throw new Error("bad input");\n} catch (e) {\n  console.log(e.message, e.name, e instanceof Error);\n} finally {\n  console.log("done");\n}'), 'bad input Error true\ndone\n');
  assert.equal(js('function check(n) { if (n < 0) throw new RangeError("negative"); return n; }\ncheck(-1);'), 'ERR Line 1: RangeError: negative');
  assert.equal(js('throw "oops"'), "ERR Line 1: Uncaught: 'oops'");
  const syn = C.run('javascript', 'let x = (1 + 2;').error;
  assert.equal(syn.kind, 'syntax');
  assert.match(syn.text, /^Line 1: SyntaxError: Unexpected token ';'/);
  assert.match(C.run('javascript', 'const s = "a".match(/a/);').error.text, /Regular expressions/);
  assert.match(C.run('javascript', 'class A {}').error.text, /classes are not available/);
});

test('javascript: prompt() reads the input lines; nothing of the host can be reached', () => {
  const r = C.run('javascript', 'const a = Number(prompt("First?"));\nconst b = Number(prompt("Second?"));\nconsole.log(a + b);', { stdin: '3\n4' });
  assert.equal(r.stdout, '7\n');
  assert.deepEqual(r.out.map((c) => c.k), ['prompt', 'echo', 'prompt', 'echo', 'out']);
  assert.equal(C.run('javascript', 'prompt(); prompt();', { stdin: '1' }).error.kind, 'eof');
  assert.equal(js('console.log([].constructor, ({}).constructor, "".constructor, (() => 1).constructor, this, typeof globalThis.process)'), 'undefined undefined undefined undefined undefined undefined\n');
  assert.match(js('setTimeout(() => 1, 10)'), /ReferenceError: setTimeout is not available here/);
  assert.match(js('new Function("return 1")'), /not a constructor|not available/);
  assert.match(js('fetch("/x")'), /not available here/);
});

/* ---------------- comparing what was printed, and running tests ---------------- */

test('output is compared line by line: end spaces and blank lines at the end don\'t count, numbers by value', () => {
  assert.ok(C.sameOutput('7\n', '7'));
  assert.ok(C.sameOutput('a b  \nc\n\n\n', 'a b\nc'));
  assert.ok(C.sameOutput('7.0', '7'));
  assert.ok(C.sameOutput('Total: 0.30000000000000004', 'Total: 0.3'));
  assert.ok(!C.sameOutput(' *\n***', '*\n***'), 'spaces at the start of a line count (patterns)');
  assert.ok(!C.sameOutput('7\n8', '7'));
  assert.ok(!C.sameOutput('hello', 'Hello'));
  assert.ok(!C.sameOutput('3.33', '3.3333333'), 'a rounded number is a different answer');
  assert.deepEqual(C.outputDiff('1\n2\n4', '1\n2\n3'), { line: 2, got: '4', want: '3', gotLines: 3, wantLines: 3 });
});

test('runTests: output tests and function tests, with what went wrong', () => {
  const out = { type: 'output', tests: [{ stdin: '3\n4', stdout: '7' }, { stdin: '10\n-2', stdout: '8' }] };
  assert.equal(C.runTests('python', out, 'print(int(input()) + int(input()))').passed, 2);
  const bad = C.runTests('python', out, 'print(input() + input())');
  assert.equal(bad.passed, 0);
  assert.deepEqual([bad.results[0].why, bad.results[0].got], ['output', '34\n']);
  assert.equal(C.runTests('python', out, 'print(').syntax.kind, 'syntax');
  assert.equal(C.runTests('python', out, 'while True: pass', { steps: 10000 }).results[0].error.kind, 'timeout');
  const fn = { type: 'function', name: 'area', tests: [{ args: [3, 4], returns: 12 }, { args: [2.5, 2], returns: 5 }] };
  assert.equal(C.runTests('python', fn, 'def area(w, h):\n    return w * h').passed, 2);
  assert.equal(C.runTests('javascript', fn, 'const area = (w, h) => w * h;').passed, 2);
  const wrong = C.runTests('python', fn, 'def area(w, h):\n    return w + h', { stop: true });
  assert.equal(wrong.results.length, 1, 'stops at the first that fails');
  assert.deepEqual([wrong.results[0].call, wrong.results[0].got, wrong.results[0].want], ['area(3, 4)', '7', '12']);
  assert.equal(C.runTests('python', fn, 'def aera(w, h):\n    return w * h').results[0].why, 'missing');
  // values: lists and tuples, dicts, sets, floats within a tolerance, booleans and None
  const vals = (src, returns, args = []) => C.runTests('python', { type: 'function', name: 'f', tests: [{ args, returns }] }, src).passed === 1;
  assert.ok(vals('def f():\n    return (1, 2)', [1, 2]));
  assert.ok(vals('def f():\n    return {"a": [1]}', { a: [1] }));
  assert.ok(vals('def f():\n    return {3, 1}', [1, 3]));
  assert.ok(vals('def f():\n    return 0.1 + 0.2', 0.3));
  assert.ok(vals('def f():\n    return None', null));
  assert.ok(!vals('def f():\n    return 1', true), 'True is not 1 here');
  assert.ok(!vals('def f():\n    return "12"', 12));
  assert.equal(C.shown('python', [true, null, 'a']), "[True, None, 'a']");
  assert.equal(C.callText('javascript', 'f', ['a', [1]]), "f('a', [ 1 ])");
  assert.equal(C.stub('python', 'def area(w, h):\n    return w * h', 'area'), 'def area(w, h):\n    # Write your code here\n    pass\n');
});

/* ---------------- the server ---------------- */

const EX = { language: 'python', code: 'n = 5\nfor i in range(1, n + 1):\n    print(i, i * i)' };
const FIX = { language: 'python', code: 'a = input()\nb = input()\nprint(a + b)' };
const FIX_GOAL = { type: 'output', tests: [{ stdin: '3\n4', stdout: '7' }, { stdin: '10\n-2', stdout: '8' }], solution: 'a = int(input())\nb = int(input())\nprint(a + b)' };
const FN_GOAL = { type: 'function', name: 'area', tests: [{ args: [3, 4], returns: 12 }, { args: [2.5, 2], returns: 5 }], solution: 'def area(w, h):\n    return w * h' };

test('server: a block is a runnable example, made tidy', () => {
  assert.deepEqual(code.block(EX), EX);
  assert.deepEqual(code.block({ language: 'py', code: '```python\nprint("hi")\n```' }), { language: 'python', code: 'print("hi")' });
  assert.deepEqual(code.block({ language: 'python', code: 'x = 3\\nprint(x * 2)' }), { language: 'python', code: 'x = 3\nprint(x * 2)' }, 'new lines written out are read');
  assert.deepEqual(code.block({ language: 'python', code: 'name = input()\nprint("Hi", name)', stdin: ['Asha'] }), { language: 'python', code: 'name = input()\nprint("Hi", name)', stdin: 'Asha' });
  assert.deepEqual(code.block({ language: 'python', code: 'print(1)', stdin: '5' }), { language: 'python', code: 'print(1)' }, 'input a program never reads is dropped');
  assert.deepEqual(code.block({ code: 'console.log("x");' }), { language: 'javascript', code: 'console.log("x");' }, 'the language worked out from the code');
  assert.ok(code.block({ language: 'python', code: 'import turtle\nturtle.forward(50)' }), 'a turtle drawing counts as something to see');
});

test('server: why() says why a block is left out, in words the AI can act on', () => {
  assert.equal(code.why(EX), '');
  assert.equal(code.why({ language: 'python', code: 'if x > 3\n    print(x)' }), "the code has a syntax error: Line 1: SyntaxError: expected ':'");
  assert.equal(code.why({ language: 'python', code: 'total = 0\nprint(totl)' }), "the example stops with an error: Line 2: NameError: name 'totl' is not defined. Did you mean: 'total'? Fix the code (to show an error on purpose, catch it with try/except and print a message)");
  assert.equal(code.why({ language: 'python', code: 'a = input()\nb = input()\nprint(a, b)', stdin: '1' }), 'the example reads more lines with input() than "stdin" gives: add them to "stdin", one per line');
  assert.match(code.why({ language: 'python', code: 'while True:\n    x = 1' }), /^the example ran for too long/);
  assert.equal(code.why({ language: 'python', code: 'x = 5' }), 'the example prints nothing: print something so the learner sees what it does');
  assert.equal(code.why({ language: 'c++', code: 'int main() {}' }), '"language" must be "python" or "javascript", not "c++"');
  assert.match(code.why({ language: 'python', code: 'print(1)\n'.repeat(400) }), /keep it/);
  assert.equal(code.block({ language: 'python', code: 'import numpy\nprint(1)' }), null);
  assert.equal(code.block('print(1)'), null);
});

test('server: code survives the lesson\'s JSON repair (which is for LaTeX)', () => {
  // a tab before a letter becomes "\t"; with an escape like \tAge in the code, a new line before "i" becomes "\n"
  const raw = ai.parseJSON('{"spec": {"language": "python", "code": "print(\\"Name\\\\tAge\\")\\ni = 0\\nwhile i < 2:\\n\\tprint(i)\\n\\ti += 1"}}');
  assert.notEqual(raw.spec.code, 'print("Name\\tAge")\ni = 0\nwhile i < 2:\n\tprint(i)\n\ti += 1', 'the repair did change it');
  assert.deepEqual(code.block(raw.spec), { language: 'python', code: 'print("Name\\tAge")\ni = 0\nwhile i < 2:\n    print(i)\n    i += 1' });
  const t = ai.parseJSON('{"spec": {"language": "python", "code": "print(\\"Name Age\\")"}, "goal": {"type": "output", "tests": [{"stdout": "Name\\tAge"}], "solution": "print(\\"Name\\\\tAge\\")"}}');
  assert.equal(code.task(t.spec, t.goal).goal.tests[0].stdout, 'Name\tAge');
});

test('server: a task\'s solution passes every test, and its starter code does not', () => {
  assert.deepEqual(code.task(FIX, FIX_GOAL), { spec: { ...FIX, mode: 'edit' }, goal: FIX_GOAL });
  assert.equal(code.why(FIX, FIX_GOAL), '');
  assert.equal(code.why(FIX, { ...FIX_GOAL, tests: [{ stdin: '3\n4', stdout: '12' }, { stdin: '1\n1', stdout: '2' }] }), 'test 1: the solution printed "7" but the test expects "12"');
  assert.equal(code.why({ language: 'python', code: FIX_GOAL.solution }, FIX_GOAL), 'the starter code already passes every test: give code with a bug to fix, ___ blanks to fill in, or a part left for the learner to write');
  assert.equal(code.why(FIX, { ...FIX_GOAL, tests: [FIX_GOAL.tests[0]] }), "give at least 2 tests with different inputs, so a program can't just print the answer");
  assert.equal(code.why(FIX, { ...FIX_GOAL, solution: 'a = int(input())\nprint(a + int(input())' }), "the solution has a syntax error: Line 2: SyntaxError: '(' was never closed");
  assert.equal(code.why(FIX, { ...FIX_GOAL, solution: 'print(1 / 0)' }), 'test 1: the solution stops with an error: Line 1: ZeroDivisionError: division by zero');
  assert.equal(code.why(FIX, { ...FIX_GOAL, solution: 'while True:\n    pass' }), 'test 1: the solution ran for too long');
  assert.equal(code.why({ language: 'python', code: '' }, { type: 'output', tests: [{ stdout: '4' }], solution: 'import random\nprint(random.randint(1, 6))' }), 'the task uses random numbers, so there is no one right output to check: take random out of tasks');
  assert.equal(code.why({ language: 'python', code: '' }, { type: 'output', tests: [{ stdout: 'x' }], solution: 'import turtle\nprint("x")' }), 'the task uses turtle: tasks are checked by what the program prints or returns, so use turtle only in blocks');
  assert.equal(code.why(FIX, { ...FIX_GOAL, type: 'guess' }), '"goal.type" must be "output" or "function", not "guess"');
  // the screen as a terminal shows it (prompts, typed lines) is read as what the program prints
  const t = code.task(FIX, { ...FIX_GOAL, solution: 'a = int(input("First: "))\nb = int(input("Second: "))\nprint("Sum:", a + b)', tests: [{ stdin: '3\n4', stdout: 'First: 3\nSecond: 4\nSum: 7' }, { stdin: '1\n1', stdout: 'First: Second: Sum: 2' }] });
  assert.deepEqual(t.goal.tests.map((x) => x.stdout), ['Sum: 7', 'Sum: 2']);
});

test('server: function tasks, fill-in tasks and JavaScript tasks', () => {
  const fn = code.task({ language: 'python', code: '' }, FN_GOAL);
  assert.deepEqual(fn.spec, { language: 'python', code: 'def area(w, h):\n    # Write your code here\n    pass', mode: 'write' }, 'an empty starter gets the def line');
  assert.equal(fn.goal.name, 'area');
  assert.equal(code.why({ language: 'python', code: '' }, { ...FN_GOAL, tests: [{ args: [3, 4], returns: 7 }, { args: [1, 1], returns: 1 }] }), 'test 1: the solution returned 12 for area(3, 4), but the test expects 7');
  assert.equal(code.why({ language: 'python', code: '' }, { ...FN_GOAL, name: 'areaa' }), 'the solution has no function named "areaa"');
  assert.equal(code.why({ language: 'python', code: '' }, { ...FN_GOAL, name: '2bad' }), 'a "function" goal needs "name": the name of the function the learner writes, like "area"');
  const loose = code.task({ language: 'python', code: '' }, { name: 'sq', tests: [{ args: 3, returns: 9 }, { input: [4], expected: 16 }], solution: 'def sq(n):\n    return n * n' });
  assert.deepEqual(loose.goal.tests, [{ args: [3], returns: 9 }, { args: [4], returns: 16 }], 'other names for the same fields are read');
  const fill = code.task({ language: 'python', code: 'for i in range(___):\n    print(i)' }, { type: 'output', tests: [{ stdout: '0\n1\n2' }], solution: 'for i in range(3):\n    print(i)' });
  assert.equal(fill.spec.mode, 'fill');
  const jsTask = code.task({ language: 'javascript', code: 'function double(n) {\n  return n + n + n;\n}' }, { type: 'function', name: 'double', tests: [{ args: [2], returns: 4 }, { args: [0], returns: 0 }], solution: 'function double(n) {\n  return n * 2;\n}' });
  assert.equal(jsTask.spec.mode, 'edit');
  assert.equal(code.task({ language: 'javascript', code: '' }, { type: 'output', tests: [{ stdin: '3', stdout: '9' }, { stdin: '5', stdout: '25' }], solution: 'let n = Number(prompt());\nconsole.log(n * n)' }).goal.tests.length, 2);
});

test('server: which lessons are offered the coding window, in the languages Primer serves', () => {
  const yes = ['Python for beginners: loops', 'Class 11 Computer Science: functions in Python', 'Introduction to programming', 'coding for kids', 'Sorting algorithms',
    'Recursion', 'JavaScript basics', 'प्रोग्रामिंग की शुरुआत', 'कोडिंग सीखें', 'पहला प्रोग्राम', 'Learn to code: loops', 'arrays and loops', 'variables in a program',
    'பைத்தான் நிரலாக்கம்', 'البرمجة للمبتدئين', 'Programación en Python', 'Программирование на Python', 'algorithmique et informatique', 'কম্পিউটার বিজ্ঞান', 'పైథాన్ ప్రోగ్రామింగ్'];
  const no = ['Code of conduct at work', 'The genetic code and DNA', 'Morse code', 'Postal and PIN codes of India', 'School dress code', 'The civil code', 'Indian Penal Code',
    'Linear programming', 'Algebra: variables and functions', 'Functions of the liver', 'Sorting materials into groups', 'The python snake', 'C++ programming: loops',
    'Java programming basics', 'HTML basics', 'Feedback loops in the body', 'The French Revolution', 'TV programmes and society', 'Loop of Henle'];
  for (const t of yes) assert.ok(code.match(t.toLowerCase()), 'should match: ' + t);
  for (const t of no) assert.ok(!code.match(t.toLowerCase()), 'should not match: ' + t);
  assert.ok(widgets.widgetKinds({ topic: 'Python for beginners', title: 'Loops' }).includes('code'));
  assert.ok(!widgets.widgetKinds({ topic: 'Plants', title: 'Photosynthesis' }).includes('code'));
});

test('server: the prompt is short, and its examples are themselves valid', () => {
  assert.ok(code.prompt.length <= 3000, `the prompt is ${code.prompt.length} characters`);
  const ls = code.prompt.split('\n');
  const ex = (label) => JSON.parse(ls.find((l) => l.startsWith(label)).slice(label.length).trim());
  const b = ex('Block example:');
  assert.equal(code.why(b.spec), '');
  const fix = ex('Task examples:');
  assert.equal(code.why(fix.spec, fix.goal), '');
  const fn = JSON.parse(ls[ls.findIndex((l) => l.startsWith('Task examples:')) + 1]);
  assert.equal(fn.goal.type, 'function');
  assert.equal(code.why(fn.spec, fn.goal), '');
  assert.equal(code.task(fn.spec, fn.goal).spec.mode, 'fill');
  assert.match(widgets.widgetPrompt(['code']), /Code \("kind": "code"\)/);
});

test('server: lessons keep their code blocks and tasks through the lesson checks', () => {
  const para = (html) => ({ t: 'p', html });
  const lesson = ai.normalizeLesson({
    sections: [
      { title: 'Loops', blocks: [para('A loop repeats.'), { t: 'widget', kind: 'code', spec: EX, caption: 'Run it.' }, { t: 'widget', kind: 'code', spec: { language: 'python', code: 'print(' } }],
        checkpoint: [{ type: 'task', kind: 'code', prompt: 'Fix the bug.', spec: FIX, goal: FIX_GOAL, hint: 'int()', explain: 'Numbers, not text.' }] },
      { title: 'Functions', blocks: [para('A function returns.')], checkpoint: [{ type: 'task', kind: 'code', prompt: 'Write area.', spec: { language: 'python', code: '' }, goal: FN_GOAL }] },
      { title: 'Wrap up', blocks: [para('Done.')] }
    ]
  }, 'Python');
  const s = lesson.sections[0];
  assert.deepEqual(s.blocks.filter((x) => x.t === 'widget'), [{ t: 'widget', kind: 'code', spec: EX, caption: 'Run it.' }], 'the broken example is left out');
  assert.equal(s.checkpoint[0].type, 'task');
  assert.equal(s.checkpoint[0].spec.mode, 'edit');
  assert.equal(lesson.sections[1].checkpoint[0].spec.code, 'def area(w, h):\n    # Write your code here\n    pass');
  assert.deepEqual(widgets.widgetTexts('code', EX), [], 'code is never sent to the translator');
});

/* ---------------- the browser half ---------------- */

const impls = {};
const sandbox = {
  window: { Primer: { t: (s) => s, esc: (s) => String(s), lang: 'en', widgets: { register: (k, impl) => { impls[k] = impl; } } }, PrimerCode: C },
  document: { currentScript: null },
  console
};
vm.runInNewContext(readFileSync(new URL('../assets/js/widgets/code.js', import.meta.url), 'utf8'), sandbox);
const W = impls.code;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('browser: the kind registers, and checks an attempt with a note in plain words', () => {
  assert.ok(W && typeof W.block === 'function' && typeof W.task === 'function' && typeof W.check === 'function');
  const spec = { ...FIX, mode: 'edit' };
  assert.deepEqual(plain(W.check(FIX_GOAL, { code: FIX_GOAL.solution }, spec)), { correct: true, note: '' });
  assert.deepEqual(plain(W.check(FIX_GOAL, { code: 'a = input()\nb = input()\nprint(a, b)' }, spec)), { correct: false, note: 'For input 3 and 4, your program printed “3 4”; it should print 7.' });
  assert.equal(W.check(FIX_GOAL, { code: 'a = int(input())\nb = int(input())\nprint(a * b)' }, spec).note, 'For input 3 and 4, your program printed 12; it should print 7.');
  assert.equal(W.check(FIX_GOAL, { code: 'a = int(input())\nprint(a)' }, spec).note, 'For input 3 and 4, your program printed 3; it should print 7.');
  assert.equal(W.check(FIX_GOAL, { code: 'x = 1' }, spec).note, 'For input 3 and 4, your program printed nothing; it should print 7.');
  assert.equal(W.check(FIX_GOAL, { code: 'print(tota)' }, spec).note, "For input 3 and 4, your program stopped with an error: Line 1: NameError: name 'tota' is not defined");
  assert.equal(W.check(FIX_GOAL, { code: 'while True:\n    pass' }, spec).note, 'For input 3 and 4, your program ran for too long. Is there a loop that never ends?');
  assert.equal(W.check(FIX_GOAL, { code: 'a = input()\nb = input()\nc = input()' }, spec).note, 'For input 3 and 4, your program asked for more input than the test gives.');
  const syn = W.check(FIX_GOAL, { code: 'print(' }, spec);
  assert.deepEqual(plain(syn), { correct: false, invalid: true, note: "Your code has a mistake to fix first: Line 1: SyntaxError: '(' was never closed" }, 'a syntax error is not counted as a try');
  assert.equal(W.check(FIX_GOAL, null, spec).invalid, true);
  // many lines: the first that differs
  const lines3 = { type: 'output', tests: [{ stdout: '1\n2\n3' }], solution: 'for i in range(1, 4):\n    print(i)' };
  assert.equal(W.check(lines3, { code: 'print(1)\nprint(5)\nprint(3)' }, { language: 'python', code: '', mode: 'write' }).note, 'Line 2 of what your program printed is 5; it should be 2.');
  assert.equal(W.check(lines3, { code: 'print(1)\nprint(2)' }, { language: 'python', code: '', mode: 'write' }).note, 'Your program stopped too soon: the next line should be 3.');
  assert.equal(W.check(lines3, { code: 'for i in range(1, 5):\n    print(i)' }, { language: 'python', code: '', mode: 'write' }).note, 'Your program printed an extra line: 4.');
  // blanks left as they are
  const fillSpec = { language: 'python', code: 'for i in range(___):\n    print(i)', mode: 'fill' };
  assert.deepEqual(plain(W.check(lines3, { code: fillSpec.code }, fillSpec)), { correct: false, invalid: true, note: 'Fill in every ___ first.' });
});

test('browser: function tasks say what the call returned', () => {
  const spec = { language: 'python', code: 'def area(w, h):\n    pass', mode: 'write' };
  assert.equal(W.check(FN_GOAL, { code: 'def area(w, h):\n    return w * h' }, spec).correct, true);
  assert.equal(W.check(FN_GOAL, { code: 'def area(w, h):\n    return w + h' }, spec).note, 'area(3, 4) returned 7; it should return 12.');
  assert.equal(W.check(FN_GOAL, { code: 'def area(w, h):\n    print(w * h)' }, spec).note, 'area(3, 4) printed its answer but returned None. Use return to give the answer back.');
  assert.equal(W.check(FN_GOAL, { code: 'def size(w, h):\n    return w * h' }, spec).note, 'Your code has no function named area.');
  assert.equal(W.check(FN_GOAL, { code: 'def area(w, h):\n    return area(w, h)' }, spec).note, 'area(3, 4) stopped with an error: Line 2: RecursionError: maximum recursion depth exceeded');
  const jsSpec = { language: 'javascript', code: 'function area(w, h) {\n}', mode: 'write' };
  assert.equal(W.check(FN_GOAL, { code: 'function area(w, h) { return w * h; }' }, jsSpec).correct, true);
  assert.equal(W.check(FN_GOAL, { code: 'function area(w, h) { console.log(w * h); }' }, jsSpec).note, 'area(3, 4) printed its answer but returned undefined. Use return to give the answer back.');
});

test('browser: the attempt and the answer in words, and a still picture', () => {
  assert.equal(W.describe({ code: '  print(1)\n' }), 'print(1)');
  assert.equal(W.answer(FIX_GOAL, FIX), FIX_GOAL.solution);
  assert.equal(W.answer({ type: 'nonsense' }, FIX), '');
  const pic = W.still({ language: 'python', code: 'print("<b>hi</b>")\nname = input("Name: ")', stdin: 'Asha' });
  assert.match(pic, /^<div class="cw-still"/);
  assert.ok(!pic.includes('<b>'), 'code is escaped');
  assert.match(pic, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.match(pic, />Output</);
  assert.match(pic, /Name: Asha/, 'what it printed, as the console shows it');
  const task = W.still({ ...FIX, mode: 'edit' }, null);
  assert.ok(!/>Output</.test(task), 'a task\'s starting code is shown without its output');
  assert.match(W.still({ language: 'python', code: 'import turtle\nturtle.forward(80)' }), /<svg[^>]*viewBox[\s\S]*<line /);
  assert.equal(W.still({ language: 'cobol', code: 'x' }), '');
  assert.equal(W.still(null), '');
});
