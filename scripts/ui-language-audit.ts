import {
  formatActivityTitle,
  formatEndpointLabel,
  formatEventTimestamp,
  formatSourceName
} from "../src/lib/display-formatters";
import type { PublicSnapshotV1 } from "../src/data/contracts";

export interface UiLanguageLeak {
  path: string;
  stored: string;
  rendered: string;
  residue: string;
  origin: "stored" | "rendered";
}

/**
 * Latin fragments that are legitimate inside Japanese copy: Azure product and service names, and
 * the demo estate's service identifiers. They are removed before the prose test so that
 * "Azure Resource Graph から収集" reads as Japanese while "Collected from Azure Resource Graph"
 * still reads as English.
 */
const PRODUCT_NAMES = [
  "Azure Resource Graph",
  "Azure Monitor",
  "Azure Front Door",
  "Azure SQL",
  "Resource Health",
  "Service Health",
  "Activity Log",
  "Cost Management",
  "Defender for Cloud",
  "Log Analytics",
  "Application Insights",
  "Logic Apps",
  "App Service",
  "Front Door",
  "Cosmos DB",
  "Application Gateway",
  "Microsoft",
  "Azure",
  "Defender",
  "Global edge",
  "Commerce API",
  "Order data",
  "Observability"
];

/**
 * A measurement is digits and a Latin unit, which is how a reader expects to see it. The same shape
 * is allowed wherever the dashboard prints one.
 */
const MEASUREMENT = /^[+-]?[\d.,]+\s*(?:pts?|ms|%)$/u;

/**
 * `src/lib/sanitize.ts` and `scripts/public-schema.ts` each recognise a Defender-derived overview
 * metric by an exact label match, and that match is what keeps the aggregate off the page while the
 * source is unavailable. Translating either label would leave both lookups searching for a string
 * nobody writes, so the stripping would stop happening and nothing would say so — the same silent
 * failure this audit exists to prevent. `ui-language-audit.test.ts` derives this list from
 * `sanitizeSnapshot` itself, so a label that stops being part of that contract stops being exempt.
 */
export const DEFENDER_AGGREGATE_METRIC_LABELS = ["Defender recommendations", "Open alerts"];

/**
 * A cost category is a name, not a sentence. Cost Management hands back a `ServiceName` chosen
 * outside this repository — "Virtual Machines", "Storage", the `"Other"` fallback in
 * `scripts/cost-transform.ts`, and `src/lib/sanitize.ts` appends " credit" to a negative one — so
 * unlike every other identifier source its words are not drawn from a taxonomy this repository or
 * Azure's own resource model controls.
 *
 * Requiring each word to be capitalised, or one of the few lowercase words those two producers
 * actually emit, is what separates a name from prose. It matters because an identifier is allowed
 * everywhere: while any category name qualified, calling one "No material change" made an
 * `inventory.resources[].change` of the same words read as clean. A category that is not a name
 * neither grants that allowance nor passes its own audit, so the two rules cannot disagree.
 */
const COST_CATEGORY_NAME =
  /^[A-Z0-9][A-Za-z0-9.&()/-]*(?:[ -](?:[A-Z0-9][A-Za-z0-9.&()/-]*|for|of|and))*(?: credit)?$/u;

/**
 * Latin values that are a whole-field answer rather than prose, allowed only on the fields that can
 * legitimately carry them. Keeping this per-path matters: a shared allowlist previously let an
 * English `inventory.resources[].change` pass by naming an unrelated enumeration member.
 */
const FIELD_ALLOWANCES: Array<{ path: RegExp; allow: RegExp[] }> = [
  {
    // The cost page prints the Azure service name, so a name is the answer here and prose is not.
    path: /^cost\.categories\[\d+\]\.name$/u,
    allow: [COST_CATEGORY_NAME]
  },
  {
    // Service Health event categories are Azure API enumeration members, not translated copy.
    path: /^reliability\.serviceHealth\.categories\[\d+\]\.label$/u,
    allow: [/^(?:ServiceIssue|HealthAdvisory|PlannedMaintenance|SecurityAdvisory|RCA)$/u]
  },
  {
    path: /^overview\.metrics\[\d+\]\.label$/u,
    allow: [
      new RegExp(`^(?:${DEFENDER_AGGREGATE_METRIC_LABELS.join("|")})$`, "u")
    ]
  },
  {
    // Measurements keep their Latin units.
    path: /^overview\.metrics\[\d+\]\.(?:value|change)$/u,
    allow: [MEASUREMENT]
  },
  {
    // Cited evidence is a measurement too, and is printed beside its Japanese label.
    path: /^aiInsights\[\d+\]\.numericEvidence\[\d+\]\.value$/u,
    allow: [MEASUREMENT]
  },
  {
    // Compliance standards are cited by their identifier, which is how a reader looks them up and
    // how Defender names them. The recognised families are enumerated rather than matched by shape:
    // an "uppercase words" allowance also accepted the English prose "REGULATORY COMPLIANCE
    // AGGREGATE". A standard outside this list fails loudly and is added deliberately, which is the
    // safe direction; a framework described in words is copy and still has to be Japanese.
    path: /^security\.compliance\[\d+\]\.framework$/u,
    allow: [
      /^(?:ISO|IEC|PCI DSS|NIST SP 800-53|NIST SP 800-171|NIST CSF|SOC|CIS|HIPAA|HITRUST|FedRAMP|CMMC|SWIFT CSP|CSA STAR|NL BIO|NZ ISM|RMIT|SOX|CCPA|GDPR)(?:[ -](?:[0-9][0-9A-Za-z.-]*|[Rr][0-9]+|[Vv][0-9.]+))*$/u
    ]
  }
];

const LATIN_RUN = /[A-Za-z][A-Za-z'’-]*(?:[ \t]+[A-Za-z'’-]+)*/gu;

/**
 * Paths whose stored value is a closed identifier set rather than reader-facing prose. The page maps
 * them to Japanese, so the audit judges what it renders and not what the file holds.
 *
 * Every other field is audited on its stored value as well as its rendered one, and that asymmetry
 * is the point. The defect this audit was written for was English data hidden behind an exact-match
 * translation table in the UI: the screen read Japanese while the published file did not, so a
 * render-only audit reported nothing. Judging the stored value too means such a table can no longer
 * be reintroduced to paper over English data — it would have to be declared here, and an entry here
 * only holds while a test proves the set is closed and derived from whatever produces it.
 */
const UI_MAPPED_IDENTIFIER_FIELDS: Array<{ path: RegExp; reason: string }> = [
  {
    // `classifyEndpoint` in `src/lib/sanitize.ts` replaces every hostname with one of six labels.
    // `display-formatters.test.ts` derives those six from `classifyEndpoint` itself, so a seventh
    // label fails that test rather than reaching the page untranslated.
    path: /^network\.telemetry\.flows\[\d+\]\.destination$/u,
    reason: "sanitizer endpoint classes, mapped by formatEndpointLabel"
  },
  {
    // The source key is the join key the AI evidence validator matches on, so it has to stay stable
    // and English in the file. `formatSourceName` maps the descriptive ones for display and leaves
    // Azure product names alone, and the rendered value is what this audit judges.
    path: /^sources\[\d+\]\.source$/u,
    reason: "source join keys, mapped by formatSourceName"
  }
];

/**
 * Identifiers a snapshot publishes about itself: region ids, Azure resource types, cost category
 * names, service names and the dashboard routes its own links point at. Deriving the allowance from
 * the data rather than from a pattern keeps it exact — a rule such as "strip anything after a slash"
 * also swallowed ordinary prose like "成功/failed" and let it pass.
 *
 * Only fields this audit does not itself check may contribute. `sources[].source` used to be listed
 * here and is checked, so every value it held certified itself: any English key at all read as an
 * allowed identifier and could never be reported. The source keys the dashboard shows are Azure
 * product names or are mapped by `formatSourceName`, so nothing needs them here.
 *
 * The rest are closed by construction: resource types and regions come from Azure's taxonomy,
 * Resource Health service names are the sanitizer's pseudonyms, and routes are a schema enum. Cost
 * category names are worded outside this repository, so only the ones shaped like a name join in —
 * see `COST_CATEGORY_NAME`. That field is checked too, and by the same rule, so a category is
 * either a name everywhere or prose everywhere.
 */
function publishedIdentifiers(snapshot: PublicSnapshotV1): string[] {
  const identifiers = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value && value.trim().length > 0) identifiers.add(value.trim());
  };

  for (const region of snapshot.inventory.byRegion) add(region.label);
  for (const type of snapshot.inventory.byType) add(type.label);
  for (const resource of snapshot.inventory.resources) {
    add(resource.type);
    add(resource.region);
  }
  for (const category of snapshot.cost.categories) {
    if (COST_CATEGORY_NAME.test(category.name.trim())) add(category.name);
  }
  for (const service of snapshot.reliability.services) add(service.name);
  for (const insight of snapshot.aiInsights) add(insight.route);
  for (const event of snapshot.overview.eventTimeline) add(event.route);

  // Longest first so "Azure SQL" is removed before the bare "Azure" inside it.
  return [...identifiers].sort((left, right) => right.length - left.length);
}

/**
 * Removes a known identifier only where it stands as a whole word. A plain substring removal shrank
 * English words that merely began with one — the identifier "Compute" reduced "Computed" to "d",
 * which is below the reporting length and so read as clean.
 */
function stripWholeWord(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/-]/gu, "\\$&");
  return text.replace(
    new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "gu"),
    " "
  );
}

function latinRuns(path: string, rendered: string, identifiers: string[]): string[] {
  for (const { path: pattern, allow } of FIELD_ALLOWANCES) {
    if (!pattern.test(path)) continue;
    if (allow.some((allowed) => allowed.test(rendered.trim()))) return [];
  }
  let text = rendered;
  for (const name of [...identifiers, ...PRODUCT_NAMES]) {
    text = stripWholeWord(text, name);
  }
  return (text.match(LATIN_RUN) ?? []).map((run) => run.trim()).filter((run) => run.length > 1);
}

/**
 * Anything Latin that survives the allowances is copy a Japanese reader has to decode, whether it
 * stands alone or is mixed into Japanese. An earlier rule forgave single words inside Japanese
 * text, which let "状態: Unavailable" and "成功/failed checks" through — exactly the half-translated
 * strings this audit exists to catch.
 */
function residue(path: string, rendered: string, identifiers: string[]): string {
  return latinRuns(path, rendered, identifiers).join(" / ");
}

/**
 * Walks every snapshot field the dashboard renders as prose and reports the ones that still read as
 * English. Latin is judged by what remains after removing product names, route paths and resource
 * identifiers, so a sentence stays a leak even when a Japanese word is mixed into it: prefixing
 * English with a Japanese label does not make it readable.
 */
export function findUiLanguageLeaks(snapshot: PublicSnapshotV1): UiLanguageLeak[] {
  const identifiers = publishedIdentifiers(snapshot);
  const checks: UiLanguageLeak[] = [];
  const check = (path: string, stored: string, rendered = stored) => {
    const renderedResidue = residue(path, rendered, identifiers);
    if (renderedResidue.length > 0) {
      checks.push({ path, stored, rendered, residue: renderedResidue, origin: "rendered" });
      return;
    }
    if (UI_MAPPED_IDENTIFIER_FIELDS.some((field) => field.path.test(path))) return;
    const storedResidue = residue(path, stored, identifiers);
    if (storedResidue.length > 0) {
      checks.push({ path, stored, rendered, residue: storedResidue, origin: "stored" });
    }
  };

  for (const [index, source] of snapshot.sources.entries()) {
    check(`sources[${index}].source`, source.source, formatSourceName(source.source));
  }

  for (const [index, metric] of snapshot.overview.metrics.entries()) {
    check(`overview.metrics[${index}].label`, metric.label);
    check(`overview.metrics[${index}].value`, metric.value);
    check(`overview.metrics[${index}].change`, metric.change);
  }

  for (const [index, event] of snapshot.overview.eventTimeline.entries()) {
    check(
      `overview.eventTimeline[${index}].timestamp`,
      event.timestamp,
      formatEventTimestamp(event.timestamp)
    );
    check(`overview.eventTimeline[${index}].title`, event.title, formatActivityTitle(event.title));
    check(`overview.eventTimeline[${index}].detail`, event.detail);
  }

  for (const [index, resource] of snapshot.inventory.resources.entries()) {
    check(`inventory.resources[${index}].change`, resource.change);
  }

  for (const [index, insight] of snapshot.aiInsights.entries()) {
    check(`aiInsights[${index}].title`, insight.title);
    check(`aiInsights[${index}].observation`, insight.observation);
    check(`aiInsights[${index}].impact`, insight.impact);
    check(`aiInsights[${index}].recommendedAction`, insight.recommendedAction);
    check(`aiInsights[${index}].period`, insight.period);
    for (const [evidenceIndex, evidence] of insight.numericEvidence.entries()) {
      check(`aiInsights[${index}].numericEvidence[${evidenceIndex}].label`, evidence.label);
      // The value is printed beside the label, so an evidence row worded as "1 unavailable
      // resources" reaches the reader as English even though it validates as evidence.
      check(`aiInsights[${index}].numericEvidence[${evidenceIndex}].value`, evidence.value);
    }
  }

  for (const [index, category] of snapshot.reliability.serviceHealth.categories.entries()) {
    check(`reliability.serviceHealth.categories[${index}].label`, category.label);
  }

  // The compliance framework label is copy this repository writes in both modes, not an API value:
  // the collector emits a single aggregate row of its own. It stays unaudited only while Defender is
  // unavailable and the list is empty, so it is checked here rather than when it becomes visible.
  for (const [index, entry] of snapshot.security.compliance.entries()) {
    check(`security.compliance[${index}].framework`, entry.framework);
  }

  // The network page prints the flow destination. The sanitizer stores one of a closed set of
  // endpoint labels there, which `formatEndpointLabel` maps to Japanese the same way source keys
  // are mapped, so the audit reads what the page shows: a label the formatter does not know falls
  // through unchanged and is reported instead of reaching the page in English.
  for (const [index, flow] of snapshot.network.telemetry.flows.entries()) {
    check(
      `network.telemetry.flows[${index}].destination`,
      flow.destination,
      formatEndpointLabel(flow.destination)
    );
  }

  // The security page prints assessment titles. Neither mode publishes an Azure-authored one:
  // `summarizeAssessments` replaces every AZURE title with a repository constant plus an ordinal,
  // and the DEMO fixture writes its own copy. So both modes are held to the same rule here.
  for (const [index, recommendation] of snapshot.security.recommendations.entries()) {
    check(`security.recommendations[${index}].title`, recommendation.title);
  }

  // The cost page prints category names. They are also the one identifier source worded outside
  // this repository, so checking them here is what stops a category worded as a sentence from
  // certifying that sentence on every other field.
  for (const [index, category] of snapshot.cost.categories.entries()) {
    check(`cost.categories[${index}].name`, category.name);
  }

  // Remaining deliberate exclusions, recorded so that no field is silently unaudited:
  //
  // `sources[].message`, `reliability.serviceHealth.message` and `network.telemetry.message` are
  // collection diagnostics the dashboard never shows. `src/App.diagnostics.test.tsx` renders every
  // route with a sentinel in those three fields and fails if any of them reaches the page, which is
  // when they would need auditing.
  //
  // `cost.categories[].name` is a Cost Management `ServiceName` — "Virtual Machines", "Storage",
  // "Bandwidth" — printed as the Azure product name it is, so it is held to `COST_CATEGORY_NAME`
  // rather than to the prose rule.
  //
  // `scope.displayName` is built by `src/lib/sanitize.ts` as `Azure subscription ${hash}` and is
  // rendered in the scope selector, so it is English on screen today. Unlike the flow destination
  // it is not a closed set — the hash varies — so a display mapping cannot cover it; the fix
  // belongs with the sanitizer and this audit should extend to it once that lands.

  return checks;
}

/**
 * Reports the fields that read as English, optionally narrowed to a subset of paths.
 *
 * `auditOnly` exists for the one snapshot published before the collector emitted Japanese.
 * `scripts/published-language-exemption.ts` pins that file by a hash taken with `aiInsights`
 * removed, because the AI workflow rewrites `aiInsights` in place and would otherwise break the
 * pin on its first refresh. Excusing the whole audit on a hash match would therefore excuse the
 * one part of the file the hash never covered: an insight published tomorrow could carry English
 * evidence and nothing here would say so. Narrowing to `aiInsights` keeps the excused set equal
 * to the frozen set.
 */
export function validateUiLanguage(
  snapshot: PublicSnapshotV1,
  options: { auditOnly?: RegExp } = {}
): void {
  const { auditOnly } = options;
  const found = findUiLanguageLeaks(snapshot).filter(
    (leak) => auditOnly === undefined || auditOnly.test(leak.path)
  );
  const [first] = found;
  if (!first) return;
  const value = first.origin === "stored" ? first.stored : first.rendered;
  const verb = first.origin === "stored" ? "stores" : "renders";
  throw new Error(
    `Snapshot shows English prose in a Japanese dashboard (${found.length} field(s)); first: ${first.path} ${verb} "${value}" (untranslated: "${first.residue}")`
  );
}
