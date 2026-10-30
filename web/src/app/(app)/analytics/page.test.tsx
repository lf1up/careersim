import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api";
import type { AnalyticsOverview, Simulation } from "@/lib/types";
import AnalyticsPage from "./page";

vi.mock("@/lib/api", () => ({
  apiClient: { getAnalyticsOverview: vi.fn(), listSimulations: vi.fn() },
}));

it("uses current catalog titles in trend links and falls back to snapshot titles", async () => {
  const trend = ["renamed", "unlisted"].map((slug) => ({
    session_id: slug,
    simulation_slug: slug,
    simulation_title: `Snapshot ${slug}`,
    created_at: "2026-10-01T12:00:00Z",
    overall_score: 80,
    skills: {},
  }));
  const overview: AnalyticsOverview = {
    totals: {
      sessions: 2,
      simulations_tried: 2,
      messages: 4,
      user_messages: 2,
      practice_seconds: 60,
      voice_seconds: 0,
    },
    goals: {
      achieved: 0,
      total: 0,
      completed_sessions: 0,
      completable_sessions: 0,
      completion_rate: null,
    },
    reports: {
      total_sessions: 2,
      analyzed_sessions: 2,
      average_overall: 80,
      skill_averages: [],
      trend,
      tones: [],
      top_strengths: [],
      top_improvement_areas: [],
    },
    per_simulation: [],
  };
  vi.mocked(apiClient.getAnalyticsOverview).mockResolvedValue(overview);
  vi.mocked(apiClient.listSimulations).mockResolvedValue([
    { slug: "renamed", title: "Current catalog title" } as Simulation,
  ]);
  render(<AnalyticsPage />);
  expect(await screen.findByTitle(/^Current catalog title ·/)).toHaveAttribute(
    "href",
    "/sessions/renamed/report",
  );
  expect(screen.getByTitle(/^Snapshot unlisted ·/)).toHaveAttribute(
    "href",
    "/sessions/unlisted/report",
  );
  expect(screen.queryByTitle(/^Snapshot renamed ·/)).not.toBeInTheDocument();
});
