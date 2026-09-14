/** True on a phone or anything that handles like one: a coarse (touch)
 *  pointer, OR a narrow viewport (a phone in either orientation, or a
 *  desktop window pinched down). Either signal alone is enough — a tablet in
 *  landscape can be wide but still coarse-pointer, and a narrow devtools
 *  window is fine-pointer but narrow. Read fresh each call (no caching):
 *  it's cheap, and it keeps a hybrid device's rotate/dock correct without a
 *  resize listener anywhere that calls it. */
export function isPhoneLike(): boolean {
  const coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const narrow = typeof innerWidth === "number" && innerWidth <= 700;
  return coarse || narrow;
}
