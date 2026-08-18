export const metadata = { title: 'No signal — BioAssetPro' };

/**
 * Shown when a page is asked for that has never been opened on this phone.
 *
 * Deliberately outside the app layout: that layout calls the API to check the
 * session, which is exactly what cannot happen here. A page whose fallback
 * needs the network is not a fallback.
 *
 * The tone matters. This is not an error the worker caused, and the most useful
 * thing it can say is which parts of the app still work.
 */
export default function OfflinePage() {
  return (
    <main className="login-page">
      <div className="login-panel">
        <div className="card">
          <div className="card-body stack">
            <h1>No signal</h1>
            <p className="muted" style={{ fontSize: 14 }}>
              This page has not been opened on this phone before, so there is no saved copy
              to show you.
            </p>

            <div className="notice notice-info">
              <span>
                Pages you have already opened will still work. The daily round is the one to
                open before you walk out — once it has loaded once, it keeps working with no
                signal.
              </span>
            </div>

            <p className="muted" style={{ fontSize: 14 }}>
              Anything you record while offline is kept on this phone and sent by itself when
              the signal comes back. Nothing is lost.
            </p>

            <a className="btn btn-primary" href="/">
              Try again
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
