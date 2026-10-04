// Tax-ready CSV export wrapper
// @ts-ignore
import {
  CSV_PRESETS,
  generateActivityCsv as coreGenerateCsv,
} from "../../public/tera/core/csv-export.js";

export { CSV_PRESETS };

export function generateExportCsv(
  history: any[],
  preset: "standard" | "koinly" | "cointracker" = "standard",
): string {
  return coreGenerateCsv([], history, { preset });
}
