export function PeekBar(): JSX.Element {
  return (
    <button
      className="peek-bar"
      onClick={() => window.edgenotes.window.expand()}
      aria-label="展开 EdgeNotes 笔记面板"
      title="展开 EdgeNotes"
    >
      <span className="peek-glow" aria-hidden="true" />
    </button>
  )
}
