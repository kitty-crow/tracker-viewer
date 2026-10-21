/** Post-shutdown page. No innerHTML strings or inline styles are needed. */
export function StoppedMessage() {
  return (
    <main className="stopped-message" role="status">
      <h1>Tracker Viewer stopped</h1>
      <p>You can close this browser tab.</p>
    </main>
  );
}
