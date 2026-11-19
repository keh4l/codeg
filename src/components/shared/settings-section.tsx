"use client"

/**
 * Page-level building blocks for a settings tab, one level above the row
 * grammar in `setting-card.tsx`: the titled block a page is made of, the
 * banner it reports a failed load through, and the footer it saves from.
 *
 * The split mirrors how the surfaces are read: `SettingsSection` says what a
 * group of options is for, `SettingCard` groups the options that are one
 * decision, and `SettingRow` is a single option. Before this existed every
 * section hand-rolled the same header markup, which is how the page ended up
 * with two different error banners and five subtly different save footers.
 */

import { Children, createContext, useContext } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface SettingsSectionProps {
  /** Small glyph in front of the heading; purely decorative. */
  icon?: LucideIcon
  title: React.ReactNode
  /** What this group of options is for, under the heading. */
  description?: React.ReactNode
  /**
   * Compact control pinned to the right of the heading, for a section that
   * *is* one option — a card holding a single row would only repeat the
   * heading back at the reader.
   */
  control?: React.ReactNode
  /**
   * Ties the heading to the control it labels (`Switch`, `Select`, …). A
   * `collapsible` section only uses it while it has nothing to fold; once the
   * heading is a disclosure button the control has to name itself
   * (`aria-label`), since a button cannot double as a label.
   */
  htmlFor?: string
  /**
   * Turns the heading into a disclosure button that shows and hides
   * `children` — pass a constant, not a condition: whether there is anything
   * to fold is read off `children`. Controlled on purpose, so a section that
   * only wants to work while open (fetch, claim a resource) can see that too.
   */
  collapsible?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
  className?: string
}

/**
 * One titled block on a settings page. Heading and purpose sit together at the
 * top (`space-y-1`, so they read as one unit rather than two stacked lines),
 * and the content below is spaced at the same rhythm the cards use inside a
 * dialog — the whole page then has a single vertical cadence.
 *
 * With `control`, the header doubles as the section's single {@link SettingRow}:
 * the heading labels the control instead of a row title one line below saying
 * the same thing. Whatever else the section holds still goes in cards below, so
 * "master switch + the options it gates" reads as one block that collapses to a
 * single line when the switch is off.
 *
 * The bordered `bg-card` surface is deliberately the same shell the other
 * settings tabs use, so adopting this component changes the grammar *inside* a
 * section without making one tab look foreign next to its siblings.
 *
 * With `collapsible`, the heading also folds the section away — same disclosure
 * grammar as the appearance tab's custom-style block (chevron on the heading,
 * hairline under it once open). It composes with `control`: the master switch
 * stays reachable on the heading line whether the body is showing or not.
 */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  control,
  htmlFor,
  collapsible,
  open,
  onOpenChange,
  children,
  className,
}: SettingsSectionProps) {
  const surface = useSettingsSurface()
  const heading = (
    <>
      {Icon ? (
        <Icon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
      {title}
    </>
  )

  const descriptionNode = description ? (
    <p className="text-xs leading-5 text-muted-foreground">{description}</p>
  ) : null

  if (collapsible) {
    // A master switch that gates every child leaves nothing to disclose when
    // it is off, and a chevron that opens onto an empty box is a dead control.
    // Asking the children rather than taking a second prop keeps that decision
    // in one place — `Children.toArray` drops the `false`s a `cond && <x/>`
    // child leaves behind.
    const foldable = Children.toArray(children).length > 0
    const expanded = foldable && open === true

    return (
      // Rendered whether or not anything is foldable right now: swapping this
      // wrapper in and out would remount the header, and the control on it
      // would lose keyboard focus the moment it was used.
      <Collapsible open={expanded} onOpenChange={onOpenChange} asChild>
        <section className={cn("overflow-hidden", surface, className)}>
          {/* `relative` is the anchor the trigger stretches its hit area to,
              and `has-…:hover` paints the hover state from the trigger rather
              than from the row: pointing at the switch then leaves the row
              plain, because clicking there does not fold anything. */}
          <div
            className={cn(
              "relative flex flex-wrap justify-between gap-x-3 gap-y-2 border-b border-transparent p-4 transition-colors has-[[data-slot=collapsible-trigger]:hover]:bg-muted/50",
              description ? "items-start" : "items-center",
              expanded && "border-border"
            )}
          >
            <div className="min-w-0 flex-1 basis-64 space-y-1">
              {/* The button goes inside the h2, not the other way round:
                  role=button flattens its descendants' semantics, which would
                  drop the section out of the page's heading list — so the
                  button can only wrap the title. `before:inset-0` then spreads
                  its hit area (and its focus ring) over the whole row, which is
                  how the description and the empty space beside it fold the
                  section too. */}
              <h2 className="text-sm font-semibold">
                {foldable ? (
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="group/settings-section flex cursor-pointer items-center gap-2 text-left outline-none before:absolute before:inset-0 focus-visible:before:ring-2 focus-visible:before:ring-ring/50 focus-visible:before:ring-inset"
                    >
                      {heading}
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/settings-section:rotate-180" />
                    </button>
                  </CollapsibleTrigger>
                ) : htmlFor ? (
                  // Nothing to fold, so the heading goes back to labelling the
                  // control — the same one-line section it was before.
                  <Label
                    htmlFor={htmlFor}
                    className="gap-2 text-sm leading-normal font-semibold"
                  >
                    {heading}
                  </Label>
                ) : (
                  <span className="flex items-center gap-2">{heading}</span>
                )}
              </h2>
              {descriptionNode}
            </div>
            {/* Positioned, so it paints above the trigger's overlay — without
                this the overlay would swallow every click on the switch. */}
            {control ? (
              <div className="relative shrink-0">{control}</div>
            ) : null}
          </div>
          <CollapsibleContent className="space-y-3 p-4">
            {children}
          </CollapsibleContent>
        </section>
      </Collapsible>
    )
  }

  return (
    <section className={cn("space-y-3 p-4", surface, className)}>
      {/* Same alignment rule as `SettingRow`: with an explanation the control
          sits on the heading's line, without one the two center on each other. */}
      {/* Wraps instead of squeezing: on a phone a select or button would
          otherwise pin the explanation into a column a few characters wide,
          so a control that doesn't fit beside 16rem of text drops below it.
          A switch is narrow enough to stay on the heading's line. */}
      <div
        className={cn(
          "flex flex-wrap justify-between gap-x-3 gap-y-2",
          description ? "items-start" : "items-center"
        )}
      >
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <h2 className="text-sm font-semibold">
            {htmlFor ? (
              // A `<label>` inside the heading, so clicking the title works the
              // control and the heading is still a heading to both roles.
              <Label
                htmlFor={htmlFor}
                className="gap-2 text-sm leading-normal font-semibold"
              >
                {heading}
              </Label>
            ) : (
              <span className="flex items-center gap-2">{heading}</span>
            )}
          </h2>
          {descriptionNode}
        </div>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children}
    </section>
  )
}

const SettingsGroupContext = createContext(false)

/**
 * The bordered card a settings block draws around itself — unless it sits in
 * a {@link SettingsGroup}, which draws one card for the whole run and a
 * hairline between its rows. Exported for the few blocks that build their own
 * `<section>` (the custom-style disclosure) so they join a group the same way.
 */
export function useSettingsSurface(): string {
  return useContext(SettingsGroupContext) ? "" : "rounded-xl border bg-card"
}

/**
 * A titled run of related settings on one card: the label sits above the
 * card, the sections inside become rows divided by hairlines. A page of
 * twelve separate cards reads as twelve unrelated things; three groups say
 * which options belong together before any of them is read.
 *
 * A group whose every child renders nothing (desktop-only options in a
 * browser) hides itself, label included, rather than leaving an empty card.
 */
export function SettingsGroup({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        "space-y-2 has-[>[data-slot=settings-group-body]:empty]:hidden",
        className
      )}
    >
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        {label}
      </h2>
      <div
        data-slot="settings-group-body"
        className="divide-y overflow-hidden rounded-xl border bg-card"
      >
        <SettingsGroupContext.Provider value={true}>
          {children}
        </SettingsGroupContext.Provider>
      </div>
    </section>
  )
}

/**
 * The title block every settings page opens with: the page's name one step
 * above the section headings (`text-base` against their `text-sm`), what the
 * page is for, and page-wide actions on the right. Pages used to hand-roll
 * this in five different sizes, and two pages had none — on a phone, with
 * the nav folded away, that left nothing saying which page you were on.
 */
export function SettingsPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
        className
      )}
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <h1 className="text-base font-semibold">{title}</h1>
        {description ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
  )
}

/**
 * Width of a settings page made of options rather than lists. Rows hold a
 * label on one side and its control on the other; in a wide browser window
 * an uncapped row put the two over a thousand pixels apart.
 */
export const SETTINGS_FORM_WIDTH = "mx-auto w-full max-w-[52rem]"

/**
 * A section couldn't load (or save) what it configures. Uses the `destructive`
 * tokens rather than a literal red so it stays legible in both themes and
 * follows a custom accent, and carries the glyph so the message reads as a
 * failure at a glance instead of as one more paragraph of hint text.
 */
export function SettingsError({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive",
        className
      )}
    >
      {/* One text line tall so the glyph centers on the first line whatever
          the message's length — the same trick `SettingNote` uses. */}
      <span className="flex h-5 shrink-0 items-center">
        <AlertCircle className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

interface SettingsSaveBarProps {
  onSave: () => void
  saving: boolean
  /** Blocks the button for reasons other than the save in flight (e.g. still loading). */
  disabled?: boolean
  label: React.ReactNode
  savingLabel: React.ReactNode
  className?: string
}

/**
 * Footer for a section whose values are only persisted on demand. The button
 * carries its own in-flight state, so a section never has to decide again how
 * a save renders — the spinner and the disabled window are the same everywhere.
 */
export function SettingsSaveBar({
  onSave,
  saving,
  disabled,
  label,
  savingLabel,
  className,
}: SettingsSaveBarProps) {
  return (
    <div className={cn("flex justify-end pt-1", className)}>
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={disabled || saving}
      >
        {saving ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {savingLabel}
          </>
        ) : (
          label
        )}
      </Button>
    </div>
  )
}
