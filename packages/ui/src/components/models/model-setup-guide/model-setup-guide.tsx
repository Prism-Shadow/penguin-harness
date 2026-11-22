/**
 * The first step before a Project has a model it can use: no API key is set anywhere, so there is
 * nothing to choose a default from yet. The guide says so and offers the two ways out — connect a
 * provider that hands over a key (one row per provider: its logo, its name and its connect
 * button), or go and type a key in — and closes on "Later".
 *
 * The caller decides when it shows, and replaces it with the default-models dialog once a key has
 * landed; every word, and what each button does, is the caller's.
 */
import type { ReactNode } from "react";
import { Button } from "../../actions/button/button";
import { ProviderLogo } from "../../icons/logos/provider-logo";
import { Modal } from "../../overlays/modal/modal";

/** A provider the guide offers to connect. */
export interface SetupProvider {
  id: string;
  label: string;
  /** A line under the name: what connecting it brings. */
  description?: string;
  connectLabel: string;
  onConnect: () => void;
  /** Its connect flow is running. */
  busy?: boolean;
}

export interface ModelSetupGuideProps {
  open: boolean;
  title: string;
  /** Why the guide is here: no model has a key yet. */
  body: ReactNode;
  providers: readonly SetupProvider[];
  /** The other way out: a sentence, and the button that leads to where a key is typed. */
  keyText: string;
  keyAction: { label: string; onClick: () => void };
  laterLabel: string;
  onClose: () => void;
  closeLabel?: string;
}

export function ModelSetupGuide({
  open,
  title,
  body,
  providers,
  keyText,
  keyAction,
  laterLabel,
  onClose,
  closeLabel,
}: ModelSetupGuideProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      widthClass="sm:max-w-lg"
      {...(closeLabel !== undefined ? { closeLabel } : {})}
      footer={
        <Button size="sm" onClick={onClose}>
          {laterLabel}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-fg-muted">{body}</div>
        <div className="divide-y divide-line-muted">
          {providers.map((provider) => (
            <div
              key={provider.id}
              data-setup-provider={provider.id}
              className="flex items-center gap-3 py-3 first:pt-0"
            >
              <ProviderLogo provider={provider.id} className="h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{provider.label}</p>
                {provider.description !== undefined && (
                  <p className="mt-0.5 text-xs text-fg-subtle">{provider.description}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="primary"
                loading={provider.busy === true}
                onClick={provider.onConnect}
              >
                {provider.connectLabel}
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-3 py-3 last:pb-0">
            <p className="min-w-0 flex-1 text-sm text-fg-muted">{keyText}</p>
            <Button size="sm" onClick={keyAction.onClick}>
              {keyAction.label}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
