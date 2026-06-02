/**
 * Side-effect module: MUST be imported before `../config` when running under tsx.
 * ES modules evaluate imports before other statements, so dotenv cannot run after
 * static imports — config would capture an empty CA_SCO_DATA_PATH otherwise.
 *
 * Next.js loads `.env*` itself; this file is only for standalone importer scripts.
 */
import { config } from "dotenv";
import path from "path";

const root = process.cwd();

config({ path: path.join(root, ".env") });
config({ path: path.join(root, ".env.local"), override: true });
