/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import FileUploadZone from "./FileUploadZone";

describe("FileUploadZone", () => {
  it("renders a per-file progress bar for a single uploading file", () => {
    const file = new File(["alpha"], "lecture-a.pdf", { type: "application/pdf" });
    render(
      <FileUploadZone
        files={[
          {
            id: "file-a",
            file,
            progress: 45,
            status: "uploading",
          },
        ]}
        onFilesChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: "lecture-a.pdf upload progress" })).toHaveAttribute(
      "aria-valuenow",
      "45",
    );
  });

  it("renders one progress bar per uploading file in a batch", () => {
    const firstFile = new File(["alpha"], "lecture-a.pdf", { type: "application/pdf" });
    const secondFile = new File(["beta"], "lecture-b.pdf", { type: "application/pdf" });
    render(
      <FileUploadZone
        files={[
          {
            id: "file-a",
            file: firstFile,
            progress: 20,
            status: "uploading",
          },
          {
            id: "file-b",
            file: secondFile,
            progress: 70,
            status: "uploading",
          },
        ]}
        onFilesChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });
});
