import { z } from "zod";

const severity = z.enum(["critical", "warning", "healthy", "info"]);
const statusBadge = z.enum(["Healthy", "Degraded", "Unavailable", "Unknown"]);
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
              .regex(/^(overview|cost|inventory|reliability|security|network)(\.[A-Za-z0-9_-]+)+$/)
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
      "/network",
      "/ai-insights"
    ])
  })
  .strict();

export const publicSnapshotSchema = z
  .object({
    schemaVersion: z.literal("1.2.0"),
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
          message: z.string()
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
      .strict(),
    inventory: z
      .object({
        total: z.number().nonnegative(),
        resources: z.array(
          z
            .object({
              id: z.string().regex(/^res-[0-9a-f]{8}$/),
              name: z.string(),
              resourceGroup: z.string(),
              type: z.string(),
              region: z.string(),
              status: statusBadge,
              owner: z.string().regex(/^identity-[0-9a-f]{8}$/),
              tags: z.record(z.string()),
              change: z.string()
            })
            .strict()
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
        )
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
        secureScore: z.number().min(0).max(100).nullable(),
        activeAlerts: z.number().nonnegative().nullable(),
        recommendations: z.array(
          z
            .object({
              title: z.string(),
              severity,
              affectedCount: z.number().nonnegative(),
              status: z.enum(["Open", "In progress", "Resolved"])
            })
            .strict()
        ),
        compliance: z.array(
          z.object({ framework: z.string(), score: z.number().min(0).max(100) }).strict()
        )
      })
      .strict(),
    network: z
      .object({
        inventory: z
          .object({
            total: z.number().nonnegative(),
            byType: z.array(z.object({ label: z.string(), count: z.number().nonnegative() }).strict()),
            byRegion: z.array(
              z.object({ label: z.string(), count: z.number().nonnegative() }).strict()
            )
          })
          .strict(),
        telemetry: z
          .object({
            availability: z.enum(["available", "partial", "unavailable"]),
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
    aiInsights: z.array(insightSchema)
  })
  .strict()
  .superRefine((snapshot, context) => {
    const resourceHealth = snapshot.sources.find((source) => source.source === "Resource Health");
    if (resourceHealth?.availability !== "available" && snapshot.overview.postureScore !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overview", "postureScore"],
        message: "Resource Health posture must be null unless the source is available"
      });
    }
    if (
      resourceHealth?.availability !== "available" &&
      (snapshot.reliability.incidentAvailability !== "unavailable" ||
        snapshot.reliability.incidents !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reliability", "incidents"],
        message: "Reliability incidents must be unavailable unless Resource Health is available"
      });
    }

    const defender = snapshot.sources.find((source) => source.source === "Defender for Cloud");
    if (
      defender?.availability !== "available" &&
      (snapshot.security.secureScore !== null ||
        snapshot.security.activeAlerts !== null ||
        snapshot.security.recommendations.length > 0 ||
        snapshot.security.compliance.length > 0 ||
        snapshot.overview.metrics.some((metric) => defenderMetricLabels.has(metric.label)))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["security"],
        message: "Unavailable or partial Defender data must not expose aggregate values"
      });
    }
  });
