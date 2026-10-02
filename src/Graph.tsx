import React, { useMemo } from "react";
import type { Commit } from "./types";
import { useI18n } from "./i18n";

export const graphColors = [
  "#58d6bc",
  "#9c88ff",
  "#68a9ff",
  "#e8bb78",
  "#df80aa",
  "#88bb76",
  "#c885ee",
];
export function buildGraph(commits: Commit[]) {
  const active: string[] = [];
  const points = new Map<string, { lane: number; row: number }>();
  let maxLane = 0;
  commits.forEach((commit, row) => {
    let lane = active.indexOf(commit.hash);
    if (lane < 0) {
      lane = active.indexOf("");
      if (lane < 0) lane = active.length;
      active[lane] = commit.hash;
    }
    points.set(commit.hash, { lane, row });
    maxLane = Math.max(maxLane, lane);
    active[lane] = "";
    commit.parents.forEach((parent, i) => {
      if (active.includes(parent)) return;
      if (i === 0 && !active[lane]) active[lane] = parent;
      else {
        let next = active.indexOf("");
        if (next < 0) next = active.length;
        active[next] = parent;
        maxLane = Math.max(maxLane, next);
      }
    });
    while (active.length && !active[active.length - 1]) active.pop();
  });
  return { points, width: Math.max(78, 30 + maxLane * 17) };
}
export interface GraphRowMetric {
  top: number;
  height: number;
}
export default function Graph({
  commits,
  selected,
  onSelect,
  onCheckout,
  rowMetrics,
}: {
  commits: Commit[];
  selected: string | null;
  onSelect: (hash: string) => void;
  onCheckout?: (hash: string) => void;
  rowMetrics?: GraphRowMetric[];
}) {
  const { t } = useI18n();
  const layout = useMemo(() => buildGraph(commits), [commits]);
  const rowHeight = 52;
  const yFor = (row: number) =>
    rowMetrics?.[row]
      ? rowMetrics[row].top + rowMetrics[row].height / 2
      : row * rowHeight + rowHeight / 2;
  const totalHeight =
    rowMetrics?.length === commits.length && rowMetrics.length
      ? rowMetrics[rowMetrics.length - 1].top +
        rowMetrics[rowMetrics.length - 1].height
      : commits.length * rowHeight;
  return (
    <svg
      className="commit-graph"
      width={layout.width}
      height={totalHeight}
      aria-label={t("Grafo della cronologia Git: collegamenti ai parent reali")}
    >
      {commits.flatMap((commit) => {
        const source = layout.points.get(commit.hash)!;
        return commit.parents.map((parent, index) => {
          const target = layout.points.get(parent);
          if (!target)
            return (
              <path
                key={`${commit.hash}-${parent}`}
                d={`M ${17 + source.lane * 17} ${yFor(source.row)} v ${(rowMetrics?.[source.row]?.height || rowHeight) / 2}`}
                stroke={graphColors[source.lane % graphColors.length]}
                opacity=".35"
                strokeDasharray="3 3"
                fill="none"
                strokeWidth="2"
              />
            );
          const x1 = 17 + source.lane * 17,
            x2 = 17 + target.lane * 17,
            y1 = yFor(source.row),
            y2 = yFor(target.row);
          return (
            <path
              key={`${commit.hash}-${parent}`}
              d={
                x1 === x2
                  ? `M ${x1} ${y1} V ${y2}`
                  : `M ${x1} ${y1} C ${x1} ${y1 + 25}, ${x2} ${y2 - 25}, ${x2} ${y2}`
              }
              stroke={
                graphColors[
                  (index === 0 ? source.lane : target.lane) % graphColors.length
                ]
              }
              fill="none"
              strokeWidth="2"
              opacity=".75"
            />
          );
        });
      })}
      {commits.map((commit) => {
        const p = layout.points.get(commit.hash)!;
        return (
          <g
            key={commit.hash}
            onClick={() => onSelect(commit.hash)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onCheckout?.(commit.hash);
            }}
            style={{ cursor: "pointer" }}
          >
            <title>{`${commit.shortHash}: ${commit.subject}`}</title>
            {selected === commit.hash && (
              <circle
                cx={17 + p.lane * 17}
                cy={yFor(p.row)}
                r="9"
                fill={graphColors[p.lane % graphColors.length]}
                opacity=".18"
              />
            )}
            <circle
              cx={17 + p.lane * 17}
              cy={yFor(p.row)}
              r={commit.parents.length > 1 ? 5.2 : 4.2}
              fill="var(--surface)"
              stroke={graphColors[p.lane % graphColors.length]}
              strokeWidth="2.4"
            />
          </g>
        );
      })}
    </svg>
  );
}
