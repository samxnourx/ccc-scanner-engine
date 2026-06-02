function clean(value: string | null | undefined, fallback = ""): string {
  const v = String(value ?? "").trim();
  return v || fallback;
}

export function displayLeadOutreachSourceName(sourceName: string): string {
  const value = clean(sourceName, "Unclaimed property source");
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized === "california sco" || normalized === "ca sco") {
    return "California State Controller's Office";
  }
  if (normalized.includes("california") && normalized.includes("sco")) {
    return value.replace(/\bSCO\b/g, "State Controller's Office");
  }
  return value;
}
