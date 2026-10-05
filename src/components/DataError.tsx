export function DataError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <section className="glass-card my-8 p-6 text-center">
    <h2 className="font-semibold">数据暂时无法加载</h2>
    <p role="alert" className="mt-2 text-sm text-stone-500">{error instanceof Error ? error.message : '无法连接记账服务，请检查网络后重试'}</p>
    <button type="button" onClick={onRetry} className="ios-button ios-button-primary mt-4">重新加载</button>
  </section>
}
