/**
 * Batch CSV parsing for "Janet's" bulk-upload workflow: a CSV pairs each
 * uploaded image filename with its application data.
 *
 * Hand-rolled RFC-4180-style parser (quoted fields, escaped quotes, CRLF)
 * rather than a dependency — the format is small and the edge cases are
 * covered by tests.
 */

import { parseApplicationFields } from "./input";
import type { ApplicationData } from "./types";

export interface BatchRow {
  filename: string;
  application: ApplicationData;
}

export interface BatchRowError {
  /** 1-based line number in the CSV file. */
  line: number;
  message: string;
}

export interface BatchParseResult {
  rows: BatchRow[];
  errors: BatchRowError[];
}

const REQUIRED_HEADERS = [
  "filename",
  "brandName",
  "classType",
  "alcoholPercent",
  "netContents",
] as const;

/** Split CSV text into rows of fields, honoring quotes and escaped quotes. */
function tokenize(text: string): { fields: string[]; line: number }[] {
  const rows: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const pushField = () => {
    fields.push(current);
    current = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore rows that are entirely empty (blank lines).
    if (fields.length > 1 || fields[0].trim() !== "") {
      rows.push({ fields, line: rowStartLine });
    }
    fields = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      line++;
      pushRow();
      rowStartLine = line;
    } else if (ch !== "\r") {
      current += ch;
    }
  }
  if (current !== "" || fields.length > 0) pushRow();

  return rows;
}

export function parseBatchCsv(text: string): BatchParseResult {
  const rows = tokenize(text);
  if (rows.length === 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: "The CSV file is empty." }],
    };
  }

  const header = rows[0].fields.map((h) => h.trim());
  const indexOf: Partial<Record<(typeof REQUIRED_HEADERS)[number], number>> = {};
  for (const name of REQUIRED_HEADERS) {
    const idx = header.indexOf(name);
    if (idx === -1) {
      return {
        rows: [],
        errors: [
          {
            line: 1,
            message: `Missing required column "${name}". Expected columns: ${REQUIRED_HEADERS.join(", ")}.`,
          },
        ],
      };
    }
    indexOf[name] = idx;
  }

  const parsed: BatchRow[] = [];
  const errors: BatchRowError[] = [];

  for (const row of rows.slice(1)) {
    const get = (name: (typeof REQUIRED_HEADERS)[number]) =>
      (row.fields[indexOf[name]!] ?? "").trim();

    const filename = get("filename");
    if (!filename) {
      errors.push({ line: row.line, message: "Missing filename." });
      continue;
    }

    const application = parseApplicationFields({
      brandName: get("brandName"),
      classType: get("classType"),
      alcoholPercent: get("alcoholPercent"),
      netContents: get("netContents"),
    });
    if (!application.ok) {
      errors.push({ line: row.line, message: `${filename}: ${application.error}` });
      continue;
    }

    parsed.push({ filename, application: application.data });
  }

  return { rows: parsed, errors };
}
