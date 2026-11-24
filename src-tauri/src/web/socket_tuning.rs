//! TCP options for the web server's accepted connections (fork).
//!
//! - `TCP_NODELAY`: the event stream writes many small WebSocket frames (a
//!   streamed reply arrives as one frame per agent chunk). With Nagle's
//!   algorithm on, every small frame written while an earlier one is still
//!   unacknowledged waits for that ACK, so over a 370 ms round trip the text
//!   reaches the browser in clumps half a second apart even on a clean link.
//!   Browsers (and hyper's own client) set it on their side already.
//! - `TCP_NOTSENT_LOWAT` (Linux): caps how much not-yet-sent data the kernel
//!   holds for a socket. Data the kernel holds is past the point where the
//!   server can reorder it; data the server holds is not. Keeping the kernel's
//!   share small lets a pong or a small event go out ahead of a big snapshot
//!   still queued in the server instead of behind megabytes already handed to
//!   the kernel. It does not throttle throughput: the socket wakes the writer
//!   as soon as the unsent backlog drains below the mark.
//!
//! - `TCP_CONGESTION` (Linux): BBR. The kernel default (cubic) reads every
//!   lost packet as congestion and halves its sending rate, so on a link that
//!   simply loses packets — a few percent across the ocean is common — a
//!   connection crawls: the first load's 1.9 MB of scripts took a median
//!   23.5 s at 368 ms / 3.6 % loss each way, 11.2 s with BBR, which paces by
//!   the bandwidth and round trip it measures instead. Only codeg's own
//!   sockets; nothing else on the host changes. A kernel without BBR keeps its
//!   default (as root the kernel loads the `tcp_bbr` module for it if it is
//!   installed; otherwise it must be in `tcp_allowed_congestion_control`).
//!
//! `CODEG_TCP_NOTSENT_LOWAT=<bytes>` overrides the mark; `0` leaves the kernel
//! default (no limit). `CODEG_TCP_CONGESTION=<name>` picks another algorithm;
//! empty or `off` leaves the kernel default.

/// Default `TCP_NOTSENT_LOWAT`: enough to keep a fast link busy between
/// wakeups, small enough that a queued pong never waits behind more than a
/// few hundred milliseconds of a slow link.
pub const DEFAULT_NOTSENT_LOWAT: u32 = 64 * 1024;

/// Default congestion control for accepted connections.
pub const DEFAULT_CONGESTION: &str = "bbr";

/// The congestion control to ask for, read once; `None` leaves the default.
#[cfg(target_os = "linux")]
fn congestion() -> Option<&'static str> {
    static NAME: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        let name = std::env::var("CODEG_TCP_CONGESTION")
            .unwrap_or_else(|_| DEFAULT_CONGESTION.to_string());
        let name = name.trim();
        (!name.is_empty() && name != "off").then(|| name.to_string())
    })
    .as_deref()
}

#[cfg(target_os = "linux")]
fn notsent_lowat() -> u32 {
    std::env::var("CODEG_TCP_NOTSENT_LOWAT")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(DEFAULT_NOTSENT_LOWAT)
}

/// Apply the options to one accepted connection. Failures are logged and
/// otherwise ignored: a socket without them still works, only slower.
pub fn configure_accepted(stream: &mut tokio::net::TcpStream) {
    if let Err(err) = stream.set_nodelay(true) {
        tracing::debug!("[WEB] TCP_NODELAY not set on an accepted socket: {err}");
    }
    #[cfg(target_os = "linux")]
    {
        let lowat = notsent_lowat();
        if lowat > 0 {
            if let Err(err) = set_notsent_lowat(stream, lowat) {
                tracing::debug!("[WEB] TCP_NOTSENT_LOWAT not set on an accepted socket: {err}");
            }
        }
        if let Some(name) = congestion() {
            if let Err(err) = set_congestion(stream, name) {
                // Said once: every connection would fail the same way.
                static SAID: std::sync::atomic::AtomicBool =
                    std::sync::atomic::AtomicBool::new(false);
                if !SAID.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    tracing::info!(
                        "[WEB] TCP congestion control {name} not available ({err}); \
                         the kernel default stays"
                    );
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn set_congestion(stream: &tokio::net::TcpStream, name: &str) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    // SAFETY: `fd` is a live socket owned by `stream` for the whole call, and
    // the option value points at `name`'s bytes for the length given.
    let rc = unsafe {
        libc::setsockopt(
            stream.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_CONGESTION,
            name.as_ptr() as *const libc::c_void,
            name.len() as libc::socklen_t,
        )
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn set_notsent_lowat(stream: &tokio::net::TcpStream, bytes: u32) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    let value: libc::c_int = bytes.min(i32::MAX as u32) as libc::c_int;
    // SAFETY: `fd` is a live socket owned by `stream` for the whole call, and
    // the option value points at a correctly sized `c_int` on the stack.
    let rc = unsafe {
        libc::setsockopt(
            stream.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_NOTSENT_LOWAT,
            &value as *const libc::c_int as *const libc::c_void,
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        )
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepted_socket_gets_nodelay_and_lowat() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let client = tokio::spawn(async move { tokio::net::TcpStream::connect(addr).await });
        let (mut accepted, _) = listener.accept().await.unwrap();
        let _client = client.await.unwrap().unwrap();

        assert!(!accepted.nodelay().unwrap(), "default is Nagle on");
        configure_accepted(&mut accepted);
        assert!(accepted.nodelay().unwrap());

        #[cfg(target_os = "linux")]
        {
            use std::os::fd::AsRawFd;
            let mut value: libc::c_int = 0;
            let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
            // SAFETY: as in `set_notsent_lowat`; `value`/`len` are valid out-params.
            let rc = unsafe {
                libc::getsockopt(
                    accepted.as_raw_fd(),
                    libc::IPPROTO_TCP,
                    libc::TCP_NOTSENT_LOWAT,
                    &mut value as *mut libc::c_int as *mut libc::c_void,
                    &mut len,
                )
            };
            assert_eq!(rc, 0);
            assert_eq!(value as u32, DEFAULT_NOTSENT_LOWAT);

            // BBR when this kernel offers it (the default otherwise).
            let offered =
                std::fs::read_to_string("/proc/sys/net/ipv4/tcp_available_congestion_control")
                    .unwrap_or_default();
            if offered.split_whitespace().any(|n| n == DEFAULT_CONGESTION) {
                let mut name = [0u8; 16];
                let mut len = name.len() as libc::socklen_t;
                // SAFETY: `name`/`len` are valid out-params of the given size.
                let rc = unsafe {
                    libc::getsockopt(
                        accepted.as_raw_fd(),
                        libc::IPPROTO_TCP,
                        libc::TCP_CONGESTION,
                        name.as_mut_ptr() as *mut libc::c_void,
                        &mut len,
                    )
                };
                assert_eq!(rc, 0);
                let got = std::str::from_utf8(&name[..len as usize])
                    .unwrap()
                    .trim_end_matches('\0');
                assert_eq!(got, DEFAULT_CONGESTION);
            }
        }
    }
}
