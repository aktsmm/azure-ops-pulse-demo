import { z } from "zod";
import { WITHHELD_JPY_AMOUNT_LABEL, isWithheldJpyAmount } from "../src/lib/jpy-disclosure";
import { resourceAliasLabel } from "../src/lib/sanitize";
import { SOURCE_REASONS } from "../src/data/contracts";
import { isPrivateIpv4, isPrivateCidr, MASKED_PUBLIC_IPV4_PATTERN } from "../src/lib/network-evidence";
import { ADVISOR_CATEGORIES, ADVISOR_IMPACTS, ADVISOR_CATALOG, ADVISOR_RESOURCE_TYPES, ADVISOR_DETAILS_MESSAGE, advisorContent } from "../src/lib/advisor-catalog";

const severity = z.enum(["critical", "warning", "healthy", "info"]);
const statusBadge = z.enum([
  "Healthy",
  "Degraded",
  "Unavailable",
  "Unknown",
  "NotApplicable"
]);
const availability = z.enum(["available", "partial", "unavailable"]);
const sourceReason = z.enum(SOURCE_REASONS);
const costPeriodDiagnosticSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  reason: sourceReason.optional()
}).strict().superRefine((value, context) => {
  if ((value.availability === "unavailable") !== (value.reason !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only unavailable cost periods require a reason code" });
  }
});
const advisorCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const networkEvidenceSchema = z.object({
  privateIpv4: z.array(z.string().refine(isPrivateIpv4)).max(32),
  privateCidrs: z.array(z.string().refine(isPrivateCidr)).max(32),
  publicIpv4Masked: z.array(z.string().regex(new RegExp(MASKED_PUBLIC_IPV4_PATTERN))).max(32),
  truncated: z.boolean()
}).strict();
const resourceRefSchema = z.string().regex(/^res-[0-9a-f]{8}$/);
const vulnerabilitySchema = z.object({
  availability, message: z.string(),
  totalSubAssessments: advisorCount.nullable(), unhealthySubAssessments: advisorCount.nullable(),
  unmappedSubAssessments: advisorCount.nullable(), unknownStatusSubAssessments: advisorCount.nullable(),
  unmappedTargetSubAssessments: advisorCount.nullable().optional(),
  totalFindings: advisorCount.nullable(), truncated: z.boolean(),
  findings: z.array(z.object({
    cve: z.string().regex(/^CVE-\d{4}-\d{4,7}$/), severity: z.enum(["High", "Medium", "Low", "Unknown"]),
    resourceRefs: z.array(resourceRefSchema).max(100),
    patchable: z.boolean().optional(), cvssScore: z.number().min(0).max(10).optional()
  }).strict()).max(100)
}).strict().superRefine((value, context) => {
  const counts = [value.totalSubAssessments, value.unhealthySubAssessments, value.unmappedSubAssessments, value.unknownStatusSubAssessments, value.totalFindings];
  const invalid = value.availability === "unavailable"
    ? counts.some((count) => count !== null) || value.findings.length > 0 || value.truncated
    : counts.some((count) => count === null) ||
      value.unhealthySubAssessments! + value.unknownStatusSubAssessments! > value.totalSubAssessments! ||
      value.unmappedSubAssessments! > value.unhealthySubAssessments! || value.findings.length > value.totalFindings! ||
      (!value.truncated && value.totalFindings !== value.findings.length) ||
      (value.truncated && value.availability !== "partial");
  const targetCount = value.unmappedTargetSubAssessments;
  const invalidTargets = targetCount !== undefined && (value.availability === "unavailable"
    ? targetCount !== null
    : targetCount === null || targetCount > value.unhealthySubAssessments! - value.unmappedSubAssessments! ||
      (targetCount > 0 && value.availability !== "partial"));
  if (invalid || invalidTargets || new Set(value.findings.map((finding) => `${finding.cve}:${finding.severity}`)).size !== value.findings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Vulnerability evidence coverage must reconcile" });
  }
});
const assessmentCoverageSchema = z.object({
  totalAssessments: advisorCount, unhealthyAssessments: advisorCount,
  healthyAssessments: advisorCount, notApplicableAssessments: advisorCount, unknownAssessments: advisorCount,
  totalGroups: advisorCount, publishedGroups: advisorCount, truncated: z.boolean()
}).strict().superRefine((value, context) => {
  if (value.totalAssessments !== value.unhealthyAssessments + value.healthyAssessments + value.notApplicableAssessments + value.unknownAssessments ||
      value.publishedGroups > value.totalGroups || value.truncated !== (value.publishedGroups < value.totalGroups)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Assessment coverage must reconcile" });
  }
});
const advisorGroupSchema = z.object({
  resourceRefs: z.array(resourceRefSchema).max(100).optional(),
  targets: z.array(z.object({
    resourceRef: resourceRefSchema,
    type: z.string().regex(/^microsoft\.[a-z0-9]+(?:\/[a-z][a-z0-9]*)+$/i).optional(),
    region: z.string().regex(/^[a-z0-9-]+$/i).optional()
  }).strict()).max(100).optional(),
  scopeCounts: z.object({ resource: advisorCount, subscription: advisorCount, unknown: advisorCount }).strict().optional(),
  targetCoverage: z.object({
    totalResources: advisorCount, publishedResources: advisorCount, unresolvedResources: advisorCount, truncated: z.boolean()
  }).strict().optional(),
  id: z.string(),
  category: z.enum(ADVISOR_CATEGORIES),
  contentStatus: z.enum(["mapped", "withheld"]),
  count: advisorCount.positive(),
  impacts: z.object({ High: advisorCount, Medium: advisorCount, Low: advisorCount, Unknown: advisorCount }).strict(),
  affectedResourceCount: advisorCount.positive().nullable(),
  resourceTypes: z.array(z.object({
    type: z.string().refine((type) => ADVISOR_RESOURCE_TYPES.includes(type)),
    count: advisorCount.positive()
  }).strict()).min(1).max(ADVISOR_RESOURCE_TYPES.length),
  title: z.string(), description: z.string(), recommendedAction: z.string(),
  deferWhen: z.string(), caveat: z.string(), sourceUrl: z.string()
}).strict().superRefine((group, context) => {
  const refs = group.resourceRefs;
  const coverage = group.targetCoverage;
  if ((refs && (new Set(refs).size !== refs.length || group.targets?.length !== refs.length ||
      group.targets.some((target, index) => target.resourceRef !== refs[index]))) ||
      (group.scopeCounts && Object.values(group.scopeCounts).reduce((sum, count) => sum + count, 0) !== group.count) ||
      (coverage && (coverage.publishedResources !== refs?.length ||
        coverage.totalResources < coverage.publishedResources + coverage.unresolvedResources ||
        coverage.truncated !== (coverage.totalResources > coverage.publishedResources + coverage.unresolvedResources)))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Advisor target coverage must reconcile" });
  }
  const content = advisorContent(group.contentStatus === "mapped" ? group.id : "", group.category);
  if (Object.entries(content).some(([key, text]) => group[key as keyof typeof content] !== text) ||
      Object.values(group.impacts).reduce((sum, count) => sum + count, 0) !== group.count ||
      group.resourceTypes.reduce((sum, item) => sum + item.count, 0) !== group.count ||
      new Set(group.resourceTypes.map((item) => item.type)).size !== group.resourceTypes.length ||
      (group.affectedResourceCount !== null && group.affectedResourceCount > group.count)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Advisor content must match the closed catalog and reconcile record counts" });
  }
});
const advisorDetailsSchema = z.object({
  availability, message: z.literal(ADVISOR_DETAILS_MESSAGE),
  mappedRecommendationCount: advisorCount, withheldRecommendationCount: advisorCount,
  excludedRecommendationCount: advisorCount, lifecycleUnknownCount: advisorCount,
  affectedResourceCount: advisorCount.nullable(),
  groups: z.array(advisorGroupSchema).max(ADVISOR_CATALOG.length + ADVISOR_CATEGORIES.length)
}).strict();
const advisorSchema = z.object({
  availability,
  message: z.string(),
  recommendations: z.array(z.object({
    category: z.enum(["Cost", "HighAvailability", "Performance", "Security", "OperationalExcellence", "Other"]),
    impact: z.enum(["High", "Medium", "Low", "Unknown"]),
    count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  }).strict()).max(24),
  details: advisorDetailsSchema.optional()
}).strict().superRefine((value, context) => {
  const keys = value.recommendations.map((row) => `${row.category}:${row.impact}`);
  if ((value.availability === "unavailable" && keys.length) || new Set(keys).size !== keys.length ||
      !Number.isSafeInteger(value.recommendations.reduce((sum, row) => sum + row.count, 0))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Advisor unavailable data must be empty and aggregates unique" });
  }
  const details = value.details;
  if (!details) return;
  const fail = () => context.addIssue({ code: z.ZodIssueCode.custom, message: "Advisor details availability, lifecycle and totals must reconcile" });
  if (details.availability === "unavailable") {
    if (details.groups.length || details.mappedRecommendationCount || details.withheldRecommendationCount ||
        details.excludedRecommendationCount || details.lifecycleUnknownCount || details.affectedResourceCount !== null) fail();
    return;
  }
  const included = details.groups.reduce((sum, group) => sum + group.count, 0);
  const total = value.recommendations.reduce((sum, row) => sum + row.count, 0);
  if (!Number.isSafeInteger(total) || value.availability === "unavailable" ||
      new Set(details.groups.map((group) => group.id)).size !== details.groups.length ||
      details.groups.filter((group) => group.contentStatus === "mapped").reduce((sum, group) => sum + group.count, 0) !== details.mappedRecommendationCount ||
      details.groups.filter((group) => group.contentStatus === "withheld").reduce((sum, group) => sum + group.count, 0) !== details.withheldRecommendationCount ||
      included + details.excludedRecommendationCount !== total || details.lifecycleUnknownCount > included ||
      (details.affectedResourceCount !== null && (details.groups.some((group) => group.affectedResourceCount === null) ||
        details.affectedResourceCount > details.groups.reduce((sum, group) => sum + (group.affectedResourceCount ?? 0), 0) ||
        details.groups.some((group) => (group.affectedResourceCount ?? 0) > details.affectedResourceCount!))) ||
      (details.availability === "available" && (details.withheldRecommendationCount > 0 || details.lifecycleUnknownCount > 0 ||
        details.affectedResourceCount === null || value.availability !== "available"))) fail();
  for (const category of ADVISOR_CATEGORIES) {
    for (const impact of ADVISOR_IMPACTS) {
      const detailCount = details.groups.filter((group) => group.category === category).reduce((sum, group) => sum + group.impacts[impact], 0);
      if (detailCount > (value.recommendations.find((row) => row.category === category && row.impact === impact)?.count ?? 0)) fail();
    }
  }
});
const topologySchema = z.object({
  availability,
  message: z.string(),
  nodes: z.array(z.object({
    network: networkEvidenceSchema.optional(),
    id: z.string().regex(/^res-[0-9a-f]{8}$/),
    type: z.string().regex(/^microsoft\.[a-z0-9]+(?:\/[a-z][a-z0-9]*)+$/i),
    region: z.string().regex(/^[a-z0-9-]+$/i).optional(),
    referenceOnly: z.boolean(),
    scope: z.enum(["inventory", "external", "uncollected"])
  }).strict()).max(400),
  edges: z.array(z.object({
    source: z.string().regex(/^res-[0-9a-f]{8}$/),
    target: z.string().regex(/^res-[0-9a-f]{8}$/),
    kind: z.enum(["contains", "subnet", "virtual-machine", "peering", "network-security-group",
      "route-table", "nat-gateway", "backend", "frontend", "public-ip", "private-link"])
  }).strict()).max(800),
  truncated: z.boolean()
}).strict().superRefine((value, context) => {
  const ids = new Set(value.nodes.map((node) => node.id));
  const edgeIds = new Set(value.edges.map((edge) => `${edge.source}|${edge.target}|${edge.kind}`));
  if (ids.size !== value.nodes.length || edgeIds.size !== value.edges.length ||
      value.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Topology must have unique nodes/edges and no dangling endpoints" });
  }
  if (value.nodes.some((node) => node.referenceOnly !== (node.scope !== "inventory"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Topology reference-only scope is inconsistent" });
  }
  if ((value.truncated || value.nodes.some((node) => node.referenceOnly)) && value.availability !== "partial") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Truncated or reference-only topology must be partial" });
  }
  if (value.availability === "unavailable" && (value.nodes.length || value.edges.length || value.truncated)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Unavailable topology must not contain nodes or edges" });
  }
});
const publishableAvailability = new Set(["available", "partial"]);
const reliabilityCoverageSchema = z
  .object({
    totalResources: z.number().nonnegative(),
    supportedResources: z.number().nonnegative(),
    notApplicableResources: z.number().nonnegative(),
    evaluatedResources: z.number().nonnegative(),
    unevaluatedResources: z.number().nonnegative(),
    healthyResources: z.number().nonnegative(),
    degradedResources: z.number().nonnegative(),
    unavailableResources: z.number().nonnegative(),
    supportedCoveragePercent: z.number().min(0).max(100).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.supportedResources + value.notApplicableResources !== value.totalResources) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Supported and not-applicable resources must add up to the total"
      });
    }
    if (
      value.healthyResources + value.degradedResources + value.unavailableResources !==
      value.evaluatedResources
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evaluated resources must equal healthy plus degraded plus unavailable"
      });
    }
    if (value.evaluatedResources + value.unevaluatedResources !== value.supportedResources) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evaluated and unevaluated resources must add up to the supported resources"
      });
    }
    if ((value.supportedResources === 0) !== (value.supportedCoveragePercent === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Coverage percent must be null exactly when no resource type is supported"
      });
    }
  });
const serviceHealthSummarySchema = z
  .object({
    availability,
    message: z.string(),
    activeEvents: z.number().nonnegative().nullable(),
    resolvedEvents: z.number().nonnegative().nullable(),
    categories: z.array(
      z.object({ label: z.string(), count: z.number().nonnegative() }).strict()
    )
  })
  .strict()
  .superRefine((value, context) => {
    const unavailable = value.availability === "unavailable";
    if (unavailable && (value.activeEvents !== null || value.resolvedEvents !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unavailable Service Health must not publish event counts"
      });
    }
    if (!unavailable && (value.activeEvents === null || value.resolvedEvents === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Collected Service Health requires explicit event counts"
      });
    }
  });
const networkMetricCoverageSchema = z
  .object({
    inventoryTotal: z.number().nonnegative(),
    sampledResources: z.number().nonnegative(),
    metricCapableResources: z.number().nonnegative(),
    metricSeries: z.number().nonnegative(),
    notApplicableResources: z.number().nonnegative(),
    failedResources: z.number().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.metricCapableResources + value.notApplicableResources + value.failedResources !==
      value.sampledResources
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Metric probe outcomes must add up to the sampled resources"
      });
    }
    if (value.sampledResources > value.inventoryTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sampled resources cannot exceed the network inventory total"
      });
    }
  });
const defenderMetricLabels = new Set(["Defender recommendations", "Open alerts"]);
const costAmountSchema = z
  .object({
    availability: z.enum(["available", "unavailable"]),
    approximateAmount: z.string().startsWith("約¥").nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.availability === "available") !== (value.approximateAmount !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cost amount availability must match approximateAmount"
      });
    }
  });
const costBudgetSchema = z
  .object({
    availability: z.enum(["available", "unavailable"]),
    usedPercent: z.number().min(0).max(100).nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.availability === "available") !== (value.usedPercent !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Budget availability must match usedPercent"
      });
    }
  });

export const insightSchema = z
  .object({
    id: z.string().regex(/^insight-[0-9a-f]{8}$/),
    severity,
    title: z.string().min(8).max(120),
    observation: z.string().min(20).max(500),
    impact: z.string().min(20).max(500),
    numericEvidence: z
      .array(
        z
          .object({
            label: z.string().min(2).max(80),
            value: z.string().min(1).max(40),
            source: z
              .string()
              .regex(/^(overview|cost|inventory|reliability|security|network|advisor)(\.[A-Za-z0-9_-]+)+$/)
          })
          .strict()
      )
      .min(1)
      .max(6),
    recommendedAction: z.string().min(20).max(500),
    confidence: z.number().min(0).max(1),
    period: z.string().min(3).max(80),
    route: z.enum([
      "/overview",
      "/cost",
      "/resources",
      "/reliability",
      "/security",
      "/recommendations",
      "/network",
      "/ai-insights"
    ])
  })
  .strict();

export const publicSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1.4.0"),
    generatedAt: z.string().datetime(),
    mode: z.enum(["DEMO", "AZURE"]),
    freshness: z
      .object({
        state: z.enum(["fresh", "stale"]),
        ageMinutes: z.number().nonnegative(),
        lastSuccessfulCollection: z.string().datetime(),
        nextScheduledCollection: z.string().min(5)
      })
      .strict(),
    scope: z
      .object({
        displayName: z.string().min(1),
        subscriptionId: z.string().min(4),
        tenantId: z.string().min(4)
      })
      .strict(),
    sources: z.array(
      z
        .object({
          source: z.string(),
          availability: z.enum(["available", "partial", "unavailable"]),
          message: z.string(),
          reason: sourceReason.optional()
        })
        .strict()
    ),
    overview: z
      .object({
        metrics: z.array(
          z
            .object({
              label: z.string(),
              value: z.string(),
              change: z.string(),
              direction: z.enum(["up", "down", "flat"]),
              severity,
              points: z.array(z.number()).min(2)
            })
            .strict()
        ),
        postureScore: z.number().min(0).max(100).nullable(),
        eventTimeline: z.array(
          z
            .object({
              id: z.string(),
              timestamp: z.string(),
              severity,
              title: z.string(),
              detail: z.string(),
              route: z.string()
            })
            .strict()
        ),
        regionalHealth: z.array(
          z.object({ region: z.string(), score: z.number().min(0).max(100), status: severity }).strict()
        )
      })
      .strict(),
    cost: z
      .object({
        periodDiagnostics: z.object({
          current: costPeriodDiagnosticSchema,
          previous: costPeriodDiagnosticSchema
        }).strict().optional(),
        current: costAmountSchema,
        previous: costAmountSchema,
        deltaPercent: z.number().nullable(),
        forecast: costAmountSchema,
        budget: costBudgetSchema,
        normalizedTrend: z.array(z.number()),
        categories: z.array(
          z
            .object({
              name: z.string(),
              approximateAmount: z.union([z.string().startsWith("約¥"), z.literal("Unavailable")]),
              sharePercent: z.number().min(0).max(100),
              deltaPercent: z.number().nullable()
            })
            .strict()
        )
      })
      .strict()
      .superRefine((value, context) => {
        for (const period of ["current", "previous"] as const) {
          if (value.periodDiagnostics && value.periodDiagnostics[period].availability !== value[period].availability) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["periodDiagnostics", period],
              message: "Cost period diagnosis must match amount availability"
            });
          }
        }
        // Amounts below the publication rounding unit are withheld, so a percentage measured against
        // them cannot be grounded in anything the reader can see. Real collections produced
        // "+38,537.8%" for a service reported as 約¥1千未満 in both periods.
        if (isWithheldJpyAmount(value.current.approximateAmount) && value.deltaPercent !== null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deltaPercent"],
            message: `A change cannot be published while the current amount is ${WITHHELD_JPY_AMOUNT_LABEL}`
          });
        }
        if (isWithheldJpyAmount(value.previous.approximateAmount) && value.deltaPercent !== null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deltaPercent"],
            message: `A change cannot be published while the previous amount is ${WITHHELD_JPY_AMOUNT_LABEL}`
          });
        }
        value.categories.forEach((category, index) => {
          if (isWithheldJpyAmount(category.approximateAmount) && category.deltaPercent !== null) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["categories", index, "deltaPercent"],
              message: `A change cannot be published while the service amount is ${WITHHELD_JPY_AMOUNT_LABEL}`
            });
          }
        });
      }),
    inventory: z
      .object({
        total: z.number().nonnegative(),
        resources: z.array(
          z
            .object({
              id: z.string().regex(/^res-[0-9a-f]{8}$/),
              name: z.string().regex(/^[A-Za-z0-9]+-[0-9a-f]{8}$/),
              resourceGroup: z.string().regex(/^rg-[0-9a-f]{8}$/),
              network: networkEvidenceSchema.optional(),
              type: z.string(),
              region: z.string(),
              status: statusBadge,
              owner: z.string().regex(/^identity-[0-9a-f]{8}$/),
              tags: z.record(z.string()),
              change: z.string()
            })
            .strict()
            .superRefine((resource, ctx) => {
              // The alias prefix is only safe because it is copied from the published type. A
              // prefix that does not match means it came from somewhere else — the Azure name being
              // the obvious candidate — so the candidate is rejected rather than published.
              const expected = resourceAliasLabel(resource.type);
              if (!resource.name.startsWith(`${expected}-`)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["name"],
                  message: `Resource alias "${resource.name}" is not derived from the published type "${resource.type}"`
                });
              }
            })
        ),
        byType: z.array(z.object({ label: z.string(), count: z.number().nonnegative() }).strict()),
        byRegion: z.array(z.object({ label: z.string(), count: z.number().nonnegative() }).strict())
      })
      .strict(),
    reliability: z
      .object({
        availability: z.string(),
        incidentAvailability: z.enum(["available", "unavailable"]),
        incidents: z.number().nonnegative().nullable(),
        meanTimeToRecover: z.string(),
        services: z.array(
          z
            .object({
              name: z.string(),
              objective: z.string(),
              actual: z.string(),
              incidents: z.number().nonnegative(),
              status: severity,
              budgetRemainingPercent: z.number().min(0).max(100)
            })
            .strict()
        ),
        coverage: reliabilityCoverageSchema,
        serviceHealth: serviceHealthSummarySchema
      })
      .strict()
      .superRefine((value, context) => {
        if ((value.incidentAvailability === "available") !== (value.incidents !== null)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["incidents"],
            message: "Incident availability must match the incidents value"
          });
        }
      }),
    security: z
      .object({
        assessmentCoverage: assessmentCoverageSchema.optional(),
        vulnerabilities: vulnerabilitySchema.optional(),
        fieldAvailability: z.object({
          secureScore: availability,
          assessments: availability,
          activeAlerts: availability
        }).strict().optional(),
        secureScore: z.number().min(0).max(100).nullable(),
        activeAlerts: z.number().nonnegative().nullable(),
        recommendations: z.array(
          z
            .object({
              title: z.string(),
              severity,
              affectedCount: z.number().nonnegative(),
              unknownCount: advisorCount.optional(),
              status: z.enum(["Open", "In progress", "Resolved"])
            })
            .strict()
        ),
        compliance: z.array(
          z.object({ framework: z.string(), score: z.number().min(0).max(100) }).strict()
        )
      })
      .strict()
      .superRefine((value, context) => {
        if (value.assessmentCoverage && (value.assessmentCoverage.publishedGroups !== value.recommendations.length ||
            value.fieldAvailability?.assessments === "unavailable")) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Assessment coverage requires collected assessment rows" });
        }
        const fields = value.fieldAvailability;
        if (!fields) return;
        if ((fields.secureScore === "unavailable") !== (value.secureScore === null) ||
            (fields.activeAlerts === "unavailable") !== (value.activeAlerts === null) ||
            (fields.assessments === "unavailable" && value.recommendations.length)) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Defender field availability must gate its values independently" });
        }
      }),
    network: z
      .object({
        topology: topologySchema.optional(),
        inventory: z
          .object({
            total: z.number().nonnegative(),
            byType: z.array(z.object({ label: z.string(), count: z.number().nonnegative() }).strict()),
            byRegion: z.array(
              z.object({ label: z.string(), count: z.number().nonnegative() }).strict()
            )
          })
          .strict(),
        metricCoverage: networkMetricCoverageSchema.nullable(),
        telemetry: z
          .object({
            availability,
            message: z.string(),
            healthyConnections: z.number().nonnegative().nullable(),
            degradedConnections: z.number().nonnegative().nullable(),
            blockedFlows: z.number().nonnegative().nullable(),
            flows: z.array(
              z
                .object({
                  id: z.string().regex(/^flow-[0-9a-f]{8}$/),
                  source: z.string(),
                  destination: z.string(),
                  protocol: z.string(),
                  status: z.enum(["Allowed", "Degraded", "Blocked"]),
                  latency: z.string(),
                  throughput: z.string()
                })
                .strict()
            )
          })
          .strict()
          .superRefine((value, context) => {
            const unavailable = value.availability === "unavailable";
            const counts = [
              value.healthyConnections,
              value.degradedConnections,
              value.blockedFlows
            ];
            if (unavailable && (counts.some((count) => count !== null) || value.flows.length)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Unavailable flow telemetry must not contain counts or flows"
              });
            }
            if (!unavailable && counts.some((count) => count === null)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Available flow telemetry requires explicit counts"
              });
            }
          })
      })
      .strict(),
    aiInsights: z.array(insightSchema),
    advisor: advisorSchema.optional()
  })
  .strict()
  .superRefine((snapshot, context) => {
    const inventory = new Map(snapshot.inventory.resources.map((item) => [item.id, item]));
    if (snapshot.security.vulnerabilities?.findings.some((finding) => finding.resourceRefs.some((ref) => !inventory.has(ref)))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Vulnerability target references must match inventory" });
    }
    for (const group of snapshot.advisor?.details?.groups ?? []) {
      if (group.resourceRefs?.some((ref) => !inventory.has(ref)) ||
          group.targets?.some((target) => {
            const item = inventory.get(target.resourceRef);
            return !item || (target.type !== undefined && target.type !== item.type) ||
              (target.region !== undefined && target.region !== item.region);
          })) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Advisor targets must match observed inventory context" });
      }
    }
    for (const [name, value] of [
      ["Azure Advisor", snapshot.advisor],
      ["Network topology", snapshot.network.topology]
    ] as const) {
      if (!value) continue;
      const source = snapshot.sources.find((item) => item.source === name);
      if (!source || source.availability !== value.availability) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `${name} status must match its collected source` });
      }
    }
    const fields = snapshot.security.fieldAvailability;
    if (fields && snapshot.overview.metrics.some((metric) =>
      (metric.label === "Defender recommendations" && fields.assessments === "unavailable") ||
      (metric.label === "Open alerts" && fields.activeAlerts === "unavailable"))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Defender metric lacks field-level evidence" });
    }
    const resourceHealth = snapshot.sources.find((source) => source.source === "Resource Health");
    // `partial` is a real collection outcome (some supported resources evaluated), so it may
    // publish aggregates; only `unavailable` and a missing source must stay empty.
    const resourceHealthPublishable = publishableAvailability.has(
      resourceHealth?.availability ?? "unavailable"
    );
    if (!resourceHealthPublishable && snapshot.overview.postureScore !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overview", "postureScore"],
        message: "Resource Health posture must be null unless the source published data"
      });
    }
    if (
      !resourceHealthPublishable &&
      (snapshot.reliability.incidentAvailability !== "unavailable" ||
        snapshot.reliability.incidents !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "incidents"],
        message: "Reliability incidents must be unavailable unless Resource Health published data"
      });
    }
    if (
      snapshot.reliability.coverage.evaluatedResources > 0 &&
      resourceHealth?.availability === "unavailable"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "coverage"],
        message: "Evaluated resources cannot exist while Resource Health reports unavailable"
      });
    }
    if (
      snapshot.reliability.coverage.evaluatedResources === 0 &&
      resourceHealth?.availability === "available"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "coverage"],
        message: "Resource Health cannot report available while nothing was evaluated"
      });
    }
    if (snapshot.reliability.coverage.totalResources !== snapshot.inventory.total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "coverage", "totalResources"],
        message: "Reliability coverage must count every inventoried resource"
      });
    }

    const serviceHealthSource = snapshot.sources.find((source) => source.source === "Service Health");
    if (
      serviceHealthSource &&
      serviceHealthSource.availability !== snapshot.reliability.serviceHealth.availability
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "serviceHealth", "availability"],
        message: "Service Health summary must agree with the reported source availability"
      });
    }
    if (!serviceHealthSource && snapshot.reliability.serviceHealth.availability !== "unavailable") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "serviceHealth"],
        message: "A published Service Health summary requires a Service Health source entry"
      });
    }

    const costSource = snapshot.sources.find((source) => source.source === "Cost Management");
    if (
      costSource &&
      publishableAvailability.has(costSource.availability) &&
      snapshot.cost.current.availability !== "available"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cost", "current"],
        message: "Cost Management cannot report collected data without a published current amount"
      });
    }

    const defender = snapshot.sources.find((source) => source.source === "Defender for Cloud");
    const defenderPublishable = publishableAvailability.has(defender?.availability ?? "unavailable");
    if (
      !defenderPublishable &&
      (snapshot.security.secureScore !== null ||
        snapshot.security.activeAlerts !== null ||
        snapshot.security.recommendations.length > 0 ||
        snapshot.security.compliance.length > 0 ||
        snapshot.overview.metrics.some((metric) => defenderMetricLabels.has(metric.label)))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["security"],
        message: "Unavailable Defender data must not expose aggregate values"
      });
    }
  });
