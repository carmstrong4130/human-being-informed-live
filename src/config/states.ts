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
  AL: { name: "Alabama", slug: "alabama", enabled: false },
  AK: { name: "Alaska", slug: "alaska", enabled: false },
  AZ: { name: "Arizona", slug: "arizona", enabled: false },
  AR: { name: "Arkansas", slug: "arkansas", enabled: false },
  CA: { name: "California", slug: "california", enabled: false },
  CO: { name: "Colorado", slug: "colorado", enabled: false },
  CT: { name: "Connecticut", slug: "connecticut", enabled: false },
  DE: { name: "Delaware", slug: "delaware", enabled: false },
  DC: { name: "District of Columbia", slug: "district-of-columbia", enabled: false },
  FL: { name: "Florida", slug: "florida", enabled: false },
  GA: { name: "Georgia", slug: "georgia", enabled: false },
  HI: { name: "Hawaii", slug: "hawaii", enabled: false },
  ID: { name: "Idaho", slug: "idaho", enabled: false },
  IL: { name: "Illinois", slug: "illinois", enabled: false },
  IN: { name: "Indiana", slug: "indiana", enabled: false },
  IA: { name: "Iowa", slug: "iowa", enabled: false },
  KS: { name: "Kansas", slug: "kansas", enabled: false },
  KY: { name: "Kentucky", slug: "kentucky", enabled: false },
  LA: { name: "Louisiana", slug: "louisiana", enabled: false },
  ME: { name: "Maine", slug: "maine", enabled: false },
  MD: { name: "Maryland", slug: "maryland", enabled: false },
  MA: { name: "Massachusetts", slug: "massachusetts", enabled: false },
  MI: { name: "Michigan", slug: "michigan", enabled: false },
  MN: { name: "Minnesota", slug: "minnesota", enabled: false },
  MS: { name: "Mississippi", slug: "mississippi", enabled: false },
  MO: { name: "Missouri", slug: "missouri", enabled: false },
  MT: { name: "Montana", slug: "montana", enabled: false },
  NE: { name: "Nebraska", slug: "nebraska", enabled: false },
  NV: { name: "Nevada", slug: "nevada", enabled: false },
  NH: { name: "New Hampshire", slug: "new-hampshire", enabled: false },
  NJ: { name: "New Jersey", slug: "new-jersey", enabled: false },
  NM: { name: "New Mexico", slug: "new-mexico", enabled: false },
  NY: { name: "New York", slug: "new-york", enabled: false },
  NC: { name: "North Carolina", slug: "north-carolina", enabled: false },
  ND: { name: "North Dakota", slug: "north-dakota", enabled: false },
  OH: { name: "Ohio", slug: "ohio", enabled: false },
  OK: { name: "Oklahoma", slug: "oklahoma", enabled: false },
  OR: { name: "Oregon", slug: "oregon", enabled: false },
  PA: { name: "Pennsylvania", slug: "pennsylvania", enabled: false },
  RI: { name: "Rhode Island", slug: "rhode-island", enabled: false },
  SC: { name: "South Carolina", slug: "south-carolina", enabled: false },
  SD: { name: "South Dakota", slug: "south-dakota", enabled: false },
  TN: { name: "Tennessee", slug: "tennessee", enabled: false },
  TX: { name: "Texas", slug: "texas", enabled: false },
  UT: { name: "Utah", slug: "utah", enabled: true },
  VT: { name: "Vermont", slug: "vermont", enabled: false },
  VA: { name: "Virginia", slug: "virginia", enabled: false },
  WA: { name: "Washington", slug: "washington", enabled: false },
  WV: { name: "West Virginia", slug: "west-virginia", enabled: false },
  WI: { name: "Wisconsin", slug: "wisconsin", enabled: false },
  WY: { name: "Wyoming", slug: "wyoming", enabled: false },
};

export const ENABLED_STATES = Object.entries(STATES)
  .filter(([, s]) => s.enabled)
  .map(([code, s]) => ({ code, ...s }));

export function stateBySlug(slug: string | undefined): (StateConfig & { code: string }) | null {
  if (!slug) return null;
  const entry = Object.entries(STATES).find(([, s]) => s.slug === slug.toLowerCase());
  return entry ? { code: entry[0], ...entry[1] } : null;
}
