import { useNavigate } from "@tanstack/react-router";

import { STATES } from "@/config/states";
import { DC_MARKER, INSET_SEPARATORS, MAP_VIEWBOX, STATE_SHAPES } from "./us-map-shapes";

const BASE_SHAPE = "transition-all duration-150 [stroke-width:0.75]";
const INACTIVE = "fill-stateinactive stroke-statestroke hover:fill-stategray";
const ACTIVE =
  "fill-stategreen stroke-stategreen/60 drop-shadow-[0_0_10px_rgba(47,176,92,0.35)] hover:brightness-110 hover:drop-shadow-[0_0_18px_rgba(47,176,92,0.55)] cursor-pointer outline-none";

/**
 * The clickable US map. Geometry comes from the CC0 Wikimedia base map
 * (see `us-map-shapes.ts`); which states respond comes from `config/states.ts`.
 */
export default function USMap() {
  const navigate = useNavigate();

  return (
    <svg
      viewBox={MAP_VIEWBOX}
      className="h-auto w-full"
      role="group"
      aria-label="Map of the United States. Select a state to see what it is voting on."
    >
      {STATE_SHAPES.map((shape) => {
        const config = STATES[shape.code];
        const enabled = Boolean(config?.enabled);
        const name = config?.name ?? shape.name;

        const go = () => {
          if (enabled && config) navigate({ to: `/${config.slug}` });
        };

        return (
          <g key={shape.code}>
            <path
              d={shape.d}
              className={`${BASE_SHAPE} ${enabled ? ACTIVE : INACTIVE}`}
              role={enabled ? "link" : undefined}
              tabIndex={enabled ? 0 : undefined}
              aria-label={enabled ? `${name} — what's being voted on` : undefined}
              onClick={go}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  go();
                }
              }}
            >
              <title>{enabled ? name : `${name} — not available yet`}</title>
            </path>

            {shape.code === "DC" && (
              <circle
                cx={DC_MARKER.cx}
                cy={DC_MARKER.cy}
                r={DC_MARKER.r}
                className={`${BASE_SHAPE} ${enabled ? ACTIVE : INACTIVE}`}
                onClick={go}
              >
                <title>{enabled ? name : `${name} — not available yet`}</title>
              </circle>
            )}
          </g>
        );
      })}

      <path d={INSET_SEPARATORS} fill="none" className="stroke-hairline [stroke-width:1]" />
    </svg>
  );
}
