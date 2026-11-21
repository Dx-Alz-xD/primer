/* =====================================================================
   Mock course generator + sample content.

   Until the AI backend exists, this file plays its part:
   - P.courseGen.build({topic, from, to, instructions}) -> course outline
     (20-30 lessons in units). Three topics have hand-written outlines
     (calculus/derivatives, black holes, Stoicism); anything else gets a
     sensible generic outline.
   - P.courseGen.lesson(course, n) -> lesson content. Three lessons are
     fully written (the first lesson of each sample course). Every other
     lesson is a "draft" that still exercises checkpoints and doubts.

   LESSON FORMAT (what the backend should return):
   {
     title, minutes, draft?,
     sections: [{
       id, title,
       blocks: [ {t:'p', html} | {t:'h', text} | {t:'math', tex} | {t:'list', items:[html]}
               | {t:'figure', svg|src, alt, caption} | {t:'callout', kind, title, html, when?} ],
       recap: [html],                    // shown as revision after a wrong answer
       checkpoint: [ question ]          // must all be answered to unlock the next section
     }]
   }
   question: {id, type:'numeric', prompt, answer, tolerance?, unit?, hint?, explain?}
           | {id, type:'choice', prompt, choices:[html], answer:index, hint?, explain?}
           | {id, type:'text', prompt, accept:[string], hint?, explain?}
           | {id, type:'subjective', prompt, model?}
   Inline maths uses \( ... \), display maths uses {t:'math'} (rendered by KaTeX).
   ===================================================================== */
(function () {
  'use strict';
  const P = window.Primer;
  const R = String.raw;
  const esc = P.esc;

  P.TAGS = { maths: 'Maths', diagram: 'Diagram', practice: 'Practice', written: 'Written answer' };

  /* ------------------------------------------------------------------
     Teaching-instruction detection (the mock only reacts to a few)
  ------------------------------------------------------------------ */
  P.parseStyle = (instructions) => {
    const s = String(instructions || '').toLowerCase();
    const out = [];
    if (/latex|\btex\b|equation|formula/.test(s)) out.push({ key: 'latex', label: 'LaTeX' });
    if (/mnemonic/.test(s)) out.push({ key: 'mnemonic', label: 'Mnemonics' });
    if (/like i['’]?m (5|five)|eli5|five[- ]year|simpl/.test(s)) out.push({ key: 'eli5', label: 'Explain like I’m five' });
    if (/example/.test(s)) out.push({ key: 'examples', label: 'Worked examples' });
    if (/\bexams?\b|test prep/.test(s)) out.push({ key: 'exam', label: 'Exam-focused' }); // whole word, so not "examples"
    if (/analog/.test(s)) out.push({ key: 'analogies', label: 'Analogies' });
    return out;
  };

  /* ------------------------------------------------------------------
     Figures (inline SVG, drawn in ink colours for the parchment page)
  ------------------------------------------------------------------ */
  function figSecant() {
    const X = (x) => 46 + x * 80, Y = (y) => 226 - y * 20;
    let d = '';
    for (let i = 0; i <= 33; i++) { const x = i / 10; d += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(x * x).toFixed(1) + ' '; }
    const tx = [1, 2, 3].map((v) => `<line x1="${X(v)}" y1="${Y(0)}" x2="${X(v)}" y2="${Y(0) + 5}"/><text x="${X(v)}" y="${Y(0) + 21}" text-anchor="middle" stroke="none">${v}</text>`).join('');
    const ty = [2, 4, 6, 8, 10].map((v) => `<line x1="${X(0) - 5}" y1="${Y(v)}" x2="${X(0)}" y2="${Y(v)}"/><text x="${X(0) - 9}" y="${Y(v) + 5}" text-anchor="end" stroke="none">${v}</text>`).join('');
    return `<svg viewBox="0 0 360 256" class="fig-svg" role="img" aria-label="Graph of y equals x squared, with a straight secant line through the points (1, 1) and (3, 9). A dashed run of 2 and rise of 8 connect the points.">
  <g stroke="currentColor" stroke-width="1.2" fill="currentColor" font-size="13">
    <path d="M${X(0)} ${Y(10.8)} V${Y(0)} H${X(3.9)}" fill="none"/>${tx}${ty}
  </g>
  <path d="${d}" fill="none" stroke="#8a6128" stroke-width="2.6" stroke-linecap="round"/>
  <line x1="${X(0.75)}" y1="${Y(0)}" x2="${X(3.25)}" y2="${Y(10)}" stroke="#9a3324" stroke-width="2"/>
  <path d="M${X(1)} ${Y(1)} H${X(3)} V${Y(9)}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="5 4"/>
  <circle cx="${X(1)}" cy="${Y(1)}" r="4.5" fill="currentColor"/><circle cx="${X(3)}" cy="${Y(9)}" r="4.5" fill="currentColor"/>
  <g fill="currentColor" font-size="14" font-style="italic">
    <text x="${X(2)}" y="${Y(1) + 15}" text-anchor="middle">Δx = 2</text>
    <text x="${X(3) + 8}" y="${Y(5)}">Δy = 8</text>
    <text x="${X(1) - 8}" y="${Y(1) - 10}" text-anchor="end" font-style="normal">(1, 1)</text>
    <text x="${X(3) - 12}" y="${Y(9) - 4}" text-anchor="end" font-style="normal">(3, 9)</text>
  </g>
  <g font-size="14" font-style="italic">
    <line x1="${X(0) + 18}" y1="22" x2="${X(0) + 44}" y2="22" stroke="#8a6128" stroke-width="2.6"/>
    <text x="${X(0) + 52}" y="27" fill="#8a6128">y = x²</text>
    <line x1="${X(0) + 18}" y1="44" x2="${X(0) + 44}" y2="44" stroke="#9a3324" stroke-width="2"/>
    <text x="${X(0) + 52}" y="49" fill="#9a3324">secant line</text>
  </g>
</svg>`;
  }

  function figEscape() {
    return `<svg viewBox="0 0 360 272" class="fig-svg" role="img" aria-label="A planet with three launch paths from its surface: a slow one arcs back down, a faster one curves into orbit, and the fastest escapes into space.">
  <defs><marker id="arrow-ink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>
  <marker id="arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#9a3324"/></marker></defs>
  <ellipse cx="180" cy="205" rx="92" ry="58" fill="none" stroke="#8a6128" stroke-width="1.6" stroke-dasharray="6 5"/>
  <circle cx="180" cy="205" r="38" fill="#cdb889" stroke="currentColor" stroke-width="1.4"/>
  <path d="M152 196 q14 -8 26 0 t26 0 M156 214 q12 6 24 0 t22 0" fill="none" stroke="currentColor" stroke-width="1" opacity=".45"/>
  <path d="M180 167 Q 196 112 213 186" fill="none" stroke="#9a3324" stroke-width="2" marker-end="url(#arrow-red)"/>
  <path d="M180 167 C 172 110, 120 60, 40 24" fill="none" stroke="currentColor" stroke-width="2" marker-end="url(#arrow-ink)"/>
  <g font-size="14" font-style="italic" fill="currentColor">
    <text x="214" y="126" fill="#9a3324">too slow: falls back</text>
    <text x="262" y="160" fill="#8a6128">orbits</text>
    <text x="18" y="120">fast enough: escapes</text>
    <text x="180" y="210" text-anchor="middle" font-style="normal" font-size="13">planet</text>
  </g>
</svg>`;
  }

  function figControl() {
    return `<svg viewBox="0 0 360 232" class="fig-svg" role="img" aria-label="Two circles, one inside the other. The inner circle is labelled up to you: judgments, choices and effort. The outer ring is labelled not up to you: the weather, other people, reputation and outcomes.">
  <circle cx="180" cy="116" r="108" fill="#e2d3b1" stroke="#8a6128" stroke-width="1.5"/>
  <circle cx="180" cy="116" r="56" fill="#d6c093" stroke="currentColor" stroke-width="1.5"/>
  <g fill="currentColor" text-anchor="middle">
    <text x="180" y="108" font-size="18">Up to you</text>
    <text x="180" y="127" font-size="12.5" font-style="italic">judgments, choices,</text>
    <text x="180" y="142" font-size="12.5" font-style="italic">effort</text>
    <text x="180" y="32" font-size="15">Not up to you</text>
    <g font-size="12" font-style="italic" fill="#5b4730">
      <text x="112" y="74">the weather</text>
      <text x="248" y="74">other people</text>
      <text x="116" y="172">reputation</text>
      <text x="244" y="172">outcomes</text>
    </g>
  </g>
</svg>`;
  }

  /* ------------------------------------------------------------------
     Hand-written lessons
  ------------------------------------------------------------------ */
  const AUTHORED = {
    'calc-avg-rate': {
      minutes: 15,
      sections: [
        {
          id: 's1',
          title: 'How fast is it changing?',
          blocks: [
            { t: 'p', html: R`Drive 120 km in 2 hours and your <em>average</em> speed is 60 km per hour, even if you sped up and slowed down along the way. That single number, the change in one quantity divided by the change in another, is called the <strong>average rate of change</strong>.` },
            { t: 'p', html: R`For a function \(f\), the average rate of change between \(x = a\) and \(x = b\) is` },
            { t: 'math', tex: R`\frac{\Delta y}{\Delta x} \;=\; \frac{f(b) - f(a)}{b - a}` },
            { t: 'figure', svg: figSecant(), caption: R`The straight line through \((1, 1)\) and \((3, 9)\) on \(y = x^2\). Its slope, rise over run, is the average rate of change between those points.` },
            { t: 'callout', kind: 'example', title: 'Worked example', html: R`For \(f(x) = x^2\) from \(x = 1\) to \(x = 3\): \(f(3) = 9\) and \(f(1) = 1\), so the average rate of change is \(\dfrac{9 - 1}{3 - 1} = \dfrac{8}{2} = 4\).` },
            { t: 'callout', kind: 'mnemonic', when: 'mnemonic', title: 'Mnemonic', html: R`<strong>Rise over run.</strong> Rise is the change in height, \(\Delta y\). Run is the step along, \(\Delta x\). Say it as you climb a staircase: rise, then run.` },
            { t: 'callout', kind: 'eli5', when: 'eli5', title: 'The simple version', html: R`You climb 8 steps up while walking 2 steps forward. That’s 4 steps up for every step forward. “4 for every 1” is the average rate of change.` }
          ],
          recap: [
            R`Average rate of change = change in output ÷ change in input.`,
            R`For \(f\) from \(a\) to \(b\) it is \(\dfrac{f(b) - f(a)}{b - a}\).`,
            R`Work out \(f(b)\) and \(f(a)\) first, then subtract, then divide by \(b - a\).`
          ],
          checkpoint: [
            { id: 'q1', type: 'numeric', prompt: R`Find the average rate of change of \(f(x) = x^2\) from \(x = 2\) to \(x = 5\).`, answer: 7, hint: R`Start with \(f(5) = 25\) and \(f(2) = 4\).`, explain: R`\(\dfrac{25 - 4}{5 - 2} = \dfrac{21}{3} = 7\).` }
          ]
        },
        {
          id: 's2',
          title: 'Rates have units',
          blocks: [
            { t: 'p', html: R`A rate of change always means “output units per input unit”. If \(V(t)\) is the number of litres in a tank after \(t\) minutes, its average rate of change is measured in litres per minute.` },
            { t: 'p', html: R`The sign matters too. A <strong>positive</strong> rate means the output is growing. A <strong>negative</strong> rate means it is shrinking.` },
            { t: 'callout', kind: 'example', title: 'Worked example', html: R`A phone battery drops from 80% at 2 pm to 50% at 5 pm. The average rate of change is \(\dfrac{50 - 80}{5 - 2} = -10\) percentage points per hour, so it loses about 10 points each hour.` }
          ],
          recap: [
            R`Units of a rate: output units per input unit (litres per minute, km per hour).`,
            R`Positive rate: the quantity is increasing. Negative rate: it is decreasing.`,
            R`The formula is the same: \(\dfrac{\text{new} - \text{old}}{\text{time between}}\).`
          ],
          checkpoint: [
            {
              id: 'q2', type: 'choice',
              prompt: R`A tank holds \(V(t)\) litres after \(t\) minutes, with \(V(0) = 200\) and \(V(10) = 150\). What is the average rate of change, and what does it mean?`,
              choices: [
                R`\(-5\) litres per minute: the tank loses 5 litres each minute on average`,
                R`\(5\) litres per minute: the tank gains 5 litres each minute`,
                R`\(-50\) litres: the total amount that drained out`,
                R`\(15\) minutes per litre`
              ],
              answer: 0,
              hint: R`Compute \(\dfrac{V(10) - V(0)}{10 - 0}\) and think about the sign.`,
              explain: R`\(\dfrac{150 - 200}{10 - 0} = -5\) litres per minute. It’s negative because water is leaving.`
            }
          ]
        },
        {
          id: 's3',
          title: 'Secant lines',
          blocks: [
            { t: 'p', html: R`A straight line through two points on a graph is called a <strong>secant line</strong>. Its slope is exactly the average rate of change between those two points.` },
            { t: 'p', html: R`Write the second point as a small step \(h\) away from the first, and the slope becomes` },
            { t: 'math', tex: R`m_{\text{sec}} \;=\; \frac{f(a + h) - f(a)}{h}` },
            { t: 'p', html: R`As \(h\) shrinks, the secant line hugs the curve more and more tightly. Taking that idea to its limit is how the derivative is born, which is exactly where this course is heading.` }
          ],
          recap: [
            R`A secant line joins two points on a curve. Its slope is the average rate of change.`,
            R`With step \(h\): \(\dfrac{f(a + h) - f(a)}{h}\).`,
            R`For a straight line the slope is the same everywhere, so any two points give the same answer.`
          ],
          checkpoint: [
            { id: 'q3', type: 'numeric', prompt: R`For \(f(x) = 3x + 1\), what is the average rate of change from \(x = 0\) to \(x = 4\)?`, answer: 3, hint: R`\(f(4) = 13\) and \(f(0) = 1\).`, explain: R`\(\dfrac{13 - 1}{4 - 0} = 3\), which is the slope of the line.` },
            { id: 'q4', type: 'numeric', prompt: R`For \(f(x) = x^2\) and \(a = 1\), compute \(\dfrac{f(1 + h) - f(1)}{h}\) when \(h = 0.1\).`, answer: 2.1, tolerance: 0.001, hint: R`\(f(1.1) = 1.21\).`, explain: R`\(\dfrac{1.21 - 1}{0.1} = \dfrac{0.21}{0.1} = 2.1\).` }
          ]
        },
        {
          id: 's4',
          title: 'Explain it back',
          blocks: [
            { t: 'p', html: R`Explaining an idea in your own words is one of the fastest ways to find the gaps in it. There’s no single right wording here.` }
          ],
          recap: [],
          checkpoint: [
            { id: 'q5', type: 'subjective', prompt: R`In your own words, explain why a straight line has the same average rate of change on every interval.`, model: R`A straight line has a constant slope: every step of the same size in \(x\) produces the same change in \(y\). So \(\Delta y / \Delta x\) comes out the same no matter which two points you pick.` }
          ]
        },
        {
          id: 's5',
          title: 'Key takeaways',
          blocks: [
            { t: 'list', items: [
              R`The average rate of change is \(\dfrac{f(b) - f(a)}{b - a}\): rise over run.`,
              R`It carries units (output per input) and a sign (growing or shrinking).`,
              R`It is the slope of the secant line between two points.`,
              R`Shrinking the interval toward zero leads to the derivative, the next big idea.`
            ] }
          ],
          checkpoint: []
        }
      ]
    },

    'bh-escape': {
      minutes: 16,
      sections: [
        {
          id: 's1',
          title: 'Throw it hard enough',
          blocks: [
            { t: 'p', html: R`Throw a ball straight up and it slows down, stops and falls back. Throw it faster and it climbs higher before falling. Throw it fast enough and it never comes back at all. That speed is the <strong>escape velocity</strong>.` },
            { t: 'math', tex: R`v_{\text{esc}} \;=\; \sqrt{\frac{2GM}{r}}` },
            { t: 'p', html: R`Here \(G\) is the gravitational constant, \(M\) is the planet’s mass and \(r\) is your distance from its centre, which is the planet’s radius if you launch from the surface.` },
            { t: 'figure', svg: figEscape(), caption: R`Three launches from the same spot. Only the fastest beats the planet’s pull for good.` },
            { t: 'callout', kind: 'eli5', when: 'eli5', title: 'The simple version', html: R`Imagine rolling a marble up the inside of a big bowl. Roll it gently and it rolls back. Roll it hard enough and it flies over the rim. Escape velocity is “hard enough”.` }
          ],
          recap: [
            R`Escape velocity is the launch speed needed to never fall back: \(v_{\text{esc}} = \sqrt{2GM/r}\).`,
            R`More mass \(M\) means a higher escape velocity.`,
            R`Because of the square root, doubling \(M\) multiplies \(v_{\text{esc}}\) by \(\sqrt{2} \approx 1.41\), not by 2.`
          ],
          checkpoint: [
            {
              id: 'q1', type: 'choice',
              prompt: R`A planet’s mass doubles but its radius stays the same. What happens to its escape velocity?`,
              choices: ['It doubles', R`It grows by a factor of \(\sqrt{2}\), about 1.41`, 'It halves', 'It stays the same'],
              answer: 1,
              hint: R`\(M\) sits inside a square root.`,
              explain: R`\(v_{\text{esc}} \propto \sqrt{M}\), so doubling \(M\) multiplies it by \(\sqrt{2}\).`
            }
          ]
        },
        {
          id: 's2',
          title: 'Squeezing a planet',
          blocks: [
            { t: 'p', html: R`Notice that \(r\) is on the bottom of the fraction. Squeeze the same mass into a smaller ball and the escape velocity <em>at its surface</em> goes up, because you start much closer to the centre.` },
            { t: 'p', html: R`Earth’s escape velocity is about 11.2 km/s, roughly 33 times the speed of sound.` },
            { t: 'callout', kind: 'example', title: 'Worked example', html: R`Keep Earth’s mass but halve its radius. Then \(2GM/r\) doubles, and the square root grows by \(\sqrt{2}\). The new escape velocity is about \(11.2 \times 1.41 \approx 15.8\) km/s.` },
            { t: 'callout', kind: 'mnemonic', when: 'mnemonic', title: 'Mnemonic', html: R`<strong>“Mass on top, distance below.”</strong> More mass pushes the escape speed up; more distance brings it down.` }
          ],
          recap: [
            R`\(r\) is in the denominator: smaller radius, bigger escape velocity.`,
            R`Earth: about 11.2 km/s.`,
            R`Dividing \(r\) by 4 multiplies \(2GM/r\) by 4, and \(\sqrt{4} = 2\).`
          ],
          checkpoint: [
            { id: 'q2', type: 'numeric', prompt: R`A planet has Earth’s mass but a quarter of Earth’s radius. Earth’s escape velocity is 11.2 km/s. What is this planet’s escape velocity, in km/s?`, answer: 22.4, tolerance: 0.3, unit: 'km/s', hint: R`Quartering \(r\) makes \(2GM/r\) four times bigger. What does the square root do to 4?`, explain: R`\(v = 11.2 \times \sqrt{4} = 11.2 \times 2 = 22.4\) km/s.` }
          ]
        },
        {
          id: 's3',
          title: 'When even light can’t escape',
          blocks: [
            { t: 'p', html: R`Keep squeezing. At some radius the escape velocity reaches the speed of light, \(c \approx 300{,}000\) km/s. Nothing can travel faster than light, so nothing from inside that radius can get out.` },
            { t: 'p', html: R`Set \(v_{\text{esc}} = c\) and solve for \(r\):` },
            { t: 'math', tex: R`r_s \;=\; \frac{2GM}{c^2}` },
            { t: 'p', html: R`This is the <strong>Schwarzschild radius</strong>, and the sphere at that radius is the <strong>event horizon</strong>. For the Sun it is about 3 km. This shortcut uses Newton’s gravity and happens to give the right answer; later lessons show Einstein’s version.` },
            { t: 'callout', kind: 'mnemonic', when: 'mnemonic', title: 'Mnemonic', html: R`<strong>“Twice GM, over c twice.”</strong> Two, G and M on top; c times c underneath.` }
          ],
          recap: [
            R`The Schwarzschild radius is where \(v_{\text{esc}} = c\): \(r_s = 2GM/c^2\).`,
            R`\(r_s\) is proportional to \(M\): ten times the mass, ten times the radius.`,
            R`For the Sun, \(r_s \approx 3\) km.`
          ],
          checkpoint: [
            { id: 'q3', type: 'numeric', prompt: R`The Sun’s Schwarzschild radius is about 3 km. What is the Schwarzschild radius of a black hole with 10 times the Sun’s mass, in km?`, answer: 30, tolerance: 0.5, unit: 'km', hint: R`There’s no square root this time. How does \(r_s\) depend on \(M\)?`, explain: R`\(r_s \propto M\), so \(10 \times 3 = 30\) km.` }
          ]
        },
        {
          id: 's4',
          title: 'Explain it back',
          blocks: [
            { t: 'p', html: R`Put the whole idea together in your own words.` }
          ],
          recap: [],
          checkpoint: [
            { id: 'q4', type: 'subjective', prompt: R`Why can’t light escape from inside the event horizon? Answer in two or three sentences.`, model: R`Inside the event horizon the escape velocity is greater than the speed of light. Nothing can travel faster than light, so nothing that starts inside, light included, can climb back out. In Einstein’s picture, spacetime there is so curved that every path leads further in.` }
          ]
        },
        {
          id: 's5',
          title: 'Key takeaways',
          blocks: [
            { t: 'list', items: [
              R`Escape velocity \(v_{\text{esc}} = \sqrt{2GM/r}\) grows with mass and shrinks with distance.`,
              R`Squeezing the same mass smaller raises the escape velocity at its surface.`,
              R`When \(v_{\text{esc}}\) reaches \(c\), you get a black hole of radius \(r_s = 2GM/c^2\).`
            ] }
          ],
          checkpoint: []
        }
      ]
    },

    'stoic-control': {
      minutes: 14,
      sections: [
        {
          id: 's1',
          title: 'What is up to you',
          blocks: [
            { t: 'p', html: R`Epictetus was born a slave around 50 AD and became one of the most influential Stoic teachers. His handbook opens with a single sorting rule: <strong>some things are up to us, and some things are not</strong>.` },
            { t: 'p', html: R`Up to us are our judgments, intentions, desires and choices, in short, what we make of things. Not up to us are our body’s fate, our reputation, our possessions, other people’s actions and the weather: anything that isn’t entirely our own doing.` },
            { t: 'figure', svg: figControl(), caption: R`The Stoic sorting rule. Your attention belongs mostly in the inner circle.` },
            { t: 'callout', kind: 'eli5', when: 'eli5', title: 'The simple version', html: R`You can choose how hard you practise for a race. You can’t choose whether it rains on race day. Spend your worry on the first thing, not the second.` }
          ],
          recap: [
            R`Up to you: your judgments, intentions, choices and effort.`,
            R`Not up to you: the weather, other people, your reputation, outcomes.`,
            R`A useful test: could I fully control this, starting right now, on my own?`
          ],
          checkpoint: [
            {
              id: 'q1', type: 'choice',
              prompt: R`Your train is 40 minutes late. According to the Stoics, which of these is up to you?`,
              choices: ['Whether the train runs on time', 'What the other passengers think of you', 'How you respond to the delay', 'Whether your meeting gets moved'],
              answer: 2,
              hint: 'Which one could you fully decide, by yourself, right now?',
              explain: 'Only your response is entirely your own. The train, other people and the meeting all depend on things outside you.'
            }
          ]
        },
        {
          id: 's2',
          title: 'The archer',
          blocks: [
            { t: 'p', html: R`The Stoics didn’t say outcomes don’t matter. Cicero describes an archer who does everything in their power to shoot well: they practise, choose a good bow, aim carefully and steady their breath. But once the arrow leaves the string, a gust of wind can still decide where it lands.` },
            { t: 'p', html: R`So the archer’s real goal is to <em>shoot well</em>. Hitting the target is something they reasonably prefer, but it is never fully theirs. The Stoics called things like health, money and a good name <strong>preferred indifferents</strong>: sensible to aim for, but not what makes a life good. Character does that.` },
            { t: 'callout', kind: 'mnemonic', when: 'mnemonic', title: 'Mnemonic', html: R`<strong>“Aim, don’t own.”</strong> Aim well at outcomes; own only your aim.` },
            { t: 'callout', kind: 'eli5', when: 'eli5', title: 'The simple version', html: R`You can build a sandcastle very carefully. You can’t stop the wave. Be proud of the building, and don’t be crushed by the wave.` }
          ],
          recap: [
            R`The archer’s job is to shoot well; the hit depends partly on the wind.`,
            R`“Preferred indifferents” (health, money, reputation) are worth choosing but don’t make a life good.`,
            R`For the Stoics, only virtue, good character, is truly good.`
          ],
          checkpoint: [
            {
              id: 'q2', type: 'choice',
              prompt: R`In the archer analogy, what is the archer’s real goal?`,
              choices: ['To hit the target every single time', 'To shoot as well as they possibly can', 'To impress the people watching', 'To avoid shooting on windy days'],
              answer: 1,
              hint: 'Which goal is fully in the archer’s control?',
              explain: 'Shooting well is entirely up to the archer. Hitting the target also depends on the wind.'
            },
            {
              id: 'q3', type: 'text',
              prompt: R`Fill in the blank: things like health and money, which are reasonable to want but don’t make a life good, are called preferred ________.`,
              accept: ['indifferents', 'indifferent', 'preferred indifferents'],
              hint: 'They are “preferred”, but neither good nor bad in themselves.',
              explain: 'Preferred indifferents: worth choosing, but indifferent to whether your life is good.'
            }
          ]
        },
        {
          id: 's3',
          title: 'Try it on your week',
          blocks: [
            { t: 'p', html: R`The dichotomy of control is a tool, not a slogan. It works best on something real.` }
          ],
          recap: [],
          checkpoint: [
            { id: 'q4', type: 'subjective', prompt: R`Pick something that worried you this week. Split it into the part that was up to you and the part that wasn’t.`, model: R`Example: “I was anxious about a job interview. Up to me: how well I prepared, how honestly I answered and how I treated the people there. Not up to me: the other candidates, the interviewer’s mood and the final decision. So I can judge my week by my preparation, not by the result.”` }
          ]
        },
        {
          id: 's4',
          title: 'Key takeaways',
          blocks: [
            { t: 'list', items: [
              R`Sort every worry into “up to me” and “not up to me”.`,
              R`Put your effort and attention into the first group.`,
              R`Aim at good outcomes, but measure yourself by your aim, not the hit.`
            ] }
          ],
          checkpoint: []
        }
      ]
    }
  };

  /* ------------------------------------------------------------------
     Hand-written outlines: [title, description, tags, contentId?, minutes?]
  ------------------------------------------------------------------ */
  const CURATED = [
    {
      key: 'calculus',
      match: /calculus|derivativ|differentiat/i,
      title: 'Derivatives, from scratch',
      units: [
        ['Getting ready', [
          ['Average rate of change', 'How fast something changes over an interval, measured as rise over run.', ['maths', 'diagram', 'practice'], 'calc-avg-rate', 15],
          ['Functions as machines', 'Inputs, outputs and the f(x) notation you’ll use in every lesson.', ['maths']],
          ['Slopes of straight lines', 'Why a line has a single slope, and how to read it from an equation.', ['maths', 'practice']],
          ['Limits, intuitively', 'What it means for a value to approach a number without ever reaching it.', ['maths', 'diagram']],
          ['Evaluating limits', 'Substitution, factoring and the other tricks that make limits computable.', ['maths', 'practice']]
        ]],
        ['The derivative', [
          ['From secant to tangent', 'Shrinking the interval until an average rate becomes an instant one.', ['maths', 'diagram']],
          ['The derivative as a limit', 'The formal definition of f′(x), and computing it by hand.', ['maths', 'practice']],
          ['Reading derivative graphs', 'What the graph of f′ tells you about the shape of f.', ['diagram']],
          ['When derivatives fail', 'Corners, cusps and jumps: the places a function has no derivative.', ['maths']]
        ]],
        ['Rules of differentiation', [
          ['The power rule', 'Differentiate any power of x in one line.', ['maths', 'practice']],
          ['Constant multiple and sum rules', 'Break big expressions into pieces you already know.', ['maths', 'practice']],
          ['The product rule', 'Differentiate two functions multiplied together.', ['maths', 'practice']],
          ['The quotient rule', 'Differentiate one function divided by another.', ['maths', 'practice']],
          ['The chain rule', 'Differentiate a function inside another function.', ['maths', 'practice']],
          ['Trigonometric derivatives', 'The derivatives of sine, cosine and tangent, and why they cycle.', ['maths']],
          ['Exponentials and logarithms', 'Why eˣ is its own derivative, and what that means for ln x.', ['maths']]
        ]],
        ['Using derivatives', [
          ['Tangent lines and linear approximation', 'Use the derivative to estimate values near a point.', ['maths', 'diagram']],
          ['Increasing, decreasing and critical points', 'Find where a function rises, falls and turns around.', ['maths', 'diagram']],
          ['Concavity and the second derivative', 'How the rate of change itself changes, and what that says about a curve.', ['maths', 'diagram']],
          ['Optimisation', 'Find the biggest or smallest possible value in real problems.', ['maths', 'practice']],
          ['Related rates', 'How the rate of one quantity drives the rate of another.', ['maths', 'practice']]
        ]],
        ['Mastery', [
          ['Implicit differentiation', 'Differentiate curves that aren’t written as y = f(x).', ['maths']],
          ['Common mistakes with derivatives', 'The slips everyone makes, and the quick checks that catch them.', ['practice']],
          ['Mixed practice set', 'Questions from every unit, shuffled, to test real understanding.', ['maths', 'practice']],
          ['Teach-back: the derivative', 'Explain the big idea in your own words and compare with a model answer.', ['written']]
        ]]
      ]
    },
    {
      key: 'blackholes',
      match: /black ?holes?/i,
      title: 'How black holes work',
      units: [
        ['Gravity first', [
          ['Escape velocity', 'How fast you must go to leave a planet for good, and what sets that speed.', ['maths', 'diagram', 'practice'], 'bh-escape', 16],
          ['Newton’s law of gravity', 'One equation that explains falling apples and orbiting moons.', ['maths']],
          ['Mass, size and density', 'Why squeezing the same mass smaller makes its gravity fiercer up close.', ['maths', 'practice']],
          ['The speed of light', 'Why light’s speed is a hard limit for everything in the universe.', []]
        ]],
        ['Einstein’s picture', [
          ['Spacetime', 'Space and time as one stretchy fabric.', ['diagram']],
          ['How mass curves spacetime', 'Gravity as the shape of spacetime rather than a pull.', ['diagram']],
          ['Gravitational time dilation', 'Why clocks run slower deep in a gravity well.', ['maths']],
          ['Bending light', 'How gravity bends light, and how lensing lets us weigh galaxies.', ['diagram']]
        ]],
        ['Making a black hole', [
          ['The life of a massive star', 'How stars burn, swell and run out of fuel.', []],
          ['Collapse and supernova', 'What happens when a star’s core can no longer hold itself up.', ['diagram']],
          ['The Schwarzschild radius', 'How small a mass must be squeezed to become a black hole.', ['maths', 'practice']],
          ['The event horizon', 'The one-way boundary: what it is, and what it isn’t.', ['diagram']]
        ]],
        ['Inside and around', [
          ['Singularities', 'What the maths predicts at the centre, and why physicists doubt it.', []],
          ['The photon sphere', 'Where light itself can orbit a black hole.', ['diagram']],
          ['Accretion disks', 'Why matter falling in can glow brighter than whole galaxies.', ['diagram']],
          ['Relativistic jets', 'How black holes fire matter outward at nearly the speed of light.', []],
          ['Spinning black holes', 'How rotation drags spacetime around with it.', ['diagram']]
        ]],
        ['Evidence and frontiers', [
          ['Seeing the unseeable', 'How the Event Horizon Telescope photographed a black hole’s shadow.', ['diagram']],
          ['Gravitational waves', 'Ripples in spacetime from colliding black holes, and how we detect them.', []],
          ['Supermassive black holes', 'The giants at the centres of galaxies, including our own.', []],
          ['Hawking radiation', 'Why black holes might slowly evaporate.', ['maths']],
          ['The information paradox', 'The open question of what happens to whatever falls in.', ['written']]
        ]]
      ]
    },
    {
      key: 'stoicism',
      match: /stoic/i,
      title: 'Stoicism: a practical course',
      units: [
        ['Meeting the Stoics', [
          ['The dichotomy of control', 'The Stoic sorting rule: what is up to you, and what is not.', ['diagram', 'practice', 'written'], 'stoic-control', 14],
          ['Who the Stoics were', 'A school that began on a painted porch in Athens around 300 BC.', []],
          ['Zeno, Epictetus, Seneca and Marcus', 'Four Stoics, four very different lives.', []],
          ['Virtue as the only good', 'Why the Stoics thought character matters more than circumstances.', ['written']]
        ]],
        ['Core ideas', [
          ['Living according to nature', 'What “nature” meant to the Stoics, and why reason sits at its centre.', []],
          ['The four virtues', 'Wisdom, courage, justice and self-control, and how they fit together.', ['practice']],
          ['Preferred indifferents', 'Health, money and reputation: worth choosing, not worth your peace.', ['practice']],
          ['Impressions and judgments', 'The gap between what happens and what you tell yourself about it.', ['practice']],
          ['The passions', 'Why the Stoics saw anger and fear as errors of judgment.', []]
        ]],
        ['Daily practices', [
          ['Morning preparation', 'Rehearsing the day ahead so it doesn’t ambush you.', ['written']],
          ['The evening review', 'Seneca’s nightly look back at what went well and what didn’t.', ['written']],
          ['Negative visualisation', 'Imagining loss to appreciate what you have now.', []],
          ['The view from above', 'Zooming out until today’s problems find their true size.', []],
          ['Voluntary discomfort', 'Small, chosen hardships that make you harder to shake.', []],
          ['Journaling like Marcus Aurelius', 'Writing to yourself, for yourself, as an emperor did.', ['written']]
        ]],
        ['Stoicism in life', [
          ['Anger and other people', 'Dealing with rude, unfair or difficult people without losing yourself.', ['practice']],
          ['Grief and loss', 'What the Stoics said about mourning, and what they didn’t.', []],
          ['Work, ambition and reputation', 'Doing good work without being owned by the outcome.', ['practice']],
          ['Stoicism and modern therapy', 'How Stoic ideas shaped cognitive behavioural therapy.', []],
          ['Common misreadings', 'Why Stoicism isn’t about suppressing emotions or not caring.', ['practice']]
        ]],
        ['Mastery', [
          ['Teach-back: the Stoic toolkit', 'Explain the core ideas in your own words and compare with a model answer.', ['written']]
        ]]
      ]
    }
  ];

  /* ------------------------------------------------------------------
     Generic outline for any other topic
  ------------------------------------------------------------------ */
  const STARTERS = /^(How|What|Why|When|Where|Who|Basic|Basics|Intro|Introduction|The|A|An|Beginner|Beginners|Advanced|Learning|Understanding)\b/;
  const inSentence = (t) => (STARTERS.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

  function genericLessons(topic) {
    const t = inSentence(topic);
    const U = (unit, rows) => rows.map(([title, desc, tags]) => ({ unit, title, desc, tags: tags || ['practice'] }));
    return [
      ...U('Orientation', [
        [`What ${t} is, and why it matters`, `A plain-language overview of ${t} and the questions it answers.`, []],
        [`A short history`, `The people, problems and turning points that shaped ${t}.`, []],
        ['Key vocabulary', 'The terms you’ll meet again and again, each defined simply.'],
        ['A map of the subject', `How the main ideas of ${t} fit together, so nothing feels random later.`, ['diagram']]
      ]),
      ...U('Foundations', [
        ['First principles', `The few assumptions everything else in ${t} is built on.`],
        ['The core building blocks', `The basic parts of ${t} and what each one does.`],
        ['Notation and representations', `How ${t} is usually written down, drawn or modelled.`, ['diagram']],
        ['Your first worked example', 'One complete example, solved slowly with every step explained.']
      ]),
      ...U('Core ideas', [
        ['Cause and effect', `What drives change in ${t}, and how to reason about it.`],
        ['Measuring and comparing', `How to put numbers or clear criteria on the ideas in ${t}.`],
        ['Patterns that repeat', 'The recurring structures that make new problems feel familiar.'],
        ['Exceptions and edge cases', 'Where the usual rules bend, and why.'],
        ['Putting the core ideas together', 'Combining everything so far on a richer problem.']
      ]),
      ...U('Applying it', [
        ['Worked examples, step by step', 'Several examples of rising difficulty, fully solved.'],
        ['Solving typical problems', `A reliable method for the kinds of questions ${t} asks.`],
        ['A real-world case study', `${P.cap(t)} applied to a real situation from start to finish.`, []],
        ['Tools and techniques', 'What practitioners actually use, and when to reach for each.']
      ]),
      ...U('Going deeper', [
        ['Advanced concepts', 'The ideas that separate a beginner from a confident learner.', []],
        ['Debates and open questions', 'Where experts disagree, and what is still unknown.', ['written']],
        ['Common mistakes to avoid', 'Where learners usually slip, and the checks that catch it.'],
        ['Connections to other fields', `How ${t} links to neighbouring subjects.`, []]
      ]),
      ...U('Mastery', [
        ['Mixed practice set', 'Questions from every unit, shuffled, to test real understanding.'],
        ['Teach-back: explain it yourself', 'Explain the key ideas in your own words and compare with a model answer.', ['written']],
        ['Final review and next steps', 'A recap of the course, and where to go from here.']
      ])
    ];
  }

  /* ------------------------------------------------------------------
     Range handling: "from X", "up to Y"
  ------------------------------------------------------------------ */
  const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'basics', 'basic', 'intro', 'introduction', 'about', 'what', 'how']);
  const isBeginning = (s) => !s || /^(the )?(very )?(beginning|start|scratch|basics|zero|nothing)$/i.test(s.trim());
  const isEnd = (s) => !s || /^(the )?(very )?(end|everything|all|advanced)$/i.test(s.trim());

  function findLesson(lessons, query) {
    const words = query.toLowerCase().split(/[^a-z0-9′']+/).filter((w) => w.length > 2 && !STOP.has(w));
    if (!words.length) return -1;
    let best = -1, bestScore = 0;
    lessons.forEach((l, i) => {
      const hay = (l.title + ' ' + l.desc).toLowerCase();
      const score = words.filter((w) => hay.includes(w)).length / words.length;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return bestScore >= 0.5 ? best : -1;
  }

  function applyRange(lessons, from, to) {
    let start = 0, end = lessons.length - 1;
    const pre = [], post = [];
    if (!isBeginning(from)) {
      const i = findLesson(lessons, from);
      if (i >= 0) start = i;
      else {
        const unit = `Picking up from ${from}`;
        pre.push(
          { unit, title: `Quick recap: ${from}`, desc: `A short refresher on ${from}, so the rest of the course has solid footing.`, tags: ['practice'] },
          { unit, title: `From ${from} to what comes next`, desc: `How ${from} connects to the ideas this course builds on.`, tags: [] }
        );
        start = Math.min(4, lessons.length - 1); // skip the very basics
      }
    }
    if (!isEnd(to)) {
      const j = findLesson(lessons, to);
      if (j >= start) end = j;
      else {
        const unit = `Reaching ${to}`;
        post.push(
          { unit, title: `${P.cap(to)}: the core idea`, desc: `The central idea of ${to}, built on everything before it.`, tags: ['practice'] },
          { unit, title: `${P.cap(to)}: worked examples`, desc: `Step-by-step examples of ${to}, from easy to tricky.`, tags: ['practice'] },
          { unit, title: `Capstone: ${to}`, desc: `A final set of problems that pull the whole course together around ${to}.`, tags: ['practice', 'written'] }
        );
      }
    }
    return [...pre, ...lessons.slice(start, end + 1), ...post];
  }

  // A narrow range still deserves a detailed course: split lessons into finer parts.
  function ensureCount(lessons, min, max) {
    if (lessons.length > max) return [...lessons.slice(0, max - 1), lessons[lessons.length - 1]]; // keep the range's end
    if (lessons.length >= min) return lessons;
    // split each lesson into finer parts (examples, practice, mistakes, harder problems), never past max
    const PARTS = {
      examples: (t) => [`${t}: worked examples`, `Step-by-step examples of ${t}, from easy to tricky.`],
      practice: (t) => [`${t}: practice`, `Checkpoint questions on ${t}, with revision when you slip.`],
      mistakes: (t) => [`${t}: common mistakes`, `Where people usually slip with ${t}, and how to catch it.`],
      harder: (t) => [`${t}: harder problems`, `Tougher questions on ${t} that pull in earlier ideas.`]
    };
    let extras = Math.min(max, Math.max(min, lessons.length * 3), lessons.length * 5) - lessons.length;
    const plan = lessons.map(() => []);
    Object.keys(PARTS).forEach((kind) => {
      for (let i = 0; i < lessons.length && extras > 0; i++) { plan[i].push(kind); extras--; }
    });
    const out = [];
    lessons.forEach((l, i) => {
      out.push(l);
      plan[i].forEach((kind) => {
        const [title, desc] = PARTS[kind](l.title);
        out.push({ unit: l.unit, title, desc: desc.replace(l.title, lcFirst(l.title)), tags: ['practice'] });
      });
    });
    // a very narrow range: top up with review lessons, always ending on a final review
    const extra = [
      ['Mixed practice set', 'Questions from the whole range, shuffled.', ['practice']],
      ['Teach-back: explain it yourself', 'Explain the key ideas in your own words and compare with a model answer.', ['written']],
      ['Exam-style questions', 'Timed questions in the style you’d meet in a test.', ['practice']]
    ];
    let k = 0;
    while (out.length < min - 1) {
      const [title, desc, tags] = extra[k % extra.length];
      out.push({ unit: 'Review', title: k >= extra.length ? `${title}, round ${Math.floor(k / extra.length) + 1}` : title, desc, tags });
      k++;
    }
    if (out.length < min) out.push({ unit: 'Review', title: 'Final review', desc: 'A recap of everything in this range.', tags: [] });
    return out.slice(0, max);
  }
  const lcFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  /* ------------------------------------------------------------------
     Build a course
  ------------------------------------------------------------------ */
  function build(req) {
    const topic = P.clean(req.topic, 120);
    const from = P.clean(req.from, 80);
    const to = P.clean(req.to, 80);
    const instructions = P.clean(req.instructions, 600);
    const cur = CURATED.find((c) => c.match.test(topic));
    const rng = P.mulberry32(P.hashStr(topic.toLowerCase() + '|' + from + '|' + to));

    let lessons = cur
      ? cur.units.flatMap(([unit, rows]) => rows.map(([title, desc, tags, contentId, minutes]) => ({ unit, title, desc, tags, contentId, minutes })))
      : genericLessons(topic);
    lessons = ensureCount(applyRange(lessons, from, to), 20, 30);

    const units = [];
    lessons.forEach((l) => {
      if (!l.minutes) l.minutes = 10 + Math.round(rng() * 14);
      const last = units[units.length - 1];
      if (!last || last.title !== l.unit) units.push({ title: l.unit, lessons: [] });
      units[units.length - 1].lessons.push({ title: l.title, desc: l.desc, tags: l.tags || [], minutes: l.minutes, contentId: l.contentId || null });
    });

    return {
      id: P.uid(),
      topic,
      title: cur ? cur.title : P.cap(topic),
      from, to, instructions,
      style: P.parseStyle(instructions),
      createdAt: Date.now(),
      openedAt: Date.now(),
      units,
      progress: {}
    };
  }

  function flatten(course) {
    const out = [];
    (course.units || []).forEach((u, ui) => u.lessons.forEach((l) => out.push(Object.assign({}, l, { n: out.length + 1, unit: u.title, unitIndex: ui + 1 }))));
    return out;
  }

  /* ------------------------------------------------------------------
     Lessons
  ------------------------------------------------------------------ */
  function decorate(src, course) {
    const keys = new Set((course.style || []).map((s) => s.key));
    const copy = JSON.parse(JSON.stringify(src));
    copy.sections.forEach((s) => { s.blocks = s.blocks.filter((b) => !b.when || keys.has(b.when)); });
    return copy;
  }

  function draftLesson(course, flat, n) {
    const meta = flat[n - 1];
    const rng = P.mulberry32(P.hashStr(course.id + ':' + n));
    const others = P.shuffle(flat.filter((l) => l.n !== n), rng);
    const prev = flat[n - 2], next = flat[n];

    const descChoices = P.shuffle([meta.desc, ...others.slice(0, 3).map((l) => l.desc)], rng);
    const q1 = {
      id: 'd1', type: 'choice',
      prompt: 'Which description matches this lesson?',
      choices: descChoices.map(esc),
      answer: descChoices.indexOf(meta.desc),
      hint: 'Re-read the opening paragraph of this lesson.',
      explain: `This lesson: ${esc(meta.desc)}`
    };

    let q2;
    if (prev || next) {
      const target = prev || next;
      const pool = P.shuffle(flat.filter((l) => l.n !== n && l.n !== target.n), rng).slice(0, 3);
      const titles = P.shuffle([target.title, ...pool.map((l) => l.title)], rng);
      q2 = {
        id: 'd2', type: 'choice',
        prompt: prev ? 'Which lesson comes right before this one?' : 'Which lesson comes right after this one?',
        choices: titles.map(esc),
        answer: titles.indexOf(target.title),
        hint: 'The section above names the neighbouring lessons.',
        explain: `${prev ? 'The lesson before' : 'The lesson after'} this one is “${esc(target.title)}”.`
      };
    }

    const styleNote = course.instructions
      ? [{ t: 'callout', kind: 'note', title: 'Your teaching instructions', html: `“${esc(course.instructions)}”. The written lesson will follow these.` }]
      : [];

    const sections = [
      {
        id: 's1',
        title: 'What this lesson covers',
        blocks: [
          { t: 'p', html: `This lesson is part of <em>${esc(meta.unit)}</em> in your course on ${esc(course.topic)}. ${esc(meta.desc)}` },
          { t: 'list', items: [
            `What “${esc(meta.title)}” means, in plain language.`,
            `Why it matters for ${esc(inSentence(course.topic))}.`,
            prev ? `How it builds on “${esc(prev.title)}”.` : 'Where it fits as the very first step.'
          ] },
          ...styleNote
        ],
        recap: [esc(meta.desc), `It belongs to the unit “${esc(meta.unit)}”.`],
        checkpoint: [q1]
      }
    ];
    if (q2) {
      sections.push({
        id: 's2',
        title: 'Where it fits',
        blocks: [
          { t: 'p', html: [
            prev ? `It comes straight after <strong>${esc(prev.title)}</strong>.` : '',
            next ? `Next up is <strong>${esc(next.title)}</strong>.` : 'It is the last lesson in the course.'
          ].filter(Boolean).join(' ') }
        ],
        recap: [
          prev ? `Before this lesson: “${esc(prev.title)}”.` : 'This is the first lesson.',
          next ? `After this lesson: “${esc(next.title)}”.` : 'This is the final lesson.'
        ],
        checkpoint: [q2]
      });
    }
    sections.push({
      id: 's3',
      title: 'Explain it back',
      blocks: [{ t: 'p', html: 'Writing an explanation in your own words shows you what you really understand.' }],
      recap: [],
      checkpoint: [{ id: 'd3', type: 'subjective', prompt: `In two or three sentences, say what you expect “${esc(meta.title)}” to cover and why it matters for ${esc(inSentence(course.topic))}.`, model: null }]
    });
    sections.push({
      id: 's4',
      title: 'Key takeaways',
      blocks: [{ t: 'list', items: [esc(meta.desc), next ? `Next: ${esc(next.title)}.` : 'You’ve reached the end of the course.'] }],
      checkpoint: []
    });

    return { title: meta.title, minutes: meta.minutes, draft: true, sections };
  }

  function lesson(course, n) {
    const flat = flatten(course);
    const meta = flat[n - 1];
    if (!meta) return null;
    const src = meta.contentId && AUTHORED[meta.contentId];
    const out = src ? decorate(src, course) : draftLesson(course, flat, n);
    out.title = meta.title;
    out.unit = meta.unit;
    out.unitIndex = meta.unitIndex;
    out.minutes = meta.minutes;
    return out;
  }

  P.courseGen = { build, flatten, lesson, count: (course) => flatten(course).length };
})();
