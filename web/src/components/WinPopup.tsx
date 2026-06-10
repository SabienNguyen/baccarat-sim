import { formatCents } from "../format";
import "./winpopup.css";

interface WinPopupProps {
  /** Net cents from the last settle; null or 0 renders nothing. */
  amount: number | null;
}

export function WinPopup({ amount }: WinPopupProps) {
  if (amount === null || amount === 0) return null;
  const sign = amount > 0 ? "win" : "loss";
  const text = amount > 0 ? `+${formatCents(amount)}` : formatCents(amount);
  return (
    <div className="win-popup" data-sign={sign} role="status">
      {text}
    </div>
  );
}
