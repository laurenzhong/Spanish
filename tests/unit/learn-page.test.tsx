import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LearnPageContent } from "@/app/(product)/learn/learn-page-content";

describe("LearnPage", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/learn");
  });

  it("shows a first-practice empty state without invented progress", async () => {
    render(<LearnPageContent userId="new-user" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "从一句真实表达开始" })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "开始第一次练习" })).toHaveAttribute(
      "href",
      "/learn/practice",
    );
    expect(screen.getAllByTestId("learn-primary-action")).toHaveLength(1);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/最近获得的能力/)).not.toBeInTheDocument();
    expect(screen.getByTestId("learn-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("learn-timeline")).toHaveTextContent("听懂情境");
    expect(screen.getByTestId("learn-timeline")).toHaveTextContent("当前步骤");
    expect(screen.queryByTestId("learn-detail-rail")).not.toBeInTheDocument();
  });

  it("keeps a selected goal title and practice route together", async () => {
    window.history.replaceState(null, "", "/learn?goal=communication.relationship.ask-name");
    render(<LearnPageContent userId="goal-user" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "询问姓名" })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "开始第一次练习" })).toHaveAttribute(
      "href",
      "/learn/practice?goal=communication.relationship.ask-name",
    );
  });

  it("restores the real expression position from a stable checkpoint", async () => {
    window.localStorage.setItem(
      "spanish.training.checkpoint.v1:test-user",
      JSON.stringify({
        schemaVersion: 1,
        contentBundleKey: "alpha.core",
        contentBundleVersion: 1,
        contentKey: "relationship.como-se-llama",
        goalKey: "communication.relationship.ask-name",
        status: "awaiting-output",
        outputMode: "speech",
        hintLevel: 0,
        generationId: 2,
        transcript: null,
        evaluation: null,
        error: null,
      }),
    );

    render(<LearnPageContent userId="test-user" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "让对话继续往前走" })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "继续学习" })).toHaveAttribute(
      "href",
      "/learn/practice",
    );
    expect(screen.getByRole("progressbar", { name: "这组表达进度" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    expect(screen.getByTestId("learn-detail-rail")).toBeInTheDocument();
    expect(screen.getByTestId("learn-detail-rail")).toHaveTextContent("录音隐私");
    expect(screen.getByTestId("learn-timeline")).toHaveTextContent("自己表达");
  });

  it("clears an invalid checkpoint instead of showing phantom progress", async () => {
    window.localStorage.setItem(
      "spanish.training.checkpoint.v1:invalid-user",
      JSON.stringify({ schemaVersion: 999, status: "completed" }),
    );

    render(<LearnPageContent userId="invalid-user" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "从一句真实表达开始" })).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "开始第一次练习" })).toBeInTheDocument();
    expect(screen.queryByTestId("learn-detail-rail")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "这组表达进度" })).not.toBeInTheDocument();
  });
});
