/* Copyright 2024 Marimo. All rights reserved. */
import { z } from "zod";

import { IPlugin, IPluginProps, Setter } from "@/plugins/types";

import type { Figure } from "react-plotly.js";
import { Logger } from "@/utils/Logger";

import "./plotly.css";
import "./mapbox.css";
import { lazy, memo, useEffect, useMemo, useState } from "react";
import useEvent from "react-use-event-hook";
import { PlotlyTemplateParser, createParser } from "./parse-from-template";
import { Objects } from "@/utils/objects";
import { set } from "lodash-es";
import { useDeepCompareMemoize } from "@/hooks/useDeepCompareMemoize";

interface Data {
  figure: Figure;
  config: Partial<Plotly.Config>;
}

type AxisName = string;
type AxisDatum = unknown;

type T =
  | {
      points?: Array<Record<AxisName, AxisDatum>>;
      indices?: number[];
      range?: {
        x?: number[];
        y?: number[];
      };
      // These are kept in the state to persist selections across re-renders
      // on the frontend, but likely not used in the backend.
      selections?: unknown[];
      dragmode?: Plotly.Layout["dragmode"];
      xaxis?: Partial<Plotly.LayoutAxis>;
      yaxis?: Partial<Plotly.LayoutAxis>;
    }
  | undefined;

export class PlotlyPlugin implements IPlugin<T, Data> {
  tagName = "marimo-plotly";

  validator = z.object({
    figure: z
      .object({})
      .passthrough()
      .transform((spec) => spec as unknown as Figure),
    config: z.object({}).passthrough(),
  });

  render(props: IPluginProps<T, Data>): JSX.Element {
    return (
      <PlotlyComponent
        {...props.data}
        host={props.host}
        value={props.value}
        setValue={props.setValue}
      />
    );
  }
}

interface PlotlyPluginProps extends Data {
  value: T;
  setValue: Setter<T>;
  host: HTMLElement;
}

export const LazyPlot = lazy(() => import("react-plotly.js"));

function initialLayout(figure: Figure): Partial<Plotly.Layout> {
  // Enable autosize if width is not specified
  const shouldAutoSize = figure.layout.width === undefined;
  return {
    autosize: shouldAutoSize,
    dragmode: "select",
    height: 540,
    // Prioritize user's config
    ...figure.layout,
  };
}

export const PlotlyComponent = memo(
  ({ figure, value, setValue, config }: PlotlyPluginProps) => {
    const [layout, setLayout] = useState<Partial<Plotly.Layout>>(() => {
      return {
        ...initialLayout(figure),
        // Override with persisted values (dragmode, xaxis, yaxis)
        ...value,
      };
    });

    const [nonce, setNonce] = useState(0);

    const handleReset = useEvent(() => {
      setLayout(initialLayout(figure));
      setValue({});
      setNonce((prev) => prev + 1);
    });

    const plotlyConfig = useMemo((): Partial<Plotly.Config> => {
      return {
        displaylogo: false,
        modeBarButtonsToAdd: [
          // Custom button to reset the state
          {
            name: "reset",
            title: "Reset state",
            icon: {
              svg: `
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-ccw">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>`,
            },
            click: handleReset,
          },
        ],
        // Prioritize user's config
        ...config,
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleReset, useDeepCompareMemoize(config)]);

    useEffect(() => {
      // Update layout when figure.layout changes
      // Omit keys that we don't want to override
      const layout = Objects.omit(figure.layout, [
        "autosize",
        "dragmode",
        "xaxis",
        "yaxis",
      ]);
      setLayout((prev) => ({ ...prev, ...layout }));
    }, [figure.layout]);

    return (
      <LazyPlot
        key={nonce}
        {...figure}
        layout={layout}
        onRelayout={(layoutUpdate) => {
          // Persist dragmode in the state to keep it across re-renders
          if ("dragmode" in layoutUpdate) {
            setValue((prev) => ({ ...prev, dragmode: layoutUpdate.dragmode }));
          }

          // Persist xaxis/yaxis changes in the state to keep it across re-renders
          if (
            Object.keys(layoutUpdate).some(
              (key) => key.includes("xaxis") || key.includes("yaxis"),
            )
          ) {
            // Axis changes are keypath updates, so need to use lodash.set
            // e.g. xaxis.range[0], xaxis.range[1], yaxis.range[0], yaxis.range[1]
            const obj: Partial<Plotly.Layout> = {};
            Object.entries(layoutUpdate).forEach(([key, value]) => {
              set(obj, key, value);
            });
            setValue((prev) => ({ ...prev, ...obj }));
          }
        }}
        onUpdate={(figure) => {
          // If the user double-clicks, all selection will be cleared
          // But this does not call onSelected, so we need to clear it here
          const selections =
            "selections" in figure.layout &&
            Array.isArray(figure.layout.selections)
              ? figure.layout.selections
              : [];
          if (selections.length === 0) {
            console.log("Clearing selections");
            setValue((prev) => ({
              ...prev,
              selections: selections,
              points: [],
              indices: [],
              range: undefined,
            }));
          }
        }}
        config={plotlyConfig}
        onSelected={useEvent((evt: Readonly<Plotly.PlotSelectionEvent>) => {
          if (!evt) {
            return;
          }

          setValue((prev) => ({
            ...prev,
            selections:
              "selections" in evt ? (evt.selections as unknown[]) : [],
            points: extractPoints(evt.points),
            indices: evt.points.map((point) => point.pointIndex),
            range: evt.range,
          }));
        })}
        className="w-full"
        useResizeHandler={true}
        frames={figure.frames ?? undefined}
        onError={useEvent((err) => {
          Logger.error("PlotlyPlugin: ", err);
        })}
      />
    );
  },
);
PlotlyComponent.displayName = "PlotlyComponent";

/**
 * This is a hack to extract the points with their original keys,
 * instead of the ones that Plotly uses internally,
 * by using the hovertemplate.
 */
function extractPoints(
  points: Plotly.PlotDatum[],
): Array<Record<AxisName, AxisDatum>> {
  if (!points) {
    return [];
  }

  let parser: PlotlyTemplateParser | undefined;

  return points.map((point) => {
    // Get the first hovertemplate
    const hovertemplate = Array.isArray(point.data.hovertemplate)
      ? point.data.hovertemplate[0]
      : point.data.hovertemplate;
    // Update or create a parser
    parser = parser
      ? parser.update(hovertemplate)
      : createParser(hovertemplate);
    return parser.parse(point);
  });
}
