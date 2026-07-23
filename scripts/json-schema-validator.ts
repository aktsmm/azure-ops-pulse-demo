import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const PUBLIC_SCHEMA_VERSION = "1.2.0";
export const PUBLIC_SCHEMA_DIRECTORY = resolve("schemas/public/v1.2");

const schemaFiles = [
  "overview.schema.json",
  "cost.schema.json",
  "inventory.schema.json",
  "health-activity.schema.json",
  "defender.schema.json",
  "network.schema.json",
  "ai-insights.schema.json"
];

function readJson(path: string): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}

export function validatePublicJsonSchema(snapshot: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const schemaFile of schemaFiles) {
    ajv.addSchema(readJson(resolve(PUBLIC_SCHEMA_DIRECTORY, schemaFile)));
  }
  const validate = ajv.compile(
    readJson(resolve(PUBLIC_SCHEMA_DIRECTORY, "snapshot.schema.json"))
  );
  if (!validate(snapshot)) {
    const errors = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`Public JSON Schema ${PUBLIC_SCHEMA_VERSION} validation failed: ${errors}`);
  }
}
