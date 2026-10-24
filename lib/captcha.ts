export function makeCaptcha() {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const answer = a + b;
  const opts = new Set<number>([answer]);
  while (opts.size < 4) {
    const n = 2 + Math.floor(Math.random() * 17);
    if (n !== answer) opts.add(n);
  }
  return {
    question: `${a} + ${b} = ?`,
    answer,
    options: [...opts].sort(() => Math.random() - 0.5),
  };
}
