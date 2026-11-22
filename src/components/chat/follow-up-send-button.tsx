"use client"

/**
 * keh4l build: the composer's send button while the agent is replying (T3
 * Code's layout).
 *
 * The icon says what a click does — steer into the running turn (`Forward`)
 * or queue for after it (`ListPlus`) — from the per-device default. Holding
 * ⌘ / Ctrl flips it live, and a ⌘/Ctrl-click does the other one. On touch, a
 * long press opens both, for this message only. With an empty composer the
 * host shows the stop button instead.
 */

import { useEffect, useRef, useState } from "react"
import { Forward, ListPlus } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePlatform } from "@/hooks/use-platform"
import {
  type FollowUpAction,
  type FollowUpBehavior,
  resolveFollowUpAction,
} from "@/lib/follow-up/dispatch-mode"

const LONG_PRESS_MS = 450

/** Tracks whether ⌘ / Ctrl is down, for the live icon flip. */
function useModifierHeld(): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const update = (event: KeyboardEvent) =>
      setHeld(event.metaKey || event.ctrlKey)
    const reset = () => setHeld(false)
    window.addEventListener("keydown", update)
    window.addEventListener("keyup", update)
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("keydown", update)
      window.removeEventListener("keyup", update)
      window.removeEventListener("blur", reset)
    }
  }, [])
  return held
}

export interface FollowUpSendButtonProps {
  behavior: FollowUpBehavior
  /** False when this draft cannot go into the turn (a slash command). */
  canSteer: boolean
  disabled: boolean
  /** `alternate`: the modifier flipped the default; `forced`: picked from the
   *  long-press menu. */
  onSubmit: (
    alternate: boolean,
    forced?: Exclude<FollowUpAction, "send">
  ) => void
}

export function FollowUpSendButton({
  behavior,
  canSteer,
  disabled,
  onSubmit,
}: FollowUpSendButtonProps) {
  const t = useTranslations("FollowUp")
  const { isMac } = usePlatform()
  const modHeld = useModifierHeld()
  const [menuOpen, setMenuOpen] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const action = resolveFollowUpAction({
    running: true,
    alternate: modHeld,
    behavior,
    canSteer,
  })
  const mod = isMac ? "⌘" : "Ctrl"
  const title = !canSteer
    ? t("queueOnlyHint")
    : behavior === "steer"
      ? t("tooltipSteerDefault", { mod })
      : t("tooltipQueueDefault", { mod })

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  useEffect(() => clearPress, [])

  return (
    <div className="relative flex items-center">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        {/* Anchor only: the button below opens the menu on a long press. */}
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          // Lifting the finger after a long press can still bring the
          // button's mouse events (mousedown → click), which would move focus
          // off the menu and close it before anything is picked.
          onFocusOutside={(event) => {
            if (longPressed.current) event.preventDefault()
          }}
        >
          <DropdownMenuItem
            disabled={!canSteer}
            onSelect={() => onSubmit(false, "steer")}
          >
            <Forward className="size-4" />
            {t("actionSteer")}
            {behavior === "steer" ? (
              <span className="ms-auto ps-3 text-xs text-muted-foreground">
                {t("default")}
              </span>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSubmit(false, "queue")}>
            <ListPlus className="size-4" />
            {t("actionQueue")}
            {behavior === "queue" ? (
              <span className="ms-auto ps-3 text-xs text-muted-foreground">
                {t("default")}
              </span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        size="icon"
        // No text selection or iOS callout on a long press: the menu is ours.
        className="h-8 w-8 select-none [-webkit-touch-callout:none]"
        disabled={disabled}
        title={title}
        aria-label={action === "steer" ? t("actionSteer") : t("actionQueue")}
        data-follow-up-action={action}
        onPointerDown={(event) => {
          longPressed.current = false
          if (event.pointerType === "mouse") return
          clearPress()
          pressTimer.current = setTimeout(() => {
            longPressed.current = true
            setMenuOpen(true)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={clearPress}
        onPointerLeave={clearPress}
        onPointerCancel={clearPress}
        onMouseDown={(event) => {
          // The mouse events that follow a long press keep focus on the menu.
          if (longPressed.current) event.preventDefault()
        }}
        onContextMenu={(event) => {
          // A long press on touch fires this too; the menu is ours.
          if (longPressed.current) event.preventDefault()
        }}
        onClick={(event) => {
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          onSubmit(event.metaKey || event.ctrlKey)
        }}
      >
        {action === "steer" ? (
          <Forward className="size-4" />
        ) : (
          <ListPlus className="size-4" />
        )}
      </Button>
    </div>
  )
}
