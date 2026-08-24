export function PeekBar(): JSX.Element {
  return (
    <button
      className="peek-bar"
      onClick={() => window.edgememo.window.expand()}
      aria-label="展开 EdgeMemo 笔记面板"
      title="展开 EdgeMemo"
    >
      <span className="peek-glow" aria-hidden="true" />
    </button>
  )
}
