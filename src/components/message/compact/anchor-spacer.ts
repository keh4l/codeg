/**
 * keh4l build (T3 style): after a send, the compact view pins the new user
 * message this far from the top of the thread viewport.
 */
export const SEND_ANCHOR_TOP_PX = 24

/**
 * Height of the temporary spacer under the thread that lets the newly sent
 * user message sit `SEND_ANCHOR_TOP_PX` from the top while the reply is
 * shorter than the viewport.
 *
 * Sized so the furthest scroll position is exactly that anchored position:
 * the spacer shrinks as the reply grows, is 0 once the reply fills the
 * viewport, and grows back if the reply gets shorter (a turn folding when it
 * completes) so the view does not jump. A fixed spacer left a screen of blank
 * scroll below any reply shorter than the viewport.
 *
 * All lengths are in the scroll container's coordinates:
 * - `viewportHeight`: the scroll container's `clientHeight`
 * - `scrollHeight`: its `scrollHeight`, including `currentSpacer`
 * - `anchorTop`: offset of the anchored user message's top from the start of
 *   the scrolled content
 */
export function sendAnchorSpacerHeight({
  viewportHeight,
  scrollHeight,
  anchorTop,
  currentSpacer,
}: {
  viewportHeight: number
  scrollHeight: number
  anchorTop: number
  currentSpacer: number
}): number {
  const belowAnchor = scrollHeight - currentSpacer - anchorTop
  return Math.max(
    0,
    Math.round(viewportHeight - SEND_ANCHOR_TOP_PX - belowAnchor)
  )
}
