import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildChartSeries,
  buildCurrentPriceHistory,
  downsampleHistory,
  filterPriceHistoryByRange,
  type ChartHistoryPoint,
} from "./marketChart";
import type { Outcome } from "./types";

const nowMs = Date.parse("2026-05-13T12:00:00.000Z");

function point(hoursAgo: number, yes: number, no = 1 - yes): ChartHistoryPoint {
  return {
    timestamp: new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString(),
    yes,
    no,
    volume: 1000,
    liquidity: 100,
  };
}

describe("market chart helpers", () => {
  it("builds binary Yes and No series from price_history points", () => {
    const outcomes: Outcome[] = [
      { name: "Yes", price: 0.62, clobTokenId: null },
      { name: "No", price: 0.38, clobTokenId: null },
    ];

    const series = buildChartSeries({
      priceHistory: [point(2, 0.55), point(1, 0.6), point(0, 0.62)],
      outcomes,
      range: "ALL",
      nowMs,
    });

    assert.deepEqual(
      series.map((item) => item.label),
      ["Yes", "No"],
    );
    assert.equal(series[0]?.points.length, 3);
    assert.equal(series[1]?.points.length, 3);
    assert.equal(series[0]?.latest, 0.62);
    assert.equal(series[1]?.latest, 0.38);
    assert.match(series[0]?.path ?? "", /^M\d/);
  });

  it("filters visible chart points by selected range", () => {
    const history = [point(8, 0.4), point(2, 0.5), point(0.5, 0.6)];

    const oneHour = filterPriceHistoryByRange(history, "1H", nowMs);
    const sixHours = filterPriceHistoryByRange(history, "6H", nowMs);
    const all = filterPriceHistoryByRange(history, "ALL", nowMs);

    assert.deepEqual(
      oneHour.map((item) => item.yes),
      [0.6],
    );
    assert.deepEqual(
      sixHours.map((item) => item.yes),
      [0.5, 0.6],
    );
    assert.equal(all.length, 3);
  });

  it("builds top multi-outcome series from outcome price history", () => {
    const outcomes: Outcome[] = [
      { name: "Candidate A", price: 0.5, clobTokenId: null },
      { name: "Candidate B", price: 0.3, clobTokenId: null },
      { name: "Candidate C", price: 0.15, clobTokenId: null },
      { name: "Candidate D", price: 0.05, clobTokenId: null },
    ];
    const priceHistory: ChartHistoryPoint[] = [
      {
        ...point(2, 0.5),
        outcomes: {
          "candidate a": 0.4,
          "candidate b": 0.35,
          "candidate c": 0.2,
          "candidate d": 0.05,
        },
      },
      {
        ...point(0, 0.5),
        outcomes: {
          "candidate a": 0.5,
          "candidate b": 0.3,
          "candidate c": 0.15,
          "candidate d": 0.05,
        },
      },
    ];

    const series = buildChartSeries({ priceHistory, outcomes, range: "ALL", nowMs });

    assert.deepEqual(
      series.map((item) => item.label),
      ["Candidate A", "Candidate B", "Candidate C", "Candidate D"],
    );
    assert.equal(series.every((item) => item.points.length === 2), true);
  });

  it("builds fallback chart history from current outcome prices", () => {
    const outcomes: Outcome[] = [
      { name: "Spain", price: 0.173, clobTokenId: null },
      { name: "France", price: 0.17, clobTokenId: null },
      { name: "England", price: 0.113, clobTokenId: null },
    ];

    const fallbackHistory = buildCurrentPriceHistory(outcomes, "ALL", nowMs);
    const series = buildChartSeries({
      priceHistory: fallbackHistory,
      outcomes,
      range: "ALL",
      nowMs,
    });

    assert.equal(fallbackHistory.length, 12);
    assert.equal(fallbackHistory.every((item) => item.synthetic), true);
    assert.deepEqual(
      series.map((item) => item.latest),
      [0.173, 0.17, 0.113],
    );
    assert.equal(series.every((item) => item.points.length === fallbackHistory.length), true);
  });

  it("keeps the selected multi-outcome visible when it is outside the top series", () => {
    const outcomes: Outcome[] = [
      { name: "Candidate A", price: 0.5, clobTokenId: null },
      { name: "Candidate B", price: 0.2, clobTokenId: null },
      { name: "Candidate C", price: 0.12, clobTokenId: null },
      { name: "Candidate D", price: 0.08, clobTokenId: null },
      { name: "Candidate E", price: 0.06, clobTokenId: null },
      { name: "Candidate F", price: 0.04, clobTokenId: null },
    ];
    const priceHistory: ChartHistoryPoint[] = [
      {
        ...point(0, 0.5),
        outcomes: outcomes.map((candidate) => ({
          name: candidate.name,
          price: candidate.price,
        })),
      },
    ];

    const series = buildChartSeries({
      priceHistory,
      outcomes,
      range: "ALL",
      nowMs,
      selectedOutcomeName: "Candidate F",
    });

    assert.deepEqual(
      series.map((item) => item.label),
      ["Candidate A", "Candidate B", "Candidate C", "Candidate D", "Candidate F"],
    );
  });

  it("downsamples large CLOB histories while keeping the first and latest real points", () => {
    const history = Array.from({ length: 7_126 }).map((_, index) => point(index / 60, index / 10_000));
    const sampled = downsampleHistory(history, 180);

    assert.equal(sampled.length <= 180, true);
    assert.equal(sampled[0], history[0]);
    assert.equal(sampled.at(-1), history.at(-1));

    const series = buildChartSeries({
      priceHistory: history,
      outcomes: [
        { name: "Yes", price: 0.7, clobTokenId: null },
        { name: "No", price: 0.3, clobTokenId: null },
      ],
      range: "ALL",
      nowMs,
    });

    assert.equal(series.every((item) => item.points.length <= 180), true);
  });
});
