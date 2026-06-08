"use client";

export function PrintLetterButton() {
  return (
    <button type="button" onClick={() => window.print()}>
      Print letter
    </button>
  );
}
