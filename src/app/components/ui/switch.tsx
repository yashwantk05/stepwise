"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "./utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-8 w-12 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[#d7dbe3] p-0.5 outline-none transition-colors duration-200 focus-visible:ring-4 focus-visible:ring-slate-300/70 data-[state=checked]:bg-[#0b0a1f] data-[state=unchecked]:bg-[#d7dbe3] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-7 rounded-full border border-[#cdd2db] bg-white shadow-sm ring-0 transition-transform duration-200 data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
