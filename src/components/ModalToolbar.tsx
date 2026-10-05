import { Icon } from './Icon'

interface Props {
  title: string
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  closeLabel?: string
  busy?: boolean
  confirmDisabled?: boolean
}

/** 顶部圆形操作与底部文字按钮共享同一回调和保存状态。 */
export function ModalToolbar({ title, onClose, onConfirm, confirmLabel, closeLabel = '关闭', busy = false, confirmDisabled = false }: Props) {
  return <header className="modal-toolbar">
    <button type="button" className="ios-button ios-button-secondary ios-button-circle"
      aria-label={closeLabel} disabled={busy} onClick={onClose}><Icon name="close" /></button>
    <h2 className="min-w-0 text-center text-base font-semibold">{title}</h2>
    <button type="button" className="ios-button ios-button-primary ios-button-circle"
      aria-label={confirmLabel} aria-busy={busy} disabled={busy || confirmDisabled} onClick={onConfirm}><Icon name="check" /></button>
  </header>
}
