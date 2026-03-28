"use client";

import { OTPInput, type SlotProps } from "input-otp";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  name: string;
  disabled?: boolean;
  className?: string;
};

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      data-slot="otp-slot"
      className={cn(
        "relative flex h-12 w-11 items-center justify-center rounded-xl border-2 text-lg font-semibold font-mono transition-all",
        isActive
          ? "border-primary ring-2 ring-ring ring-offset-2"
          : "border-default",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-foreground" />
        </div>
      )}
    </div>
  );
}

function OtpInput({ name, disabled, className }: OtpInputProps) {
  return (
    <OTPInput
      name={name}
      maxLength={6}
      inputMode="text"
      disabled={disabled}
      pushPasswordManagerStrategy="none"
      containerClassName={cn("flex items-center gap-2", className)}
      render={({ slots }) => (
        <>
          {slots.map((slot, idx) => (
            <Slot key={idx} {...slot} />
          ))}
        </>
      )}
    />
  );
}

export { OtpInput };
