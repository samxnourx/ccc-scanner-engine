import "server-only";

import { readFileSync } from "fs";
import path from "path";

export function letterheadLogoDataUrl(): string {
  const logoPath = path.join(
    process.cwd(),
    "assets",
    "email",
    "california-claims-center-logo-transparent.png",
  );
  const bytes = readFileSync(logoPath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
