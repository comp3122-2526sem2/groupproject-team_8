"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FADE_UP_VARIANTS } from "@/lib/motion/presets";

type ClassWorkspaceShellProps = {
  title: string;
  subtitle: string;
  sidebar: ReactNode;
  main: ReactNode;
  onExit: () => void;
};

export default function ClassWorkspaceShell({
  title,
  subtitle,
  sidebar,
  main,
  onExit,
}: ClassWorkspaceShellProps) {
  return (
    <section className="space-y-4">
      <motion.div initial="initial" animate="enter" variants={FADE_UP_VARIANTS}>
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                  Focused Workspace
                </p>
                <CardTitle className="mt-1 text-2xl">{title}</CardTitle>
                <p className="mt-1 text-sm text-ui-muted">{subtitle}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={onExit}>
                ← Back to overview
              </Button>
            </div>
          </CardHeader>
        </Card>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <motion.div initial="initial" animate="enter" variants={FADE_UP_VARIANTS}>
          <Card className="min-h-[32rem] rounded-3xl">
            <CardContent className="p-4 sm:p-6">{main}</CardContent>
          </Card>
        </motion.div>
        <motion.div initial="initial" animate="enter" variants={FADE_UP_VARIANTS}>
          <Card className="rounded-2xl sticky top-6">
            <CardContent className="p-4">{sidebar}</CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
