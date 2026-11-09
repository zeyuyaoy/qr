"use client"

import {Progress as ProgressPrimitive} from "@base-ui/react/progress"
import {cn} from "@/lib/utils"

function Progress({
                      className,
                      children,
                      value,
                      ...props
                  }: ProgressPrimitive.Root.Props) {
    return (
        <ProgressPrimitive.Root
            value={value}
            data-slot="progress"
            className={cn("flex flex-wrap gap-3", className)}
            {...props}
        >
            {children}
            <ProgressPrimitive.Track
                data-slot="progress-track"
                className="relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted"
            >
                <ProgressPrimitive.Indicator data-slot="progress-indicator"
                                             className="h-full bg-primary transition-all"/>
            </ProgressPrimitive.Track>
        </ProgressPrimitive.Root>
    )
}

function ProgressLabel({className, ...props}: ProgressPrimitive.Label.Props) {
    return (
        <ProgressPrimitive.Label
            className={cn("text-sm font-medium", className)}
            data-slot="progress-label"
            {...props}
        />
    )
}

function ProgressValue({className, ...props}: ProgressPrimitive.Value.Props) {
    return (
        <ProgressPrimitive.Value
            className={cn(
                "ml-auto text-sm text-muted-foreground tabular-nums",
                className
            )}
            data-slot="progress-value"
            {...props}
        />
    )
}

export {
    Progress,
    ProgressLabel,
    ProgressValue,
}
