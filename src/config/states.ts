/**
 * Which states the site covers, and where each one lives.
 *
 * Adding a state means flipping `enabled` here and shipping a data folder at
 * `src/data/<slug>/` plus a fetcher for it. Nothing else in the app is
 * state-specific.
 */

export interface StateConfig {
  name: string;
  slug: string;
  enabled: boolean;
}

export const STATES: Record<string, StateConfig> = {
  AL: { name: "Alabama", slug: "alabama", enabled: true },
  AK: { name: "Alaska", slug: "alaska", enabled: true },
  AZ: { name: "Arizona", slug: "arizona", enabled: true },
  AR: { name: "Arkansas", slug: "arkansas", enabled: true },
  CA: { name: "California", slug: "california", enabled: true },
  CO: { name: "Colorado", slug: "colorado", enabled: true },
  CT: { name: "Connecticut", slug: "connecticut", enabled: true },
  DE: { name: "Delaware", slug: "delaware", enabled: true },
  DC: { name: "District of Columbia", slug: "district-of-columbia", enabled: true },
  FL: { name: "Florida", slug: "florida", enabled: true },
  GA: { name: "Georgia", slug: "georgia", enabled: true },
  HI: { name: "Hawaii", slug: "hawaii", enabled: true },
  ID: { name: "Idaho", slug: "idaho", enabled: true },
  IL: { name: "Illinois", slug: "illinois", enabled: true },
  IN: { name: "Indiana", slug: "indiana", enabled: true },
  IA: { name: "Iowa", slug: "iowa", enabled: true },
  KS: { name: "Kansas", slug: "kansas", enabled: true },
  KY: { name: "Kentucky", slug: "kentucky", enabled: true },
  LA: { name: "Louisiana", slug: "louisiana", enabled: true },
  ME: { name: "Maine", slug: "maine", enabled: true },
  MD: { name: "Maryland", slug: "maryland", enabled: true },
  MA: { name: "Massachusetts", slug: "massachusetts", enabled: true },
  MI: { name: "Michigan", slug: "michigan", enabled: true },
  MN: { name: "Minnesota", slug: "minnesota", enabled: true },
  MS: { name: "Mississippi", slug: "mississippi", enabled: true },
  MO: { name: "Missouri", slug: "missouri", enabled: true },
  MT: { name: "Montana", slug: "montana", enabled: true },
  NE: { name: "Nebraska", slug: "nebraska", enabled: true },
  NV: { name: "Nevada", slug: "nevada", enabled: true },
  NH: { name: "New Hampshire", slug: "new-hampshire", enabled: true },
  NJ: { name: "New Jersey", slug: "new-jersey", enabled: true },
  NM: { name: "New Mexico", slug: "new-mexico", enabled: true },
  NY: { name: "New York", slug: "new-york", enabled: true },
  NC: { name: "North Carolina", slug: "north-carolina", enabled: true },
  ND: { name: "North Dakota", slug: "north-dakota", enabled: true },
  OH: { name: "Ohio", slug: "ohio", enabled: true },
  OK: { name: "Oklahoma", slug: "oklahoma", enabled: true },
  OR: { name: "Oregon", slug: "oregon", enabled: true },
  PA: { name: "Pennsylvania", slug: "pennsylvania", enabled: true },
  RI: { name: "Rhode Island", slug: "rhode-island", enabled: true },
  SC: { name: "South Carolina", slug: "south-carolina", enabled: true },
  SD: { name: "South Dakota", slug: "south-dakota", enabled: true },
  TN: { name: "Tennessee", slug: "tennessee", enabled: true },
  TX: { name: "Texas", slug: "texas", enabled: true },
  UT: { name: "Utah", slug: "utah", enabled: true },
  VT: { name: "Vermont", slug: "vermont", enabled: true },
  VA: { name: "Virginia", slug: "virginia", enabled: true },
  WA: { name: "Washington", slug: "washington", enabled: true },
  WV: { name: "West Virginia", slug: "west-virginia", enabled: true },
  WI: { name: "Wisconsin", slug: "wisconsin", enabled: true },
  WY: { name: "Wyoming", slug: "wyoming", enabled: true },
};

export const ENABLED_STATES = Object.entries(STATES)
  .filter(([, s]) => s.enabled)
  .map(([code, s]) => ({ code, ...s }));

export function stateBySlug(slug: string | undefined): (StateConfig & { code: string }) | null {
  if (!slug) return null;
  const entry = Object.entries(STATES).find(([, s]) => s.slug === slug.toLowerCase());
  return entry ? { code: entry[0], ...entry[1] } : null;
}
