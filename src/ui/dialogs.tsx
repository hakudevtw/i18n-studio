import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Translator } from "./i18n";

/** A modal `<dialog>`: Esc closes it natively; `onClose` fires however it closes. */
const Modal = ({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ComponentChildren;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog aria-label={label} onClose={onClose} ref={ref}>
      {children}
    </dialog>
  );
};

export const ConfirmDialog = ({
  tr,
  text,
  yes,
  items,
  danger,
  onYes,
  onCancel,
}: {
  tr: Translator;
  text: string;
  yes: string;
  /** Listed under the question, e.g. the keys a delete removes. */
  items?: string[];
  /** The confirming button is styled as destructive. */
  danger?: boolean;
  onYes: () => void;
  onCancel: () => void;
}) => (
  <Modal label={text} onClose={onCancel}>
    <p class="confirm">{text}</p>
    {items && items.length > 0 && (
      <ul class="confirm-items">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )}
    <div class="row">
      <button class="act" onClick={onCancel} type="button">
        {tr.t("confirm.cancel")}
      </button>
      <button
        class={danger ? "act danger" : "act primary"}
        onClick={onYes}
        type="button"
      >
        {yes}
      </button>
    </div>
  </Modal>
);

const SHORTCUTS = [
  "help.arrows",
  "help.edit",
  "help.commit",
  "help.tab",
  "help.space",
  "help.save",
  "help.open",
] as const;

export const ShortcutsDialog = ({
  tr,
  onClose,
}: {
  tr: Translator;
  onClose: () => void;
}) => (
  <Modal label={tr.t("help.title")} onClose={onClose}>
    <h3>{tr.t("help.title")}</h3>
    <ul class="shortcuts">
      {SHORTCUTS.map((key) => (
        <li key={key}>{tr.t(key)}</li>
      ))}
    </ul>
    <div class="row">
      <button class="act" onClick={onClose} type="button">
        {tr.t("dialog.close")}
      </button>
    </div>
  </Modal>
);

/** Shown when the viewer blocks the clipboard: select all, copy by hand. */
export const ManualCopyDialog = ({
  tr,
  text,
  onClose,
}: {
  tr: Translator;
  text: string;
  onClose: () => void;
}) => {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const id = setTimeout(() => area.current?.select(), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <Modal label={tr.t("copy")} onClose={onClose}>
      <p>{tr.t("dialog.text")}</p>
      <textarea readOnly ref={area} value={text} />
      <div class="row">
        <button class="act" onClick={onClose} type="button">
          {tr.t("dialog.close")}
        </button>
      </div>
    </Modal>
  );
};
