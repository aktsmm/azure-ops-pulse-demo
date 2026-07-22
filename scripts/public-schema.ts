import { z } from "zod";

const severity = z.enum(["critical", "warning", "healthy", "info"]);
const statusBadge = z.enum(["Healthy", "Degraded", "Unavailable", "Unknown"]);

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
    schemaVersion: z.literal("1.0.0"),
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
        postureScore: z.number().min(0).max(100),
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
        currentApproximate: z.union([z.string().startsWith("約¥"), z.literal("Unavailable")]),
        previousApproximate: z.union([z.string().startsWith("約¥"), z.literal("Unavailable")]),
        deltaPercent: z.number(),
        forecastApproximate: z.union([z.string().startsWith("約¥"), z.literal("Unavailable")]),
        budgetUsedPercent: z.number().min(0).max(100),
        normalizedTrend: z.array(z.number()),
        categories: z.array(
          z
            .object({
              name: z.string(),
              approximateAmount: z.union([z.string().startsWith("約¥"), z.literal("Unavailable")]),
              sharePercent: z.number().min(0).max(100),
              deltaPercent: z.number()
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
        incidents: z.number().nonnegative(),
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
      .strict(),
    security: z
      .object({
        secureScore: z.number().min(0).max(100),
        activeAlerts: z.number().nonnegative(),
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
        healthyConnections: z.number().nonnegative(),
        degradedConnections: z.number().nonnegative(),
        blockedFlows: z.number().nonnegative(),
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
      .strict(),
    aiInsights: z.array(insightSchema)
  })
  .strict();
