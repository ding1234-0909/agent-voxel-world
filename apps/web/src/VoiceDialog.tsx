import { useEffect, useRef, type ComponentProps } from 'react';
import { VoicePanel } from './VoicePanel';

type Props = Omit<ComponentProps<typeof VoicePanel>, 'hidden' | 'onClose'> & {
  open: boolean;
  onClose: () => void;
};

/** Keep voice state mounted when the settings window is closed. */
export function VoiceDialog({ open, onClose, ...voiceProps }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="voice-dialog"
      aria-labelledby="voice-title"
      onCancel={onClose}
    >
      <div className="voice-dialog-heading">
        <div>
          <div className="eyebrow">VOICE SETTINGS</div>
          <h2 id="voice-title">语音实验室</h2>
        </div>
        <button aria-label="关闭语音实验室" onClick={onClose}>
          关闭 ×
        </button>
      </div>
      <VoicePanel {...voiceProps} />
    </dialog>
  );
}
