/** Format integer cents as a US dollar string, e.g. 100000 -> "$1,000.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  const grouped = dollars.toLocaleString("en-US");
  return `${sign}$${grouped}.${remainder}`;
}
