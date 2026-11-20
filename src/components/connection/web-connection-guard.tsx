"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Loader2, ShieldAlert } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  getWebConnectionServerSnapshot,
  getWebConnectionSnapshot,
  reconnectWebNow,
  subscribeWebConnection,
  verifyWebConnection,
} from "@/lib/transport/web-connection-store"
import { redirectToCodegLogin } from "@/lib/transport/web-auth"

// Debounce before the "reconnecting" dialog is shown. Server restarts, brief
// network blips, and laptop sleep/wake usually recover within a few seconds —
// surfacing a modal for every transient drop would flicker. The transport's
// state machine flips to "reconnecting" instantly; this delay is purely the
// UI deciding when the interruption is worth interrupting the user over.
// `unauthorized` and `proxyUnauthorized` bypass this — a rejected session is a
// definitive signal worth telling the user about immediately.
const RECONNECT_DIALOG_GRACE_MS = 4_000

/**
 * Global, single-instance guard mounted once at the root layout. Watches the
 * web transport's connection health and renders a blocking dialog when the
 * link is lost (auto-reconnecting, with a manual "Reconnect now") or the
 * session has expired (prompting re-login). Inert outside web mode — the store
 * returns "connected" for SSR / desktop / remote-desktop, so this renders
 * nothing there.
 */
export function WebConnectionGuard() {
  const t = useTranslations("WebConnection")
  const state = useSyncExternalStore(
    subscribeWebConnection,
    getWebConnectionSnapshot,
    getWebConnectionServerSnapshot
  )

  // Grace debounce: only reveal the reconnecting dialog once the link has been
  // down continuously for RECONNECT_DIALOG_GRACE_MS. `graceElapsed` is set
  // true only from the timer callback; the cleanup resets it to false whenever
  // `state` changes (recovered, or escalated to unauthorized), so the next
  // outage starts a fresh grace window rather than flashing instantly.
  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    if (state !== "reconnecting") return
    const id = setTimeout(
      () => setGraceElapsed(true),
      RECONNECT_DIALOG_GRACE_MS
    )
    return () => {
      clearTimeout(id)
      setGraceElapsed(false)
    }
  }, [state])

  // Fast recovery + half-open detection on network restore / tab wake.
  // Backoff caps at 32s, and sleep/wake or Wi-Fi switches often leave the
  // socket looking "connected" (half-open) with no `onclose`. Always ask the
  // transport to verify liveness on `online`, `pageshow`, and `visibilitychange`
  // back to visible: reconnecting states probe immediately, while connected
  // sockets fire a lightweight ping/pong check without disrupting a healthy
  // link. No-op off web/SSR.
  useEffect(() => {
    const verify = () => {
      verifyWebConnection()
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") verify()
    }
    window.addEventListener("online", verify)
    window.addEventListener("pageshow", verify)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.removeEventListener("online", verify)
      window.removeEventListener("pageshow", verify)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const showReconnecting = state === "reconnecting" && graceElapsed
  const showUnauthorized = state === "unauthorized"
  // A proxy in front of Codeg (e.g. Cloudflare Access) rejected the request:
  // its session expired, not the Codeg token. A top-level reload lets the
  // proxy run its own login flow and keeps the token; "Go to login" stays as
  // the way out should the proxy keep refusing after the reload.
  const showProxyUnauthorized = state === "proxyUnauthorized"

  // Non-blocking floating status pill for transient disconnects so the user can
  // keep reading conversation history and drafting messages while reconnecting
  // (matches RemoteConnectionStatus). Only definitive auth expirations block
  // the page with a modal dialog.
  if (showReconnecting) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-4 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%_-_2rem)] items-center gap-3 rounded-xl border bg-background/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur-sm"
      >
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="min-w-0">
          <p className="font-medium leading-snug">{t("disconnectedTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("reconnectingDescription")}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => reconnectWebNow()}>
          {t("reconnectNow")}
        </Button>
      </div>
    )
  }

  const open = showUnauthorized || showProxyUnauthorized

  if (!open) return null

  return (
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent
        // Forced state: block Esc/outside dismissal. The dialog is driven
        // entirely by connection health — it closes when the link recovers,
        // not on user whim.
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogMedia>
            <ShieldAlert className="text-destructive" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            {showProxyUnauthorized
              ? t("proxySignInTitle")
              : t("sessionExpiredTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {showProxyUnauthorized
              ? t("proxySignInDescription")
              : t("sessionExpiredDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {showProxyUnauthorized ? (
            <>
              <Button variant="outline" onClick={() => redirectToCodegLogin()}>
                {t("goToLogin")}
              </Button>
              <Button onClick={() => window.location.reload()}>
                {t("reloadPage")}
              </Button>
            </>
          ) : (
            <Button onClick={() => redirectToCodegLogin()}>
              {t("goToLogin")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
