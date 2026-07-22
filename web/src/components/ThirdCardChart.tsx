import "./thirdcard.css";

/**
 * A static reference for baccarat's third-card tableau — the one rule set a
 * novice can't derive at the table. Faithful to the engine's `banker_draws`
 * (engine/src/rules.rs): the Player draws on 0–5; when the Player drew, the
 * Banker's move depends on its total and the value of the Player's third card.
 */
const BANKER_ROWS: { total: string; draws: string }[] = [
  { total: "0–2", draws: "always draws" },
  { total: "3", draws: "draws — unless it's an 8" },
  { total: "4", draws: "draws on 2–7" },
  { total: "5", draws: "draws on 4–7" },
  { total: "6", draws: "draws on 6–7" },
  { total: "7", draws: "never — stands" },
];

export function ThirdCardChart() {
  return (
    <section className="third-card" aria-label="Third-card rule">
      <h4>Third-card rule</h4>
      <p className="tc-rule">Player draws on 0–5, stands on 6–7.</p>
      <p className="tc-rule tc-muted">
        If the Player stands, the Banker draws on 0–5. A natural 8 or 9 ends it — no draws.
      </p>
      <table className="tc-table">
        <caption className="tc-caption">When the Player drew, the Banker…</caption>
        <thead>
          <tr>
            <th scope="col">Banker</th>
            <th scope="col">by the Player's 3rd card</th>
          </tr>
        </thead>
        <tbody>
          {BANKER_ROWS.map((r) => (
            <tr key={r.total}>
              <th scope="row">{r.total}</th>
              <td>{r.draws}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
