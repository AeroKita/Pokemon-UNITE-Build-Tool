import { useEffect, useState } from "react";
import { parseGradeInput } from "../state/heldItemGrades";

/** Tap-to-type grade input (1–ITEM_GRADE_MAX). Model-agnostic: takes a value
 *  and commits valid edits via onCommit; turns red on invalid input. Shared by
 *  the Items page inventory and the Build page Held Items slots. */
export function GradeField({ value, onCommit, label }:
  { value: number; onCommit: (g: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);

  const onChange = (raw: string) => {
    const res = parseGradeInput(raw);
    setDraft(res.digits);
    setInvalid(!res.valid);
    if (res.valid && res.value !== null) onCommit(res.value);
  };

  return (
    <input
      type="text" inputMode="numeric" value={draft}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`${label} grade`}
      className={`min-w-[2rem] w-10 rounded px-1 py-1 text-center text-base font-bold text-white outline-none
        ${invalid ? "bg-neg" : "bg-grade-badge"}`}
    />
  );
}
