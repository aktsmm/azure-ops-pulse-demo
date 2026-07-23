export function uncollectedIncidentMetric() {
  return {
    incidentAvailability: "unavailable" as const,
    incidents: null
  };
}
