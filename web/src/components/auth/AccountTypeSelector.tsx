"use client";

import { useState } from "react";
import { AppIcons } from "@/components/icons";
import { cn } from "@/lib/utils";

type AccountType = "teacher" | "student";

type AccountTypeSelectorProps = {
  defaultValue: AccountType | null;
};

const ROLE_CONTENT: Record<
  AccountType,
  {
    label: string;
    badge: string;
    helper: string;
  }
> = {
  teacher: {
    label: "Teacher",
    badge: "Manage",
    helper: "Teacher accounts create classes, curate AI outputs, and publish learning activities.",
  },
  student: {
    label: "Student",
    badge: "Learn",
    helper: "Student accounts join teacher-led classes and open assigned learning activities.",
  },
};

const DEFAULT_HELPER =
  "Choose the role that matches how you'll use the platform. Account type can't be changed later.";

export default function AccountTypeSelector({ defaultValue }: AccountTypeSelectorProps) {
  const [selected, setSelected] = useState<AccountType | null>(defaultValue);
  const helperText = selected ? ROLE_CONTENT[selected].helper : DEFAULT_HELPER;

  return (
    <fieldset className="space-y-2.5">
      <legend className="text-sm font-medium text-ui-muted">Account type</legend>
      <p className="text-xs leading-5 text-ui-muted">{helperText}</p>

      <div className="grid grid-cols-2 gap-3">
        {(Object.entries(ROLE_CONTENT) as [AccountType, (typeof ROLE_CONTENT)[AccountType]][]).map(
          ([value, content]) => {
            const isSelected = selected === value;

            return (
              <label key={value} className="block">
                <input
                  type="radio"
                  name="account_type"
                  value={value}
                  checked={isSelected}
                  onChange={() => setSelected(value)}
                  aria-label={content.label}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "auth-choice flex min-h-[4.25rem] flex-col justify-between rounded-2xl border px-4 py-3 text-left",
                    isSelected ? "auth-choice-active" : "auth-choice-idle",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="block text-sm font-semibold text-ui-primary">{content.label}</span>
                    <span
                      className={cn(
                        "auth-choice-indicator flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        isSelected ? "auth-choice-indicator-active" : "auth-choice-indicator-idle",
                      )}
                      aria-hidden="true"
                    >
                      <AppIcons.check className="h-3.5 w-3.5" />
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-2 text-[11px] font-semibold uppercase tracking-[0.18em]",
                      isSelected ? "text-accent-strong" : "text-ui-muted",
                    )}
                  >
                    {content.badge}
                  </span>
                </span>
              </label>
            );
          },
        )}
      </div>
    </fieldset>
  );
}
