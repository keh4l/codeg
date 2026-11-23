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
//! `CODEG_TCP_NOTSENT_LOWAT=<bytes>` overrides the mark; `0` leaves the kernel
//! default (no limit).

/// Default `TCP_NOTSENT_LOWAT`: enough to keep a fast link busy between
/// wakeups, small enough that a queued pong never waits behind more than a
/// few hundred milliseconds of a slow link.
pub const DEFAULT_NOTSENT_LOWAT: u32 = 64 * 1024;

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
        }
    }
}
