/**
 * @vitest-environment jsdom
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import AccountTypeSelector from "@/components/auth/AccountTypeSelector";

describe("AccountTypeSelector", () => {
  it("shows the default guidance when no role is selected", () => {
    render(<AccountTypeSelector defaultValue={null} />);

    expect(screen.getByLabelText("Teacher")).not.toBeChecked();
    expect(screen.getByLabelText("Student")).not.toBeChecked();
    expect(
      screen.getByText("Choose the role that matches how you'll use the platform. Account type can't be changed later."),
    ).toBeInTheDocument();
  });

  it("updates the explanation when the student role is selected", async () => {
    const user = userEvent.setup();

    render(<AccountTypeSelector defaultValue={null} />);

    await user.click(screen.getByLabelText("Student"));

    expect(screen.getByLabelText("Student")).toBeChecked();
    expect(
      screen.getByText("Student accounts join teacher-led classes and open assigned learning activities."),
    ).toBeInTheDocument();
  });
});
