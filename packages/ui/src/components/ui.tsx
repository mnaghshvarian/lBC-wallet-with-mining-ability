import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, EyeOff, Info, X, XCircle } from 'lucide-react';
import { errorMessage, useApp, useT } from '../store';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'violet';

export function Button({
  variant = 'secondary',
  size,
  block,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'lg'; block?: boolean; loading?: boolean }) {
  const v = variant === 'danger-solid' ? 'danger solid' : variant === 'secondary' ? '' : variant;
  return (
    <button className={`btn ${v} ${size ?? ''} ${block ? 'block' : ''} ${className}`} disabled={rest.disabled || loading} {...rest}>
      {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className={`btn ghost icon-btn ${className}`} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function Field({ label, hint, error, children }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="error-text">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const { invalid, className = '', ...rest } = props;
  return (
    <div className="input-wrap">
      <input {...rest} type={show ? 'text' : 'password'} className={`input ${invalid ? 'invalid' : ''} ${className}`} style={{ paddingInlineEnd: 44 }} autoComplete="new-password" spellCheck={false} />
      <div className="input-suffix">
        <IconButton label={show ? t('common.hide') : t('common.show')} type="button" onClick={() => setShow(!show)} tabIndex={-1}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </IconButton>
      </div>
    </div>
  );
}

export function StrengthMeter({ password }: { password: string }) {
  const t = useT();
  const [state, setState] = useState<{ score: number; hint: string }>({ score: 0, hint: '' });
  useEffect(() => {
    let alive = true;
    if (!password) {
      setState({ score: 0, hint: '' });
      return;
    }
    void window.lbc.wallets.passwordStrength(password).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [password]);
  return (
    <div>
      <div className={`strength s${state.score}`}>
        <div className="b" />
        <div className="b" />
        <div className="b" />
        <div className="b" />
      </div>
      {password && (
        <div className="hint" style={{ marginTop: 4 }}>
          {password.length < 8 ? t('password.tooShort') : t(`password.score${state.score}`)}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: 'green' | 'violet' | 'amber' | 'red' | 'blue'; children: ReactNode }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Spinner({ large }: { large?: boolean }) {
  const t = useT();
  return <span className={`spinner ${large ? 'lg' : ''}`} role="status" aria-label={t('common.loading')} />;
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: ReactNode; children?: ReactNode }) {
  const icon = tone === 'warn' || tone === 'danger' ? <AlertTriangle size={18} color={tone === 'danger' ? 'var(--danger)' : 'var(--warning)'} /> : tone === 'ok' ? <CheckCircle2 size={18} color="var(--positive)" /> : <Info size={18} color="var(--info)" />;
  return (
    <div className={`callout ${tone === 'info' ? '' : tone}`}>
      {icon}
      <div>
        {title && <div className="title">{title}</div>}
        {children && <div className="text-2">{children}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div className="title">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function CopyButton({ text, label, sensitive, size = 'sm', variant = 'secondary' }: { text: string; label?: string; sensitive?: boolean; size?: 'sm' | 'lg'; variant?: BtnVariant }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      type="button"
      onClick={async () => {
        await window.lbc.app.copy(text, { sensitive });
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
      {done ? t('common.copied') : (label ?? t('common.copy'))}
    </Button>
  );
}

export function Modal({ title, onClose, children, footer, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; icon?: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="modal-header">
          {icon}
          <h2>{title}</h2>
          <div className="spacer" />
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="overlay" style={{ background: 'transparent' }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-header">
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <div className="spacer" />
          <IconButton label={t('common.close')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} onClick={() => dismiss(toast.id)}>
          {toast.kind === 'error' || toast.kind === 'dropped' ? (
            <XCircle size={20} color="var(--danger)" />
          ) : toast.kind === 'locked' || toast.kind === 'node' ? (
            <Info size={20} color="var(--info)" />
          ) : (
            <CheckCircle2 size={20} color="var(--positive)" />
          )}
          <div>
            <div className="title">{toast.title}</div>
            {toast.message && <div className="msg">{toast.message}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Password prompt used for sensitive actions (reveal phrase, delete wallet…). */
export function PasswordPrompt({
  title,
  description,
  confirmLabel,
  danger,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSubmit(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} loading={busy} disabled={!password} onClick={submit}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {description && <div className="text-2">{description}</div>}
        <Field label={t('common.walletPassword')} error={error}>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && void submit()} invalid={!!error} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}
