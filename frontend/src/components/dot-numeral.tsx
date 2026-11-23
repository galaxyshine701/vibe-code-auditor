// A number drawn as a dot matrix (5 dots wide, 7 high for each digit), in SVG:
// the verdict counts of the example run. The dots that are on take the colour
// of the verdict (currentColor, with a soft shadow of the same colour in the
// CSS); the ones that are off stay as faint dots, so it reads as a matrix. The
// number is also in the label of the picture, so a reader of the screen gets
// "1", not a pile of circles. Only SVG: no library, no animation.
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

const STEP = 4; // the distance between two dots
const RADIUS = 1.4;

/** The digits of a count: a whole number from 0 up, one digit per glyph. */
export function digitsOf(value: number): string[] {
  const whole = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return String(whole).split('');
}

export function DotNumeral({
  value,
  className = '',
}: {
  value: number;
  className?: string;
}) {
  const digits = digitsOf(value);
  // 5 columns per digit and one empty column between two digits
  const columns = digits.length * 5 + (digits.length - 1);
  const dots: { key: string; cx: number; cy: number; on: boolean }[] = [];
  digits.forEach((digit, d) => {
    GLYPHS[digit].forEach((row, y) => {
      [...row].forEach((cell, x) => {
        dots.push({
          key: `${d}-${y}-${x}`,
          cx: (d * 6 + x) * STEP + STEP / 2,
          cy: y * STEP + STEP / 2,
          on: cell === '1',
        });
      });
    });
  });
  return (
    <svg
      className={`dot-numeral ${className}`.trim()}
      viewBox={`0 0 ${columns * STEP} ${7 * STEP}`}
      role="img"
      aria-label={String(Math.max(0, Math.trunc(value) || 0))}
      focusable="false"
    >
      {dots.map((dot) => (
        <circle
          key={dot.key}
          className={dot.on ? 'dot-on' : 'dot-off'}
          cx={dot.cx}
          cy={dot.cy}
          r={RADIUS}
        />
      ))}
    </svg>
  );
}
