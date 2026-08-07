import { useNavigate } from "react-router-dom";

import { STATES } from "@/config/states";
import { DC_MARKER, INSET_SEPARATORS, MAP_VIEWBOX, STATE_SHAPES } from "./us-map-shapes";

const BASE_SHAPE = "stroke-hairline transition-colors duration-150 [stroke-width:0.75]";
const INACTIVE = "fill-white hover:fill-stategray";
const ACTIVE =
  "fill-white hover:fill-stategreen focus-visible:fill-stategreen cursor-pointer outline-none";

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
          if (enabled && config) navigate(`/${config.slug}`);
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
