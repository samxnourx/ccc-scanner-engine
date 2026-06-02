"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function ScannerSearchForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [addressHint, setAddressHint] = useState("");
  const [intakeId, setIntakeId] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const params = new URLSearchParams();
    params.set("name", trimmed);
    if (city.trim()) params.set("city", city.trim());
    if (state.trim()) params.set("state", state.trim());
    if (addressHint.trim()) params.set("addressHint", addressHint.trim());
    if (intakeId.trim()) params.set("intakeId", intakeId.trim());

    router.push(`/scanner/results?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div className="grid gap-1">
        <label htmlFor="scanName" className="text-sm font-medium">
          Full name / business name
        </label>
        <input
          id="scanName"
          name="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor="scanCity" className="text-sm font-medium">
            City (optional)
          </label>
          <input
            id="scanCity"
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor="scanState" className="text-sm font-medium">
            State (optional)
          </label>
          <input
            id="scanState"
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="grid gap-1">
        <label htmlFor="scanAddressHint" className="text-sm font-medium">
          Address hint (optional)
        </label>
        <input
          id="scanAddressHint"
          name="addressHint"
          value={addressHint}
          onChange={(e) => setAddressHint(e.target.value)}
          className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor="scanIntakeId" className="text-sm font-medium">
          Intake ID (optional)
        </label>
        <input
          id="scanIntakeId"
          name="intakeId"
          value={intakeId}
          onChange={(e) => setIntakeId(e.target.value)}
          className="border border-[#b8b8b4] bg-white px-2 py-1.5 text-sm"
          autoComplete="off"
        />
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="submit"
          className="border border-[#6d6d68] bg-[#ececea] px-4 py-2 text-sm font-medium hover:bg-[#e0e0dc]"
        >
          Run scan
        </button>
      </div>
    </form>
  );
}
